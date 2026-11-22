// Throwaway git repos for the tests: real git, in temp folders.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, execFile } from "node:child_process";

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

export function makeRepo(branch = "main") {
  const dir = mkdtempSync(join(tmpdir(), "cc-repo-"));
  const sh = (cmd) => execFileSync("sh", ["-c", cmd], { cwd: dir, env: ENV, encoding: "utf8" });
  sh(`git init -q -b ${branch} && git config user.name Tester && git config user.email t@example.com && git config commit.gpgsign false`);
  const git = (args) => new Promise((resolve) =>
    execFile("git", args, { cwd: dir, env: ENV, encoding: "utf8", maxBuffer: 1 << 26 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr })));
  return { dir, sh, git };
}

// A bare origin for `repo`, with the current branch pushed and origin/HEAD set.
export function makeRemote(repo) {
  const bare = mkdtempSync(join(tmpdir(), "cc-origin-"));
  execFileSync("git", ["init", "-q", "--bare", bare], { env: ENV });
  repo.sh(`git remote add origin ${bare} && git push -q -u origin HEAD 2>/dev/null && git remote set-head origin -a >/dev/null`);
  return bare;
}

// A commit with a file named after the message, so every commit changes something.
export const commit = (repo, msg) => repo.sh(`echo "${msg}" > "${msg.replace(/\W+/g, "_")}.txt" && git add -A && git commit -q -m "${msg}" && git rev-parse HEAD`).trim();
