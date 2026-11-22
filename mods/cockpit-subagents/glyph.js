// The agent creature: a small face whose motion tells its status.
// blocked: hops and pulses a ring · working: spinning ring, eyes scan ·
// idle: slow blink and a floating z · done: happy eyes and a tick.
import { div, svg } from "gpui-kit";

export function glyph(status, size, color) {
  const s = size / 48;
  const px = (v) => v * s;
  const part = (x, y, w, h, r) =>
    div().absolute().left(px(x)).top(px(y)).w(px(w)).h(px(h)).rounded(px(r));

  const g = div().absolute().left(0).top(0).w(size).h(size);
  if (status === "blocked") g.loop("top", { from: 0, to: -px(3), period: 900 });

  const ear = (x) => part(x, 9, 6, 9, 3).bg(color + "99");
  g.child(ear(13)).child(ear(29));
  g.child(part(8, 14, 32, 27, 11).bg(color + "1f").border(Math.max(1, px(1.7))).border_color(color));

  if (status === "done") {
    for (const x of [15, 27]) {
      g.child(div().absolute().left(px(x)).top(px(20)).text_size(px(15)).font_bold().text_color(color).child("^"));
    }
  } else {
    for (const x of [16, 27]) {
      const eye = part(x, status === "idle" ? 27 : 23, 5, status === "idle" ? 7 : 9, 2.5).bg(color);
      if (status === "working") eye.loop("left", { from: px(x - 2), to: px(x + 2), period: 1600 });
      if (status === "idle") eye.loop("height", { from: px(7), to: px(1.5), period: 5200 });
      g.child(eye);
    }
  }

  const box = div().relative().flex_none().w(size).h(size).child(g);
  if (status === "blocked") {
    box.child(
      div().absolute().left(-px(4)).top(-px(4)).w(size + px(8)).h(size + px(8)).rounded_full()
        .border(1).border_color(color).loop("opacity", { from: 0.1, to: 0.75, period: 1600 }));
  }
  if (status === "working") {
    box.child(svg("mods/workspace-chrome/spinner.svg").absolute().left(0).top(0).size(size).text_color(color).spin(1400));
  }
  if (status === "idle") {
    box.child(div().absolute().left(px(38)).top(0).text_size(px(11)).font_semibold().text_color(color)
      .loop("opacity", { from: 0, to: 0.9, period: 3600 }).child("z"));
  }
  if (status === "done") {
    box.child(div().absolute().left(px(34)).top(-px(2)).size(px(16)).rounded_full().bg(color)
      .flex().items_center().justify_center().text_size(px(10)).font_bold().text_color("#15100f").child("✓"));
  }
  return box;
}
