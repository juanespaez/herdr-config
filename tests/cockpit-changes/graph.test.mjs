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
