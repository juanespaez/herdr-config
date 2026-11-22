// Claude Code's own subagents (the Agent tool). They run inside the Claude process, so herdr has no
// terminal for them; claude_subs.py reads the files Claude Code leaves for each one.
import { exec, appHome } from "herdr";

const cache = {};

// Subagents of the Claude session running in terminal `addr`, as synthetic rows the panel can draw.
export const claudeSubs = (addr) => cache[addr] ?? [];

// Look each address up (one at a time). Returns true when anything changed.
export async function refreshClaude(addrs) {
  let changed = false;
  for (const addr of addrs) {
    try {
      const r = await exec("python3", [`${appHome()}/mods/cockpit-subagents/claude_subs.py`, addr], { timeout: 8000 });
      const list = JSON.parse(r.stdout.trim() || "[]").map((s) => ({
        address: `claude:${addr}:${s.id}`,
        name: s.name,
        status: s.status,
        report: s.said,
        model: s.model,
        agentType: s.type,
        synthetic: true,
      }));
      if (JSON.stringify(list) !== JSON.stringify(cache[addr] ?? [])) { cache[addr] = list; changed = true; }
    } catch (_e) { /* terminal gone or lookup failed: keep what we had */ }
  }
  return changed;
}
