// Bottom bar: where this runs, the branch, and a count per agent state.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme } from "herdr";

const MONO = "JetBrains Mono";

export default class CockpitStatus extends View {
  render() {
    const t = theme();
    const space = spaces().find((s) => s.active);
    const list = agents();
    const count = (s) => list.filter((a) => a.status === s).length;
    const dot = (c) => div().size(7).rounded_full().bg(c);
    const legend = (label, status, color) => h_flex().gap(6).items_center()
      .child(dot(color)).child(`${count(status)} ${label}`);
    return h_flex().size_full().px(4).gap(14).items_center().text_size(12).font_family(MONO).text_color(t.dim)
      .child(h_flex().gap(7).items_center().child(dot(t.done)).child(space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), (el) => el.child(div().child(space.branch)))
      .child(div().child(`${list.length} agents`))
      .child(div().flex_1())
      .child(legend("working", "working", t.working))
      .child(legend("done", "done", t.done))
      .child(legend("needs you", "blocked", t.blocked))
      .child(legend("idle", "idle", t.idle));
  }
}
