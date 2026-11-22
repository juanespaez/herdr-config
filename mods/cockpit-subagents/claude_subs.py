#!/usr/bin/env python3
"""claude_subs.py <terminal>  ->  JSON list of the Claude Code subagents of the session in that terminal.

Claude Code's Agent tool runs subagents inside its own process, so herdr sees no terminal for them.
It does leave a record: <config>/projects/*/<sessionId>/subagents/agent-<id>.{meta.json,jsonl}.
meta.json carries `finished: true` once it ends; the .jsonl's mtime says whether it is still moving.
Chain: terminal -> foreground pid (hc get) -> <config>/sessions/<pid>.json -> sessionId -> that folder.
Read-only. Prints [] when anything is missing: the panel just shows nothing.
"""
import glob, json, os, subprocess, sys, time

HOME = os.path.expanduser("~")
CONFIGS = [f"{HOME}/.claude-personal", f"{HOME}/.claude", f"{HOME}/.claude-pechiche"]
DONE_SHOWN_S = 300      # a finished subagent stays listed this long
WORKING_S = 600         # unfinished and silent longer than this: idle
GONE_S = 3600           # unfinished and silent longer than this: not listed


def foreground_pid(addr):
    try:
        out = subprocess.run(["hc", "get", addr], capture_output=True, text=True, timeout=5).stdout
        return json.loads(out).get("foreground", {}).get("pid")
    except Exception:
        return None


def last_said(path):
    """One short line: the last thing the subagent wrote or the tool it last called."""
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            f.seek(max(0, size - 200_000))
            lines = f.read().decode("utf-8", "ignore").splitlines()
    except OSError:
        return ""
    for raw in reversed(lines):
        try:
            d = json.loads(raw)
        except ValueError:
            continue
        if d.get("type") != "assistant":
            continue
        content = (d.get("message") or {}).get("content")
        if isinstance(content, str):
            return " ".join(content.split())[:100]
        for block in reversed(content or []):
            if block.get("type") == "tool_use":
                arg = next((str(v) for k, v in (block.get("input") or {}).items()
                            if k in ("command", "file_path", "pattern", "description", "prompt", "query")), "")
                return f'{block.get("name", "tool")}: {" ".join(arg.split())}'[:100]
            if block.get("type") == "text" and block.get("text", "").strip():
                return " ".join(block["text"].split())[:100]
    return ""


def main():
    pid = foreground_pid(sys.argv[1]) if len(sys.argv) > 1 else None
    if not pid:
        return []
    for cfg in CONFIGS:
        try:
            sid = json.load(open(f"{cfg}/sessions/{pid}.json")).get("sessionId")
        except (OSError, ValueError):
            continue
        if not sid:
            continue
        now, rows = time.time(), []
        for meta in glob.glob(f"{cfg}/projects/*/{sid}/subagents/agent-*.meta.json"):
            log = meta[: -len(".meta.json")] + ".jsonl"
            try:
                m = json.load(open(meta))
                idle_s = now - os.path.getmtime(log if os.path.exists(log) else meta)
            except (OSError, ValueError):
                continue
            if m.get("finished"):
                if idle_s > DONE_SHOWN_S:
                    continue
                status = "done"
            elif idle_s > GONE_S:
                continue
            else:
                status = "working" if idle_s <= WORKING_S else "idle"
            rows.append({
                "id": os.path.basename(meta).split(".")[0],
                "name": m.get("description") or m.get("agentType") or "subagent",
                "type": m.get("agentType", ""),
                "model": m.get("model", ""),
                "status": status,
                "said": last_said(log) if status != "done" else "finished",
                "age": int(idle_s),
            })
        rows.sort(key=lambda r: ({"working": 0, "idle": 1, "done": 2}[r["status"]], r["age"]))
        return rows
    return []


try:
    print(json.dumps(main()))
except Exception:
    print("[]")
