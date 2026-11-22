import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLog, findForkPoint, LOG_FORMAT } from "../../mods/cockpit-changes/graph.js";

const rec = (sha, parents, subject, refs = "") => [sha, parents, subject, "Ann", "1700000000", refs].join("\x1f") + "\x1e";

test("LOG_FORMAT separates fields with control characters", () => {
  assert.equal(LOG_FORMAT, "%H%x1f%P%x1f%s%x1f%an%x1f%at%x1f%D%x1e");
});

test("parseLog keeps subjects with tabs, pipes and unicode intact", () => {
  const out = rec("a1", "b2", "fix:\ttabs | pipes ñ🚀") + "\n" + rec("b2", "", "root");
  const commits = parseLog(out);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].subject, "fix:\ttabs | pipes ñ🚀");
  assert.deepEqual(commits[0].parents, ["b2"]);
  assert.equal(commits[0].author, "Ann");
  assert.equal(commits[0].time, 1700000000);
});

test("parseLog turns 'HEAD -> x' into x and drops a bare HEAD", () => {
  const [c] = parseLog(rec("a1", "", "s", "HEAD -> feat/x, origin/feat/x, tag: v1"));
  assert.deepEqual(c.refs, ["feat/x", "origin/feat/x", "tag: v1"]);
  const [d] = parseLog(rec("a2", "", "s", "HEAD, main"));
  assert.deepEqual(d.refs, ["main"]);
});

test("parseLog gives a root commit no parents", () => {
  assert.deepEqual(parseLog(rec("r", "", "root"))[0].parents, []);
});

test("parseLog of empty output is empty", () => {
  assert.deepEqual(parseLog(""), []);
});

test("findForkPoint finds where the branch was born, not the last merge of base", () => {
  assert.equal(findForkPoint(["c7", "c6", "c5", "c4", "m1", "m0"], new Set(["m3", "m2", "m1", "m0"])), "m1");
});

test("findForkPoint without a match is null", () => {
  assert.equal(findForkPoint(["a", "b"], new Set(["x"])), null);
});

import { layoutGraph, through } from "../../mods/cockpit-changes/graph.js";

const C = (sha, ...parents) => ({ sha, parents, subject: sha, author: "Ann", time: 0, refs: [] });
const has = (segs, from, to) => segs.some((s) => s.from === from && s.to === to);

test("linear history stays in lane 0 with no curves", () => {
  const rows = layoutGraph([C("c", "b"), C("b", "a"), C("a")], { head: "c", branch: new Set(["c", "b", "a"]), base: null, fork: null });
  assert.deepEqual(rows.map((r) => r.col), [0, 0, 0]);
  assert.equal(rows[0].node, "head");
  assert.ok(rows.every((r) => [...r.top, ...r.bottom].every((s) => s.from === s.to)));
});

// The approved mockup: feat born at m1, main merged into feat at c5.
const mockup = () => layoutGraph(
  [C("c7", "c6"), C("c6", "c5"), C("m3", "m2"), C("c5", "c4", "m2"), C("m2", "m1"), C("c4", "m1"), C("m1", "m0"), C("m0")],
  { head: "c7", branch: new Set(["c7", "c6", "c5", "c4"]), base: "m3", fork: "m1" });

test("mockup: lanes, merge, birth curve and fork mark", () => {
  const rows = mockup();
  assert.deepEqual(rows.map((r) => r.col), [0, 0, 1, 0, 1, 0, 1, 1]);
  assert.equal(rows[3].node, "merge");
  assert.ok(has(rows[3].bottom, 0, 1));
  assert.ok(has(rows[5].bottom, 0, 1));
  assert.equal(rows[6].fork, true);
  assert.equal(rows.filter((r) => r.fork).length, 1);
  assert.equal(rows[0].color, "branch");
  assert.equal(rows[2].color, "base");
});

test("a branch merged into main gets its own lane and closes with a curve", () => {
  const rows = layoutGraph(
    [C("M", "m1", "f2"), C("f2", "f1"), C("m1", "m0"), C("f1", "m0"), C("m0")],
    { head: "M", branch: new Set(["M", "m1", "m0"]), base: "M", fork: null });
  const f2 = rows.find((r) => r.commit.sha === "f2");
  assert.equal(f2.col, 1);
  assert.equal(typeof f2.color, "number");
  assert.ok(rows.some((r) => has(r.top, 1, 0)));
});

test("more than 8 lanes fold into lane 7 as overflow", () => {
  const tips = Array.from({ length: 9 }, (_, i) => `p${i}`);
  const rows = layoutGraph([C("H", ...tips), ...tips.map((t) => C(t))], { head: "H", branch: new Set(["H"]), base: null, fork: null });
  for (const r of rows) {
    assert.ok(r.col <= 7);
    for (const s of [...r.top, ...r.bottom]) assert.ok(s.from <= 7 && s.to <= 7);
  }
  assert.ok(rows.some((r) => r.color === "overflow" || r.bottom.some((s) => s.color === "overflow")));
});

test("detached HEAD draws without a branch", () => {
  const rows = layoutGraph([C("x", "y"), C("y")], { head: "x", branch: new Set(), base: null, fork: null });
  assert.equal(rows[0].node, "head");
  assert.deepEqual(rows.map((r) => r.col), [0, 0]);
});

test("on the base branch everything is one lane and nothing is marked born", () => {
  const rows = layoutGraph([C("b", "a"), C("a")], { head: "b", branch: new Set(["b", "a"]), base: "b", fork: null });
  assert.deepEqual(rows.map((r) => r.col), [0, 0]);
  assert.ok(rows.every((r) => !r.fork));
});

test("through gives the straight lines that continue under a row", () => {
  const t = through(mockup()[1]);
  assert.equal(t.length, 1);
  assert.equal(t[0].from, 0);
  assert.equal(t[0].to, 0);
});

test("a lane opened by merging base's history is colored as base", () => {
  const rows = layoutGraph(
    [C("c3", "c2", "m2"), C("m3", "m2"), C("m2", "m1"), C("c2", "m1"), C("m1")],
    { head: "c3", branch: new Set(["c3", "c2"]), base: "m3", fork: "m1" });
  assert.equal(rows.find((r) => r.commit.sha === "m2").color, "base");
  assert.equal(rows.find((r) => r.commit.sha === "m3").color, "base");
});
