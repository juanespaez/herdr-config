// Which Claude account and model an agent runs, looked up by whoami.sh and cached.
import { exec, appHome } from "herdr";

export const NAME = { prime: "Claude Prime", team: "Claude Team", pechiche: "Claude Pechiche" };
const cache = {};

// "claude-sonnet-5-5" -> "Sonnet 5.5"; an alias like "sonnet" -> "Sonnet".
export function prettyModel(id) {
  if (!id) return "";
  const m = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/);
  if (!m) return id.charAt(0).toUpperCase() + id.slice(1);
  return `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? "." + m[3] : ""}`;
}

export const info = (addr) => cache[addr];
export const accountName = (addr, fallback = "Claude Code") => NAME[cache[addr]?.account] ?? fallback;

// Look up each address (one at a time). Returns true when anything changed.
export async function refresh(addrs) {
  let changed = false;
  for (const addr of addrs) {
    try {
      const r = await exec("sh", [`${appHome()}/mods/cockpit-agents/whoami.sh`, addr], { timeout: 8000 });
      const [account = "", model = ""] = r.stdout.trim().split("|");
      const next = { account, model };
      const prev = cache[addr];
      if (!prev || prev.account !== account || prev.model !== model) { cache[addr] = next; changed = true; }
    } catch (_e) { /* terminal gone or lookup failed: keep what we had */ }
  }
  return changed;
}
