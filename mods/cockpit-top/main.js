// Top bar: a pill per space, a new-space button, and the "needs you" pill.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, run, theme } from "herdr";

const MONO = "JetBrains Mono";
const stop = (_e, cx) => cx.stop_propagation();

function keycap(t, text) {
  return div().flex_none().px(6).h(20).rounded(5).bg(t.raised).border(1).border_color(t.input).flex().items_center()
    .text_size(11).font_family(MONO).text_color(t.foreground).child(text);
}

export default class CockpitTop extends View {
  render() {
    const t = theme();
    const list = agents();
    const needs = list.filter((a) => a.status === "blocked");
    const pill = (s) => {
      const color = t[s.status] ?? t.dim;
      const word = (s.name || "?").replace(/^[^\p{L}\p{N}~]+/u, "");
      const dot = div().size(7).rounded_full().bg(s.status ? color : t.dim);
      if (s.status === "blocked") dot.loop("opacity", { from: 0.3, to: 1, period: 1400 });
      return h_flex().id(`space-${s.id}`).h(34).pl(10).pr(14).gap(9).items_center().flex_none().rounded(10).cursor_pointer()
        .border(1).border_color(s.active ? t.input : t.selected)
        .bg(s.active ? t.popover : "#00000000")
        .text_size(13).font_medium().text_color(s.active ? t.foreground : t.muted)
        .hover((el) => el.bg(t.hover))
        .on_mouse_down("left", stop)
        .on_click(() => run("space.select", { id: s.id }))
        .child(dot)
        .child(div().text_size(12).font_family(MONO).text_color(s.status ? color : t.muted).child(word.slice(0, 1).toUpperCase()))
        .child(div().child(word));
    };
    return h_flex().size_full().pl(86).pr(4).gap(8).items_center()
      .children(spaces().map(pill))
      .child(div().id("new-space").size(34).flex_none().rounded(10).border(1).border_dashed().border_color(t.input)
        .flex().items_center().justify_center().text_size(16).text_color(t.muted).cursor_pointer()
        .hover((el) => el.bg(t.hover))
        .on_mouse_down("left", stop)
        .on_click(() => run("space.new")).child("+"))
      .child(div().flex_1())
      .when(needs.length > 0, (el) => el.child(
        h_flex().id("needs").h(32).pl(12).pr(6).gap(10).items_center().rounded_full().cursor_pointer()
          .bg(t.blocked + "1a").border(1).border_color(t.blocked + "80")
          .on_mouse_down("left", stop)
          .on_click(() => run("agent.focus", { terminal: needs[0].address }))
          .child(div().size(7).rounded_full().bg(t.blocked).loop("opacity", { from: 0.3, to: 1, period: 1400 }))
          .child(div().text_size(12.5).font_medium().text_color("#f9d0d9").child(needs.length === 1 ? "1 agent needs you" : `${needs.length} agents need you`))
          .child(keycap(t, "ctrl shift j"))));
  }
}
