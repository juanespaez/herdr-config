#!/usr/bin/env bash
# Installs this Herdr setup into ~/.config/herdr-app.
# Anything it would overwrite is first copied to <dest>/.backup-<timestamp>/.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${HERDR_CONFIG_DIR:-$HOME/.config/herdr-app}"
BACKUP="$DEST/.backup-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$DEST" "$BACKUP"

# Everything in the repo except repo-only files.
for item in "$SRC"/* "$SRC"/.[!.]*; do
  name="$(basename "$item")"
  case "$name" in install.sh|README.md|.git|.gitignore|.DS_Store|keys.json) continue ;; esac
  [ -e "$item" ] || continue
  if [ -d "$item" ]; then
    # Back up only the files that already exist and would be replaced.
    (cd "$item" && find . -type f) | while read -r f; do
      [ -e "$DEST/$name/$f" ] && mkdir -p "$BACKUP/$name/$(dirname "$f")" && cp "$DEST/$name/$f" "$BACKUP/$name/$f" || true
    done
    mkdir -p "$DEST/$name"
    cp -R "$item"/. "$DEST/$name/"
  else
    [ -e "$DEST/$name" ] && cp "$DEST/$name" "$BACKUP/$name" || true
    cp "$item" "$DEST/$name"
  fi
done

# keys.json uses __HOME__ because Herdr runs argv without a shell ($HOME would not expand).
[ -e "$DEST/keys.json" ] && cp "$DEST/keys.json" "$BACKUP/keys.json" || true
sed "s#__HOME__#$HOME#g" "$SRC/keys.json" > "$DEST/keys.json"

rmdir "$BACKUP" 2>/dev/null || true
echo "Installed into $DEST"
[ -d "$BACKUP" ] && echo "Previous files backed up to $BACKUP"
echo "Restart Herdr. The cockpit layout is already selected (switch with cmd-shift-l)."
