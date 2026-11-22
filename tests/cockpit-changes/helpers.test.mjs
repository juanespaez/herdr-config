import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, makeRemote, commit } from "./helpers.mjs";

test("makeRepo makes a repo git can commit to", async () => {
  const repo = makeRepo();
  commit(repo, "first");
  const r = await repo.git(["log", "--oneline"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim().split("\n").length, 1);
});

test("makeRemote sets origin/HEAD", () => {
  const repo = makeRepo();
  commit(repo, "first");
  makeRemote(repo);
  assert.equal(repo.sh("git symbolic-ref --short refs/remotes/origin/HEAD").trim(), "origin/main");
});
