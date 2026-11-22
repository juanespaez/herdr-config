// The branch graph, as data: parse `git log`, find where the branch was born, and give every
// commit a lane. No herdr or gpui imports, so node can test it.

// Fields end in \x1f and records in \x1e: no subject can contain them.
export const LOG_FORMAT = "%H%x1f%P%x1f%s%x1f%an%x1f%at%x1f%D%x1e";

export function parseLog(stdout) {
  return stdout.split("\x1e").map((r) => r.replace(/^\n/, "")).filter(Boolean).map((record) => {
    const [sha, parents, subject, author, time, refs] = record.split("\x1f");
    return {
      sha, subject, author, time: Number(time),
      parents: parents ? parents.split(" ") : [],
      refs: (refs ?? "").split(", ").filter((r) => r && r !== "HEAD").map((r) => r.replace(/^HEAD -> /, "")),
    };
  });
}

// The first commit on HEAD's first-parent chain that base can reach: where the branch was made,
// even after base was merged into it.
export const findForkPoint = (firstParents, inBase) => firstParents.find((sha) => inBase.has(sha)) ?? null;

const MAX_COL = 7;

// One row per commit: its lane (col), the lines that enter it from above (top) and the lines that
// leave it downwards (bottom). A segment runs from column `from` to column `to`; a straight one
// passes through. The current branch keeps lane 0; the commit it was born from stays in base's lane
// and lane 0 curves into it.
export function layoutGraph(commits, { head, branch, base, fork }) {
  const active = head ? [{ sha: head, color: "branch", above: false }] : [];
  // Base's own history (its first-parent chain) is base-colored wherever a lane for it opens.
  const bySha = new Map(commits.map((c) => [c.sha, c])), baseChain = new Set();
  for (let sha = base; sha && !baseChain.has(sha); sha = bySha.get(sha)?.parents[0]) baseChain.add(sha);
  let rotation = 0;
  const colorFor = (sha) => (sha === head || branch.has(sha) ? "branch" : baseChain.has(sha) ? "base" : rotation++);
  const free = () => { const i = active.findIndex((a) => !a); return i < 0 ? active.length : i; };

  const rows = commits.map((commit) => {
    const { sha, parents } = commit;
    const waiting = active.flatMap((a, i) => (a?.sha === sha ? [i] : []));
    let col = waiting[0], color;
    if (col === undefined) { col = free(); color = colorFor(sha); }
    else {
      if (col === 0 && !branch.has(sha) && waiting.length > 1) col = waiting[1];
      color = active[col].color;
    }

    const top = [];
    active.forEach((a, i) => {
      if (!a || !a.above) return;
      if (a.sha === sha) { top.push({ from: i, to: col, color: i === col ? color : a.color }); if (i !== col) active[i] = null; }
      else top.push({ from: i, to: i, color: a.color });
    });
    active[col] = null;

    const bottom = [];
    // Where a parent goes: the lane already waiting for it, unless it's on the branch (lane 0 keeps it).
    const elsewhere = (p) => active.findIndex((a, i) => a?.sha === p && i !== col);
    parents.forEach((p, n) => {
      const there = elsewhere(p);
      if (n === 0 && (there < 0 || branch.has(p))) {
        active[col] = { sha: p, color, above: true };
        bottom.push({ from: col, to: col, color });
      } else if (there >= 0) {
        bottom.push({ from: col, to: there, color: n === 0 ? color : active[there].color });
      } else {
        const i = free(), c = colorFor(p);
        active[i] = { sha: p, color: c, above: true };
        bottom.push({ from: col, to: i, color: c });
      }
    });
    active.forEach((a, i) => { if (a && a.above && i !== col && !bottom.some((s) => s.to === i && s.from === i)) bottom.push({ from: i, to: i, color: a.color }); });
    while (active.length && !active[active.length - 1]) active.pop();

    const node = sha === head ? "head" : parents.length > 1 ? "merge" : "commit";
    return clamp({ commit, col, color, node, fork: sha === fork, top, bottom });
  });
  return rows;
}

// Lanes past the eighth share the last one, drawn dim.
function clamp(row) {
  const seg = (s) => (s.from > MAX_COL || s.to > MAX_COL ? { from: Math.min(s.from, MAX_COL), to: Math.min(s.to, MAX_COL), color: "overflow" } : s);
  const over = row.col > MAX_COL;
  return { ...row, col: Math.min(row.col, MAX_COL), color: over ? "overflow" : row.color, top: row.top.map(seg), bottom: row.bottom.map(seg) };
}

// The lines that carry on under a row: what an expanded commit's extra rows draw.
export function through(row) {
  const seen = new Set();
  return row.bottom.filter((s) => !seen.has(s.to) && seen.add(s.to)).map((s) => ({ from: s.to, to: s.to, color: s.color }));
}
