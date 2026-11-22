// Subagents of the agent you are looking at: a tree with connector lines, a
// creature and status per subagent, what it last reported, and a progress
// shimmer while it works. Toggle with ctrl shift s. Click one to peek at it.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, focused, run, theme } from "herdr";
import { glyph } from "./glyph.js";
import { info, accountName, prettyModel, refresh } from "./who.js";
import { claudeSubs, refreshClaude } from "./claude.js";

const MONO = "JetBrains Mono";
const CHIP = { blocked: "NEEDS YOU", working: "WORKING", done: "DONE", idle: "IDLE" };
const RANK = { blocked: 4, working: 3, done: 2, idle: 1 };

// A subagent is never "done" for you to look at: it reports to its parent.
const statusOf = (k) => (k.status === "error" ? "blocked" : (k.status ?? "idle"));

// What it last said, as one short line. `report` may be text or an object.
function said(k) {
  const r = k.report;
  let text = typeof r === "string" ? r : r && typeof r === "object" ? (r.message ?? r.text ?? r.summary ?? r.title ?? "") : "";
  if (typeof text !== "string") text = "";
  if (!text) text = typeof k.title === "string" ? k.title : "";
  return text.replace(/^[^\p{L}\p{N}]+/u, "").replace(/\s+/g, " ").trim();
}

export default class CockpitSubagents extends View {
  init(_props, cx) {
    // Account and model of the shown agent and its subagents, looked up in the background.
    const look = (cx) => {
      const addrs = terminals().filter((k) => k.state === "live" && k.program?.agent).map((k) => k.address);
      return Promise.all([refresh(addrs), refreshClaude(addrs)]).then((c) => c.some(Boolean) && cx.notify());
    };
    look(cx);
    cx.timer.every(5000, look);
  }

  // Live subagents of `addr`, depth first, each with its depth.
  tree(all, addr, depth = 0) {
    const real = all.filter((k) => k.parent === addr && k.state === "live")
      .flatMap((k) => [{ k, depth }, ...this.tree(all, k.address, depth + 1)]);
    // Claude Code's Agent-tool subagents have no terminal: listed for the parent, not clickable.
    return depth === 0 ? [...real, ...claudeSubs(addr).map((k) => ({ k, depth }))] : real;
  }

  row(t, { k, depth }) {
    const s = statusOf(k);
    const color = t[s] ?? t.dim;
    const line = said(k);
    return h_flex().id(`sub-${k.address}`).relative().flex_none().gap(10).items_center()
      .rounded(8).py(4).pr(6).pl(depth * 20)
      .when(!k.synthetic, (el) => el.cursor_pointer().hover((e) => e.bg(t.hover)).on_click(() => run("terminal.peek", { terminal: k.address })))
      // the tick that joins this row to the vertical line
      .child(div().absolute().left(-24 + depth * 20).top("50%").w(18).h(1).bg(t.input))
      .child(glyph(s, 30, color))
      .child(v_flex().flex_1().min_w(0).gap(s === "working" ? 5 : 3)
        .child(div().truncate().text_size(13.5).font_semibold().text_color(t.foreground)
          .child(k.name || k.template || k.program?.name || k.address))
        .when(Boolean(line), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(line)))
        .when(Boolean(info(k.address)?.model), (el) => el.child(
          div().truncate().text_size(11).font_family(MONO).text_color(t.dim).child(`${accountName(k.address)} · ${prettyModel(info(k.address).model)}`)))
        .when(Boolean(k.synthetic && k.model), (el) => el.child(
          div().truncate().text_size(11).font_family(MONO).text_color(t.dim).child(`${k.agentType || "subagent"} · ${prettyModel(k.model)}`)))
        .when(s === "working", (el) => el.child(
          div().h(3).rounded(2).bg(t.selected).overflow_hidden()
            .child(div().h(3).rounded(2).bg(color).w(48).loop("left", { from: 0, to: 150, period: 1700 })))))
      .child(div().flex_none().text_size(10.5).font_semibold().font_family(MONO).text_color(color).child(CHIP[s] ?? ""));
  }

  render() {
    const t = theme();
    const list = agents();
    const all = terminals();
    const shownAddr = focused()?.agent;
    const parent = list.find((a) => a.address === shownAddr) ?? list.find((a) => a.status === "blocked") ?? list[0];
    const rows = parent ? this.tree(all, parent.address) : [];
    const count = (s) => rows.filter((r) => statusOf(r.k) === s).length;
    const summary = ["working", "done", "blocked"].filter((s) => count(s) > 0)
      .map((s) => `${count(s)} ${s === "blocked" ? "needs you" : s}`).join(" · ");
    const pcolor = parent ? (t[parent.status] ?? t.dim) : t.dim;

    const head = h_flex().items_center().justify_between()
      .child(div().text_size(11).font_semibold().font_family(MONO).text_color(t.dim).child(`SUBAGENTS · ${rows.length}`))
      .child(div().text_size(11).font_family(MONO).text_color(t.dim).child("ctrl shift s"));

    const parentRow = parent && h_flex().flex_none().gap(10).items_center()
      .child(glyph(parent.status, 26, pcolor))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_size(14).font_semibold().text_color(t.foreground).child(`${accountName(parent.address, parent.program?.name ?? "Agent")} · ${parent.space_name}`))
        .when(Boolean(info(parent.address)?.model), (el) => el.child(div().truncate().text_size(11).font_family(MONO).text_color(t.dim).child(prettyModel(info(parent.address).model)))))
      .child(div().flex_none().text_size(12).text_color(t.dim).child("parent"));

    const body = rows.length
      ? v_flex().id("subs").flex_1().min_h(0).overflow_y_scrollbar()
          .child(v_flex().relative().flex_none().ml(12).pl(24).gap(8)
            // the vertical line the ticks hang from, only as tall as the rows
            .child(div().absolute().left(0).top(-4).bottom(14).w(1).bg(t.input))
            .children([...rows].map((r) => this.row(t, r))))
      : v_flex().flex_1().items_center().justify_center().gap(10)
          .child(glyph("idle", 44, t.idle))
          .child(div().text_size(12.5).text_color(t.dim).child("No subagents running"));

    return v_flex().size_full().p(16).gap(14).bg(t.surface)
      .child(head)
      .when(Boolean(parentRow), (el) => el.child(parentRow))
      .when(Boolean(summary), (el) => el.child(div().text_size(12).font_family(MONO).text_color(t.muted).child(summary)))
      .child(body);
  }
}
