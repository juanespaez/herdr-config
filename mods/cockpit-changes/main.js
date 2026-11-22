import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, shared, setShared } from "herdr";

import { loadGraph, graphKey, commitFiles, commitDiffArgs } from "./repo.js";
import { through } from "./graph.js";
import { laneCell, laneWidth } from "./draw.js";

// Which sections are open: kept in shared state, so it survives restarts.
const OPEN = "cockpit-changes.open", SECTION = 34;

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const ago = (time) => {
  const s = Math.max(0, Date.now() / 1000 - time);
  return s < 3600 ? `hace ${Math.max(1, Math.round(s / 60))} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`;
};
// Graph list keys: a commit's sha, or its details/file rows under it.
const itemKey = (it) => (it.meta ? `${it.row.commit.sha}\0meta` : it.file ? `${it.row.commit.sha}\0file\0${it.file.path}` : it.row.commit.sha);
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: untab(line.slice(1)) || " " }; }
    return { kind: "", text: line };
  });
}

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.rows = []; this.diffWidth = 0; this.message = ""; this.handle = cx.focus_handle();
    this.graph = null; this.graphKey = null; this.graphScroll = VirtualListScrollHandle.new();
    this.expanded = null; this.graphPick = null;
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.open = null;
      this.setLines([]); this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.closed = false; this.limited = false;
      this.graph = null; this.graphKey = null; this.graphError = null; this.expanded = null; this.graphPick = null;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.setLines([]); this.open = null; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
        if (status.code !== 0) throw new Error(status.stderr);
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const stats = {};
        const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
        for (const result of results) {
          if (result.code !== 0) throw new Error(result.stderr);
          for (const entry of result.stdout.split("\0")) {
            const [a, d, ...parts] = entry.split("\t");
            if (!parts.length) continue;
            const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
            stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
          }
        }
        const files = [];
        const entries = status.stdout.split("\0").filter(Boolean);
        for (const entry of entries.slice(0, 1000)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
          const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
          const stat = stats[path] ?? { add: 0, del: 0 };
          files.push({ path, status: s, fresh, ...stat });
        }
        if (key() !== context) return;
        this.root = root; this.on = on; this.hasHead = head.code === 0; this.files = files; this.limited = entries.length > 1000; this.error = null;
        this.watch(root, cx);
        await this.loadGraphFor(root, on, context);
        if (this.open && !files.some((f) => f.path === this.open)) { this.open = null; this.setLines([]); }
        if (this.open) {
          try { await this.load(this.open, context); }
          catch { if (key() === context) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
        }
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async load(path, context) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    if (!file) return;
    let lines;
    if (file.fresh || (!this.hasHead && file.status === "A")) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map(l => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...READ, "diff", ...(this.hasHead ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (key() === context && this.open === path) this.setLines(lines.slice(0, 1500).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...this.rows.map(row => (row.text.length + 1) * 7 + 50));
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]); this.note = null; this.graphPick = null;
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); }
      catch (e) { if (key() === context && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  commit(cx) {
    if (!this.message.trim() || !this.root || this.busy || this.loading || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (key() === context) this.note = `Commit failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  diffRow({ kind, number, text }, t) {
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  isOpen(id) { return (shared(OPEN) ?? {})[id] ?? true; }

  toggle(id, cx) {
    setShared(OPEN, { changes: this.isOpen("changes"), graph: this.isOpen("graph"), [id]: !this.isOpen(id) });
    if (id === "graph" && this.isOpen("graph")) this.refreshGraph(cx, true);
    cx.notify();
  }

  // A section header: chevron, title and whatever the section adds on the right.
  section(id, title, t, extras = []) {
    const open = this.isOpen(id);
    return h_flex().id(`section-${id}`).h(SECTION).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.toggle(id, cx))
      .child(svg(`mods/cockpit-changes/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim))
      .child(div().font_semibold().child(title))
      .children(extras);
  }

  changesList(t, cap) {
    // overflow_y_scrollbar() wraps the list, so its flex sizing never reached the panel's layout.
    return div().flex_1().min_h(44).max_h(Math.min(this.files.length * 28 + 12, cap)).relative().border_b(1).border_color(t.border)
      .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().p(6).children(this.files.map((f) => {
        const parts = f.path.split("/"), name = parts.pop();
        return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().when(this.open === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(f.path, cx))
          .child(div().w(14).text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : f.status === "U" ? t.ansi1 : t.blocked).child(f.status))
          .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
          .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
      })).when(!this.files.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.error || (this.loading ? "Loading changes…" : this.root ? "No uncommitted changes" : "No folder")))))
      .child(Scrollbar.vertical("changes-list").absolute().inset_0());
  }

  // Reloads the graph only when HEAD, its upstream or the base moved (or when asked to).
  async loadGraphFor(root, on, context, force = false) {
    if (!this.isOpen("graph")) return;
    const git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
    try {
      const k = await graphKey(git);
      if (key() !== context || (!force && k === this.graphKey && this.graph)) return;
      const graph = await loadGraph(git);
      if (key() !== context) return;
      this.graph = graph; this.graphKey = k; this.graphWidth = laneWidth(graph.rows); this.graphError = null;
      if (this.expanded && !graph.rows.some((r) => r.commit.sha === this.expanded.sha)) this.expanded = null;
    } catch (e) { if (key() === context) this.graphError = String(e); }
  }

  refreshGraph(cx, force) {
    if (!this.root) return;
    const root = this.root, on = this.on, context = this.context;
    cx.spawn(async (cx) => { await this.loadGraphFor(root, on, context, force); cx.notify(); });
  }

  git() { const root = this.root, on = this.on; return (args) => exec("git", [...READ, ...args], { cwd: root, on }); }

  // One commit open at a time: click it again to fold it.
  pickCommit(row, cx) {
    const sha = row.commit.sha, merge = row.commit.parents.length > 1, context = this.context;
    if (this.expanded?.sha === sha) { this.expanded = null; cx.notify(); return; }
    this.expanded = { sha, merge, files: null, copied: false };
    cx.spawn(async (cx) => {
      try {
        const files = await commitFiles(this.git(), sha, merge);
        if (key() === context && this.expanded?.sha === sha) this.expanded.files = files;
      } catch (e) { if (key() === context && this.expanded?.sha === sha) { this.expanded.files = []; this.note = `Cannot list this commit's files: ${e}`; } }
      cx.notify();
    });
    cx.notify();
  }

  // A file of a graph commit takes over the diff viewer (and unselects the Changes file).
  pickCommitFile(sha, path, merge, cx) {
    const context = this.context;
    this.graphPick = { sha, path }; this.open = null; this.closed = true; this.note = null; this.setLines([]);
    cx.spawn(async (cx) => {
      try {
        const r = await this.git()(commitDiffArgs(sha, path, merge));
        if (r.code !== 0) throw new Error(r.stderr);
        const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
        const lines = first < 0 ? ["No text diff available"] : all.slice(first);
        if (key() === context && this.graphPick?.sha === sha && this.graphPick.path === path) this.setLines(lines.slice(0, 1500).map((line) => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
      } catch (e) { if (key() === context) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  // The graph's rows, with the open commit's details and files under it.
  graphItems() {
    const rows = this.graph?.rows ?? [], ex = this.expanded;
    return rows.flatMap((row) => row.commit.sha !== ex?.sha ? [{ row }]
      : [{ row }, { row, meta: true }, ...(ex.files ?? []).map((file) => ({ row, file }))]);
  }

  // Rows of a virtual list can't hold click handlers: the list routes clicks by item key.
  clickItem(k, cx) {
    const [sha, kind, path] = k.split("\0"), row = this.graph?.rows.find((r) => r.commit.sha === sha), ex = this.expanded;
    if (!row) return;
    if (!kind) this.pickCommit(row, cx);
    else if (kind === "meta" && ex) { cx.write_to_clipboard(sha); ex.copied = true; cx.notify(); }
    else if (kind === "file" && ex) this.pickCommitFile(sha, path, ex.merge, cx);
  }

  subRow(item, t) {
    const { row } = item, c = row.commit, ex = this.expanded, mono = settings().font_family ?? "JetBrains Mono";
    const lines = laneCell({ top: [], bottom: through(row) }, null, false, 28, t, this.graphWidth);
    if (item.meta) return h_flex().id(`graph-meta-${c.sha}`).w_full().h(28).flex_none().overflow_hidden().pr(10).gap(10).items_center().bg(t.raised).text_size(11).font_family(mono).text_color(t.dim)
      .child(lines).child(div().flex_none().text_color(t.muted).child(c.sha.slice(0, 7)))
      .child(div().flex_none().text_color(t.accent).cursor_pointer().child(ex.copied ? "✓ copiado" : "⧉ copiar"))
      .child(div().min_w(0).truncate().child(`${c.author} · ${ago(c.time)}`));
    const f = item.file, parts = f.path.split("/"), name = parts.pop();
    const picked = this.graphPick?.sha === c.sha && this.graphPick.path === f.path;
    return h_flex().id(`graph-file-${c.sha}-${f.path}`).w_full().h(28).flex_none().overflow_hidden().pr(10).gap(8).items_center().text_size(12).cursor_pointer()
      .bg(picked ? t.selected : t.raised).hover((s) => s.bg(t.hover))
      .child(lines)
      .child(div().w(12).flex_none().text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : t.blocked).child(f.status))
      .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(220).min_w(0).truncate().child(name)))
      .when(f.add > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
      .when(f.del > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
  }

  // Chips for a commit's refs: your branch, the base, others; ☁ when origin has it too.
  chips(row, t) {
    const g = this.graph, refs = row.commit.refs.filter((r) => r !== "origin/HEAD");
    const baseLocal = g.base?.replace(/^origin\//, "");
    const chip = (label, style) => div().flex_none().max_w(130).truncate().ml(6).px(7).py(1).rounded(10).text_size(11).child(label)
      .when(style === "mine", (e) => e.bg(t.accent).text_color(t.accent_foreground))
      .when(style === "base", (e) => e.border_1().border_color(t.ansi4).text_color(t.ansi4))
      .when(style === "other", (e) => e.border_1().border_color(t.border).text_color(t.muted));
    const out = [];
    for (const ref of refs) {
      if (ref.startsWith("tag: ")) { out.push(chip(ref.slice(5), "other")); continue; }
      const remote = ref.startsWith("origin/"), name = remote ? ref.slice(7) : ref;
      if (remote && refs.includes(name)) continue;
      // Your branch's upstream is just a cloud, as in VS Code.
      if (remote && name === g.branchName) { out.push(chip("☁", "other")); continue; }
      const cloud = remote || refs.includes(`origin/${name}`) ? " ☁" : "";
      const style = !remote && name === g.branchName ? "mine" : name === baseLocal ? "base" : "other";
      out.push(chip(`${style === "mine" ? "◎ " : ""}${remote && style !== "base" ? ref : name}${cloud}`, style));
    }
    const born = row.fork ? [div().flex_none().ml(6).px(5).py(1).rounded(4).border_1().border_dashed().border_color(t.accent).text_size(10.5).text_color(t.accent).child("↳ nació aquí")] : [];
    return [...born, ...out].slice(0, 4);
  }

  graphRow(row, t) {
    const head = row.node === "head", c = row.commit;
    const open = this.expanded?.sha === c.sha;
    return h_flex().id(`graph-${c.sha}`).w_full().h(28).flex_none().overflow_hidden().pr(10).items_center().cursor_pointer().hover((s) => s.bg(t.hover)).when(head, (e) => e.bg(t.selected)).when(open && !head, (e) => e.bg(t.raised))
      .child(laneCell(row, { col: row.col, kind: row.node, color: row.color }, row.fork, 28, t, this.graphWidth))
      .child(h_flex().flex_1().min_w(0).gap(6).items_center()
        .child(div().min_w(0).truncate().when(head, (e) => e.font_semibold()).child(c.subject))
        .when(!head, (e) => e.child(div().flex_none().text_size(11.5).text_color(t.dim).child(c.author))))
      .children(this.chips(row, t));
  }

  graphBody(t) {
    const rows = this.graphItems();
    const empty = this.error || this.graphError || (!this.graph ? (this.root ? "Loading graph…" : "No folder") : "No commits yet");
    return div().flex_1().min_h(0).relative()
      .when(rows.length > 0, (e) => e
        .child(v_virtual_list("graph", rows.length, 28, (i) => itemKey(rows[i]),
          (range) => rows.slice(range.start, range.end).map((it) => (it.meta || it.file ? this.subRow(it, t) : this.graphRow(it.row, t)))).track_scroll(this.graphScroll).size_full()
          .on_item_click((k, cx) => this.clickItem(k, cx)))
        .child(Scrollbar.vertical("graph").absolute().inset_0()))
      .when(!rows.length, (e) => e.child(div().p(10).text_color(t.dim).child(empty)));
  }

  graphTools(t) {
    const g = this.graph, button = (id, label, run) => div().id(id).flex_none().px(5).py(2).rounded(5).text_size(12).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.raised).text_color(t.foreground)).on_click((_e, cx) => { cx.stop_propagation(); run(cx); }).child(label);
    return [div().flex_1(),
      ...(g && g.ahead !== null ? [div().flex_none().text_size(11).font_family("JetBrains Mono").text_color(t.muted).child(`↑${g.ahead} ↓${g.behind}`)] : []),
      button("graph-head", "◎", () => { const i = this.graphItems().findIndex((it) => !it.meta && !it.file && it.row.node === "head"); if (i >= 0) this.graphScroll.scroll_to_item(i, "center"); }),
      button("graph-refresh", "⟳", (cx) => this.refreshGraph(cx, true))];
  }

  closeDiff(cx) {
    this.open = null; this.graphPick = null; this.closed = true; this.note = null; this.setLines([]);
    cx.notify();
  }

  // Shown only while a file is picked: half the panel, with a ✕ that gives the space back.
  diffArea(t) {
    const g = this.graphPick, label = g ? `${g.sha.slice(0, 7)} · ${g.path}` : this.open;
    return v_flex().flex_1().min_h(0).border_t(1).border_color(t.border)
      .child(h_flex().flex_none().h(28).pl(12).pr(6).gap(8).items_center().border_b(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(label))
        .child(div().id("close-diff").flex_none().px(6).py(2).rounded(5).cursor_pointer().hover((s) => s.bg(t.raised).text_color(t.foreground)).on_click((_e, cx) => this.closeDiff(cx)).child("✕")))
      .child(this.diffBody(t));
  }

  diffBody(t) {
    return div().flex_1().min_h(0).size_full().relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
      .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
        .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("changes-diff", this.rows.length, 20, (i) => String(i),
          (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
      .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0());
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const enabled = Boolean(this.message.trim() && this.root && !this.busy && !this.loading);
    const changesOpen = this.isOpen("changes"), graphOpen = this.isOpen("graph");
    const changesHeader = this.section("changes", "Changes", t, [
      div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${this.files.length} files`),
      div().flex_1(), div().text_size(11).text_color(t.ansi2).child(`+${add}`), div().text_size(11).text_color(t.ansi1).child(`−${del}`)]);
    const graphHeader = this.section("graph", "Graph", t, this.graphTools(t));
    const limited = (el) => el.when(this.limited, (e) => e.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")));

    // Changes and Graph take the height; a picked file's diff takes half of it until closed.
    const picked = Boolean(this.open || this.graphPick);
    const body = v_flex().flex_1().min_h(0)
      .child(changesHeader).when(changesOpen, (e) => limited(e.child(this.changesList(t, graphOpen || picked ? 220 : 4000))))
      .child(graphHeader).when(graphOpen, (e) => e.child(this.graphBody(t)))
      .when(picked, (e) => e.child(this.diffArea(t)));

    return v_flex().id("changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(body)
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)))
      .child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Committing…" : "Commit")));
  }
}
