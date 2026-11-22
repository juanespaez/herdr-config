# herdr-config

My [Herdr](https://herdr.dev) setup: a **cockpit** layout, a warm dark theme, a handful of
mods, and a letter-only keymap (no arrow keys needed).

## What's inside

| Path | What it is |
| --- | --- |
| `layouts/cockpit.json` | The main layout: top bar, agents panel, subagents column, tabs, status, keys sheet. |
| `layouts/my-main.json` | Clone of the shipped `main` layout plus the invisible `keyhelper` mod. `cockpit` is built on it. |
| `themes/cockpit.json` | Warm dark theme (rose accent). |
| `mods/cockpit-top` · `cockpit-tabs` · `cockpit-status` | Chrome for the cockpit layout. |
| `mods/cockpit-agents` | Agents panel with creature glyphs and a "who am I" account badge. |
| `mods/cockpit-subagents` | Column listing Claude Code subagents of the focused agent. |
| `mods/cockpit-keys` | Keys cheat sheet (static text — update it if you change `keys.json`). |
| `mods/keyhelper` | Invisible mod that runs multi-step keys (terminal-only mode, panel toggles, split left/up). |
| `keys.json` | Keymap. |
| `settings.json` | Zoom, sounds, dark appearance. |

Only my own files are here. Herdr's shipped mods, layouts, icons and `.d.ts` files are not
included — Herdr provides those.

## Install

```sh
git clone https://github.com/juanespaez/herdr-config.git
cd herdr-config
./install.sh
```

The script copies everything into `~/.config/herdr-app` (override with `HERDR_CONFIG_DIR`)
and backs up any file it replaces to `~/.config/herdr-app/.backup-<timestamp>/`. Restart
Herdr and switch to the `cockpit` layout with `cmd-shift-l`.

## Keymap highlights

Designed for a small keyboard with no arrow keys, and to avoid plain `ctrl+letter` (zsh and
Claude Code need `ctrl-c/t/f/n`). Everything is `ctrl-shift` / `ctrl-alt` + letter, with
**i / k / l / m** as the up / left / right / down diamond.

| Keys | Action |
| --- | --- |
| `ctrl-shift-k/l/i/m` | Focus pane left / right / up / down |
| `ctrl-alt-k/l/i/m` | Swap pane left / right / up / down |
| `ctrl-shift-n` / `-b` / `-u` / `-h` | Split right / below / above / left |
| `ctrl-shift-q` | Close pane |
| `ctrl-shift-e` | Zoom pane |
| `ctrl-shift-t` | Terminal-only mode |
| `ctrl-shift-f` / `-g` | Toggle Files / Changes panel |
| `ctrl-shift-c` | New Claude Code tab (personal config) |
| `ctrl-shift-v` | New Claude Code tab (default config) |
| `ctrl-shift-p` | New Claude Code tab (second config) |
| `ctrl-shift-j` | Jump to a waiting agent |
| `ctrl-shift-s` | Toggle subagents column |
| `ctrl-shift-/` | Keys cheat sheet |
| `ctrl-tab` / `ctrl-shift-tab` | Next / previous tab (current space) |
| `ctrl-shift-z` / `-x` | Next / previous space |
| `ctrl-shift-w` | New space |

`keys.json` is the source of truth; check it for the full list.

## Make it yours

- **Claude accounts**: `keys.json` launches Claude Code with `CLAUDE_CONFIG_DIR` pointing at
  `~/.claude-personal` and `~/.claude-pechiche`. Change or remove those entries. The
  `cockpit-agents/whoami.sh` badge and `cockpit-subagents/claude_subs.py` look in the same
  directories (`~/.claude-personal`, `~/.claude`, `~/.claude-pechiche`) — edit the lists there.
- **Splitting left/up** isn't native to Herdr (right/down only); `keyhelper` fakes it by
  splitting then swapping.
- Not built: a "talking" agent state, animated constellation links, custom fonts.

## Requirements

Herdr with mod support (gpui-based app), macOS. `cockpit-subagents` needs `python3`.
