// What the Graph reads from git. `git(args)` runs git in the repo (already read-only: the caller
// adds READ), so node can test this against real repos.
import { LOG_FORMAT, parseLog, layoutGraph } from "./graph.js";

const LIMIT = 300;
const out = async (git, args) => { const r = await git(args); return r.code === 0 ? r.stdout.trim() : null; };
const exists = async (git, ref) => (await out(git, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])) !== null;

// origin/HEAD, then origin/main, origin/master, main, master.
export async function detectBase(git, _current) {
  const remote = await out(git, ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"]);
  if (remote && await exists(git, remote)) return remote;
  for (const ref of ["origin/main", "origin/master", "main", "master"]) if (await exists(git, ref)) return ref;
  return null;
}

const upstreamOf = (git) => out(git, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);

// Changes when HEAD, its upstream or the base moves.
export async function graphKey(git) {
  const base = await detectBase(git);
  const shas = await Promise.all(["HEAD", "@{u}", base].map((ref) => (ref ? out(git, ["rev-parse", "--verify", "--quiet", ref]) : null)));
  return [...shas, base].map((s) => s ?? "-").join(" ");
}

export async function loadGraph(git) {
  const empty = { rows: [], branchName: null, upstream: null, base: null, ahead: null, behind: null };
  const head = await out(git, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (!head) return { ...empty, key: await graphKey(git) };
  const branchName = await out(git, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const upstream = branchName ? await upstreamOf(git) : null;
  const base = await detectBase(git, branchName);

  let ahead = null, behind = null;
  if (upstream) {
    const counts = await out(git, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
    if (counts) [ahead, behind] = counts.split(/\s+/).map(Number);
  }

  // The local base rides along in base's lane when base is origin's.
  const localBase = base?.startsWith("origin/") && await exists(git, base.slice(7)) ? base.slice(7) : null;
  const onBase = Boolean(base) && (branchName === base || `origin/${branchName}` === base);
  const tips = [...new Set(["HEAD", upstream].filter(Boolean))], bases = [base, localBase].filter(Boolean);

  // Your side first (everything base doesn't have), then base's: a busy base can't push HEAD out,
  // and the order stays children-before-parents.
  const log = async (refs, n) => {
    if (n <= 0) return [];
    const r = await git(["log", "--topo-order", `-n${n}`, `--format=${LOG_FORMAT}`, ...refs, "--"]);
    if (r.code !== 0) throw new Error(r.stderr.trim());
    return parseLog(r.stdout);
  };
  const mine = await log(onBase || !base ? [...tips, ...bases] : [...tips, "--not", ...bases], LIMIT);
  const seen = new Set(mine.map((c) => c.sha));
  const commits = onBase || !base ? mine : [...mine, ...(await log(bases, LIMIT - mine.length)).filter((c) => !seen.has(c.sha))];

  // Born: the first parent of the oldest commit on HEAD's first-parent chain that base lacks.
  const own = base && !onBase ? ((await out(git, ["rev-list", "--first-parent", "HEAD", "--not", base])) ?? "").split("\n").filter(Boolean) : [];
  const fork = own.length ? await out(git, ["rev-parse", "--verify", "--quiet", `${own[own.length - 1]}^`]) : null;
  const branch = new Set(own.length ? own : ((await out(git, ["rev-list", "--first-parent", `-n${LIMIT}`, "HEAD"])) ?? "").split("\n").filter(Boolean));
  const baseSha = base ? await out(git, ["rev-parse", "--verify", "--quiet", base]) : null;

  const rows = layoutGraph(commits, { head, branch, base: baseSha, fork });
  return { rows, branchName, upstream, base, ahead, behind, key: await graphKey(git) };
}

// Files a commit changed; a merge against its first parent (what it brought in).
export async function commitFiles(git, sha, merge) {
  const range = merge ? ["diff", "--no-renames", `${sha}^1`, sha] : ["show", "--no-renames", "--format=", sha];
  const [numstat, names] = await Promise.all([git([...range, "--numstat", "-z"]), git([...range, "--name-status", "-z"])]);
  if (numstat.code !== 0) throw new Error(numstat.stderr.trim());
  const status = {}, parts = names.stdout.split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2) status[parts[i + 1]] = parts[i][0] === "D" ? "D" : parts[i][0] === "A" ? "A" : "M";
  return numstat.stdout.split("\0").filter(Boolean).map((entry) => {
    const [a, d, ...path] = entry.split("\t"), p = path.join("\t");
    return { path: p, status: status[p] ?? "M", add: Number(a) || 0, del: Number(d) || 0 };
  });
}

export const commitDiffArgs = (sha, path, merge) => merge
  ? ["diff", "--no-ext-diff", "--no-textconv", "--no-color", `${sha}^1`, sha, "--", path]
  : ["show", "--format=", "--no-ext-diff", "--no-textconv", "--no-color", sha, "--", path];
