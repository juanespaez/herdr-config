// Keys sheet: the shortcuts as bound in keys.json. Toggle with ctrl shift /.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme } from "herdr";

const MONO = "JetBrains Mono";

const SECTIONS = [
  { title: "AGENTS", color: "working", rows: [
    ["Next tab", "ctrl tab"],
    ["Previous tab", "ctrl shift tab"],
    ["New Claude (personal)", "ctrl shift c"],
    ["New Claude 2 (Nheo)", "ctrl shift v"],
    ["New Claude Pechiche", "ctrl shift p"],
    ["Jump to waiting agent", "ctrl shift j"],
  ] },
  { title: "PANES", color: "ansi5", rows: [
    ["Terminal only", "ctrl shift t"],
    ["Files", "ctrl shift f"],
    ["Changes", "ctrl shift g"],
    ["Subagents", "ctrl shift s"],
    ["Focus left / right", "ctrl shift k l"],
    ["Focus up / down", "ctrl shift i m"],
    ["Swap", "ctrl alt k l i m"],
    ["Zoom / close", "ctrl shift e q"],
  ] },
  { title: "SPLIT", color: "blocked", rows: [
    ["Right / below", "ctrl shift n b"],
    ["Above / left", "ctrl shift u h"],
    ["New terminal tab", "ctrl shift o"],
  ] },
  { title: "SPACES", color: "done", rows: [
    ["New space", "ctrl shift w"],
    ["Next / previous", "ctrl shift z x"],
    ["Jump to space", "ctrl 1–9"],
    ["This sheet", "ctrl shift /"],
  ] },
];

export default class CockpitKeys extends View {
  render() {
    const t = theme();
    const kc = (s) => div().flex_none().px(6).h(20).rounded(5).bg(t.raised).border(1).border_color(t.input).flex().items_center()
      .text_size(11).font_family(MONO).text_color(t.foreground).child(s);
    const row = ([label, keys]) => v_flex().gap(5)
      .child(div().text_size(12.5).text_color(t.muted).child(label))
      .child(h_flex().gap(4).flex_wrap().children(keys.split(" ").map(kc)));
    const section = (s) => v_flex().gap(11)
      .child(div().text_size(11).font_semibold().font_family(MONO).text_color(t[s.color]).child(s.title))
      .children(s.rows.map(row));
    return v_flex().size_full().p(16).gap(16).bg(t.surface)
      .child(div().text_size(11).font_semibold().font_family(MONO).text_color(t.dim).child("KEYS"))
      .child(v_flex().id("keys-list").flex_1().min_h(0).gap(18).overflow_y_scrollbar().children(SECTIONS.map(section)));
  }
}
