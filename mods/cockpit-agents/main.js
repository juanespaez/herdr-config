// Agent cockpit panel: a constellation of every agent and a card for each,
// most urgent first. Click a card to jump to that agent.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, run, theme, setAgentOrder, focused } from "herdr";
import { glyph } from "./glyph.js";
import { info, accountName, prettyModel, refresh } from "./who.js";

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const CHIP = { blocked: "NEEDS YOU", working: "WORKING", done: "DONE", idle: "IDLE" };
const MONO = "JetBrains Mono";
const ACCT = { prime: "#c9b6f2", team: "#e8c07a", pechiche: "#7ad1b0" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export default class CockpitAgents extends View {
  init(_props, cx) {
    // When each agent last changed state (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    cx.timer.every(30000, (cx) => cx.notify());
    // Which account and model each agent runs: looked up in the background.
    const look = (cx) => refresh(agents().map((a) => a.address)).then((changed) => changed && cx.notify());
    look(cx);
    cx.timer.every(5000, look);
  }

  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (dirty) localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  name(a) {
    return `${accountName(a.address, a.program?.name ?? "Agent")} · ${a.space_name}`;
  }

  constellation(t, list) {
    const W = 312, H = 206, cx = W / 2, cy = H / 2 - 4;
    const n = list.length;
    const orbit = (r) => div().absolute().left(cx - r).top(cy - r).size(r * 2).rounded_full().border(1).border_dashed().border_color(t.selected);
    const root = div().relative().w_full().h(H).rounded(12).bg("#120d0c").border(1).border_color("#2a2120").overflow_hidden()
      .child(orbit(92)).child(orbit(52));
    list.forEach((a, i) => {
      const color = t[a.status] ?? t.dim;
      const r = n === 1 ? 0 : 66;
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      const x = cx + r * Math.cos(ang), y = cy + r * Math.sin(ang);
      const node = div().id(`node-${a.address}`).absolute().left(x - 18).top(y - 18).size(36).cursor_pointer()
        .on_click(() => run("agent.focus", { terminal: a.address }))
        .child(glyph(a.status, 36, color));
      root.child(node);
      root.child(div().absolute().left(x - 44).top(y + 21).w(88).text_center().truncate().text_size(10.5)
        .font_family(MONO).text_color(t.muted).child(a.space_name));
    });
    if (!n) root.child(div().size_full().flex().items_center().justify_center().text_size(12).text_color(t.dim).child("No agents running"));
    return root;
  }

  card(t, a, now, shownAddr) {
    const color = t[a.status] ?? t.dim;
    const since = this.changed[a.address]?.at;
    const detail = a.status === "blocked" ? "Waiting for you. Open it to answer."
      : a.status === "working" ? `Working${since ? ` · ${duration(now - since)}` : ""}`
      : a.status === "done" ? `Finished${since ? ` · ${duration(now - since)} ago` : ""}`
      : "";
    const needs = a.status === "blocked";
    const on = a.address === shownAddr;
    return h_flex()
      .id(`card-${a.address}`)
      .flex_none().gap(12).p(14).rounded(14).cursor_pointer()
      .border(1).border_color(needs ? color : a.status === "idle" ? t.input : t.selected)
      .when(a.status === "idle", (el) => el.border_dashed())
      .bg(needs ? color + "12" : on ? t.raised : t.popover)
      .hover((el) => el.bg(t.raised))
      .on_click(() => run("agent.focus", { terminal: a.address }))
      .child(glyph(a.status, 40, color))
      .child(v_flex().flex_1().min_w(0).gap(6)
        .child(h_flex().items_center().justify_between().gap(8)
          .child(div().truncate().text_size(14.5).font_semibold().text_color(t.foreground).child(this.name(a)))
          .child(div().flex_none().text_size(10.5).font_semibold().font_family(MONO).text_color(color).child(CHIP[a.status] ?? "")))
        .when(Boolean(detail), (el) => el.child(div().text_size(12.5).text_color(t.muted).child(detail)))
        .when(Boolean(info(a.address)?.model), (el) => el.child(
          h_flex().gap(6).items_center()
            .child(div().size(6).rounded_full().bg(ACCT[info(a.address).account] ?? ACCT.team))
            .child(div().truncate().text_size(11.5).font_family(MONO).text_color(t.dim).child(prettyModel(info(a.address).model)))))
        .when(a.status === "working", (el) => el.child(
          div().h(4).rounded(2).bg(t.selected).overflow_hidden()
            .child(div().h(4).rounded(2).bg(color).w(60).loop("left", { from: 0, to: 180, period: 1800 }))))
        .when(needs, (el) => el.child(
          h_flex().gap(8).mt(2)
            .child(div().id(`open-${a.address}`).h(30).px(14).rounded(8).bg(color).text_color("#3a1420").text_size(13).font_semibold()
              .flex().items_center().cursor_pointer().hover((s) => s.opacity(0.88))
              .on_click(() => run("agent.focus", { terminal: a.address })).child("Open")))));
  }

  render() {
    const t = theme();
    const now = Date.now();
    let list = agents();
    this.track(list, now);
    list = [...list].sort((x, y) => (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0) || y.seq - x.seq);
    setAgentOrder(list.map((a) => a.address));
    const shown = focused()?.agent;
    return v_flex().size_full().p(14).gap(12).bg(t.surface)
      .child(h_flex().items_center().justify_between().px(2)
        .child(div().text_size(11).font_semibold().font_family(MONO).text_color(t.dim).child("AGENTS"))
        .child(div().text_size(11).font_family(MONO).text_color(t.dim).child(String(list.length))))
      .child(this.constellation(t, list))
      .child(v_flex().id("cards").flex_1().min_h(0).gap(10).overflow_y_scrollbar()
        .children(list.map((a) => this.card(t, a, now, shown))));
  }
}
