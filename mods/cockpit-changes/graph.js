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
