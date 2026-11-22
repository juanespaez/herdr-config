// Paints one row of the branch graph: the lane lines crossing it and the commit's node.
// paint_path draws in the coordinates of the element holding it (checked with a probe).
import { div, PathBuilder } from "gpui-kit";

const COL = 16, LEFT = 12;
const x = (col) => LEFT + col * COL;

export const laneWidth = (rows) => LEFT + COL * (1 + Math.max(0, ...rows.flatMap((r) => [r.col, ...r.top.map((s) => s.to), ...r.top.map((s) => s.from), ...r.bottom.map((s) => s.to)])));

const ROTATION = ["ansi3", "ansi5", "ansi6", "ansi2", "ansi1"];
export function colorOf(c, t) {
  if (c === "branch") return t.accent;
  if (c === "base") return t.ansi4;
  if (c === "overflow") return t.dim;
  return t[ROTATION[c % ROTATION.length]];
}

const layer = (path, color) => div().absolute().inset_0().child(window.paint_path(path, color));

// Straight lines, or an S curve when a segment changes column, between y0 and y1.
function line(b, s, y0, y1) {
  b.move_to(x(s.from), y0);
  if (s.from === s.to) return b.line_to(x(s.to), y1);
  const k = (y1 - y0) * 0.6;
  return b.cubic_bezier_to(x(s.to), y1, x(s.from), y0 + k, x(s.to), y1 - k);
}

// Four cubic quarters: arcs tessellate too coarsely at these sizes.
function circle(b, cx, cy, r) {
  const k = r * 0.5523;
  return b.move_to(cx + r, cy)
    .cubic_bezier_to(cx, cy + r, cx + r, cy + k, cx + k, cy + r)
    .cubic_bezier_to(cx - r, cy, cx - k, cy + r, cx - r, cy + k)
    .cubic_bezier_to(cx, cy - r, cx - r, cy - k, cx - k, cy - r)
    .cubic_bezier_to(cx + r, cy, cx + k, cy - r, cx + r, cy - k).close();
}

// segs: { top, bottom } (Seg[] from graph.js); node: { col, kind, color } or null for the rows
// under an expanded commit, which only carry lines through.
export function laneCell(segs, node, fork, h, t, width) {
  const mid = h / 2, layers = [], byColor = new Map();
  const add = (s, y0, y1) => { const c = colorOf(s.color, t); byColor.set(c, [...(byColor.get(c) ?? []), [s, y0, y1]]); };
  for (const s of segs.top) add(s, 0, node ? mid : h);
  for (const s of segs.bottom) add(s, node ? mid : 0, h);
  for (const [color, lines] of byColor) {
    const b = PathBuilder.stroke(2);
    for (const [s, y0, y1] of lines) line(b, s, y0, y1);
    layers.push(layer(b.build(), color));
  }
  if (node) {
    const cx = x(node.col), color = colorOf(node.color, t);
    if (node.kind === "commit") layers.push(layer(circle(PathBuilder.fill(), cx, mid, 4).build(), color));
    else {
      layers.push(layer(circle(PathBuilder.fill(), cx, mid, 5.5).build(), t.background));
      layers.push(layer(circle(PathBuilder.stroke(2), cx, mid, 5.5).build(), color));
      if (node.kind === "head") layers.push(layer(circle(PathBuilder.fill(), cx, mid, 2).build(), color));
    }
    if (fork) layers.push(layer(circle(PathBuilder.stroke(1.2).dash_array([2, 2]), cx, mid, 8).build(), t.accent));
  }
  return div().w(width).h(h).flex_none().relative().children(layers);
}
