import { View, div } from "gpui-kit";
import { run, nextCommand, focused, panes, exec, layout, agents } from "herdr";

// Invisible helper: receives "keyhelper.<command>" from keys.json and runs
// the several layout commands each key needs (a key can only run one).
const CHROME = ["sidebar", "top", "keys", "agents", "subagents", "tabs", "status"];

function exists(node, id) {
  if (node?.id === id) return true;
  return (node?.children ?? []).some((c) => exists(c, id));
}

export default class KeyHelper extends View {
  init(_props, cx) {
    this.focusMode = false;
    this.panel = null; // null (hidden), "files" or "changes"
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand());
        if (c.endsWith("focus")) this.toggleFocus();
        else if (c.endsWith("files")) this.togglePanel("files");
        else if (c.endsWith("changes")) this.togglePanel("changes");
        else if (c.endsWith("jump")) this.jump();
        else if (c.endsWith("cycleNext")) this.cycle(1);
        else if (c.endsWith("cyclePrev")) this.cycle(-1);
        else if (c.endsWith("splitup")) await this.splitTo("down");
        else if (c.endsWith("splitleft")) await this.splitTo("right");
        cx.notify();
      }
    });
  }

  toggleFocus() {
    this.focusMode = !this.focusMode;
    for (const id of CHROME.filter((i) => exists(layout(), i))) run(this.focusMode ? "layout.hide" : "layout.show", { id });
    if (this.focusMode && this.panel) {
      run("layout.hide", { id: "panel" });
      this.panel = null;
    }
  }

  // pane.split only goes right/down: split down, then push the old pane down
  // so the new terminal ends up above it.
  // Split toward `dir`, then trade places with the new pane (it lands on the
  // `dir` side of the old one, so swapping puts it on the opposite side).
  async splitTo(dir) {
    const cur = focused()?.pane;
    if (!cur) return;
    const before = new Set(panes().map((p) => p.pane));
    run("pane.split", { direction: dir, pane: cur });
    // wait for the new pane to exist, then trade places with it
    for (let i = 0; i < 20; i++) {
      await exec("sleep", ["0.1"]);
      const fresh = panes().find((p) => !before.has(p.pane));
      if (fresh) {
        run("pane.swap", { pane: cur, target: fresh.pane });
        return;
      }
    }
  }

  // ctrl-tab: every terminal (agents or not), across tabs and spaces, in the order they are listed.
  cycle(step) {
    const all = panes().filter((p) => p.terminal);
    if (all.length < 2) return;
    const cur = focused()?.pane;
    const i = all.findIndex((p) => p.pane === cur);
    const next = all[(i < 0 ? 0 : (i + step + all.length) % all.length)];
    run("pane.focus", { pane: next.pane });
  }

  // Go to the agent that is waiting for you.
  jump() {
    const a = agents().find((x) => x.status === "blocked");
    if (a) run("agent.focus", { terminal: a.address });
  }

  togglePanel(which) {
    if (this.panel === which) {
      run("layout.hide", { id: "panel" });
      this.panel = null;
      return;
    }
    run("layout.select", { stack: "panel-body", child: which });
    run("layout.show", { id: "panel" });
    this.panel = which;
  }

  render() {
    return div().w(0).h(0);
  }
}
