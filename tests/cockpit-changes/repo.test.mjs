import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, makeRemote, commit } from "./helpers.mjs";
import { detectBase, loadGraph, graphKey, commitFiles, commitDiffArgs } from "../../mods/cockpit-changes/repo.js";

test("detectBase follows origin/HEAD", async () => {
  const repo = makeRepo("main");
  commit(repo, "one");
  makeRemote(repo);
  assert.equal(await detectBase(repo.git, "main"), "origin/main");
});

test("detectBase falls back to a local master", async () => {
  const repo = makeRepo("master");
  commit(repo, "one");
  assert.equal(await detectBase(repo.git, "master"), "master");
});

test("detectBase is null when there is no known base", async () => {
  const repo = makeRepo("trunk");
  commit(repo, "one");
  assert.equal(await detectBase(repo.git, "trunk"), null);
});

test("loadGraph of a repo without commits is empty, not an error", async () => {
  const repo = makeRepo();
  const g = await loadGraph(repo.git);
  assert.deepEqual(g.rows, []);
});

test("loadGraph counts commits not pushed", async () => {
  const repo = makeRepo("main");
  commit(repo, "one");
  makeRemote(repo);
  repo.sh("git switch -q -c feat && git push -q -u origin feat 2>/dev/null");
  commit(repo, "two");
  commit(repo, "three");
  const g = await loadGraph(repo.git);
  assert.equal(g.branchName, "feat");
  assert.equal(g.ahead, 2);
  assert.equal(g.behind, 0);
});

test("loadGraph without upstream has no ahead/behind", async () => {
  const repo = makeRepo("main");
  commit(repo, "one");
  const g = await loadGraph(repo.git);
  assert.equal(g.ahead, null);
  assert.equal(g.upstream, null);
});

test("loadGraph on a detached HEAD has no branch name", async () => {
  const repo = makeRepo("main");
  const first = commit(repo, "one");
  commit(repo, "two");
  repo.sh(`git checkout -q ${first}`);
  const g = await loadGraph(repo.git);
  assert.equal(g.branchName, null);
  assert.equal(g.rows.find((r) => r.node === "head")?.commit.sha, first);
});

// The mockup, in real git: feat born at m1, then main merged into feat.
function mockupRepo() {
  const repo = makeRepo("main");
  commit(repo, "m0");
  const m1 = commit(repo, "m1");
  repo.sh("git switch -q -c feat");
  commit(repo, "c4");
  repo.sh("git switch -q main");
  commit(repo, "m2");
  repo.sh("git switch -q feat && git merge -q --no-edit main");
  commit(repo, "c6");
  commit(repo, "c7");
  repo.sh("git switch -q main");
  commit(repo, "m3");
  repo.sh("git switch -q feat");
  return { repo, m1 };
}

test("loadGraph marks where the branch was born even after merging main in", async () => {
  const { repo, m1 } = mockupRepo();
  const g = await loadGraph(repo.git);
  assert.equal(g.base, "main");
  const born = g.rows.filter((r) => r.fork);
  assert.equal(born.length, 1);
  assert.equal(born[0].commit.sha, m1);
  assert.equal(g.rows[0].col, 0);
});

test("loadGraph on the base branch marks nothing as born", async () => {
  const { repo } = mockupRepo();
  repo.sh("git switch -q main");
  const g = await loadGraph(repo.git);
  assert.ok(g.rows.every((r) => !r.fork));
});

test("commitFiles of a merge lists only what the merge brought in", async () => {
  const { repo } = mockupRepo();
  const merge = repo.sh("git rev-parse HEAD~2").trim();
  const files = await commitFiles(repo.git, merge, true);
  assert.deepEqual(files.map((f) => [f.path, f.status]), [["m2.txt", "A"]]);
  assert.equal(files[0].add, 1);
});

test("commitFiles of a plain commit", async () => {
  const { repo } = mockupRepo();
  const files = await commitFiles(repo.git, repo.sh("git rev-parse HEAD").trim(), false);
  assert.deepEqual(files.map((f) => [f.path, f.status, f.add, f.del]), [["c7.txt", "A", 1, 0]]);
});

test("commitDiffArgs gives a diff git can run", async () => {
  const { repo } = mockupRepo();
  const sha = repo.sh("git rev-parse HEAD").trim();
  const r = await repo.git(commitDiffArgs(sha, "c7.txt", false));
  assert.match(r.stdout, /^\+c7$/m);
  assert.ok(commitDiffArgs(sha, "x", true).includes(`${sha}^1`));
});

test("graphKey changes when HEAD moves", async () => {
  const { repo } = mockupRepo();
  const before = await graphKey(repo.git);
  commit(repo, "c8");
  assert.notEqual(await graphKey(repo.git), before);
});

test("loadGraph and graphKey only read", async () => {
  const { repo } = mockupRepo();
  const calls = [];
  const spy = (args) => { calls.push(args[0]); return repo.git(args); };
  await loadGraph(spy);
  await graphKey(spy);
  const WRITES = ["fetch", "pull", "push", "commit", "add", "update-index", "gc", "checkout", "switch", "merge", "reset"];
  assert.deepEqual(calls.filter((c) => WRITES.includes(c)), []);
});
