#!/usr/bin/env bash
# Installs this Herdr config into ~/.config/herdr-app (backs up what it replaces).
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${HERDR_CONFIG_DIR:-$HOME/.config/herdr-app}"
BACKUP="$DEST/.backup-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$DEST/mods" "$DEST/layouts" "$DEST/themes" "$BACKUP"

backup() { [ -e "$DEST/$1" ] && mkdir -p "$BACKUP/$(dirname "$1")" && cp -R "$DEST/$1" "$BACKUP/$1" || true; }

for f in keys.json settings.json layouts/cockpit.json layouts/my-main.json themes/cockpit.json; do
  backup "$f"
done
for m in "$SRC"/mods/*/; do backup "mods/$(basename "$m")"; done

cp -R "$SRC"/mods/. "$DEST/mods/"
cp "$SRC"/layouts/*.json "$DEST/layouts/"
cp "$SRC"/themes/*.json "$DEST/themes/"
cp "$SRC/settings.json" "$DEST/settings.json"
# keys.json uses __HOME__ because Herdr runs argv without a shell ($HOME would not expand).
sed "s#__HOME__#$HOME#g" "$SRC/keys.json" > "$DEST/keys.json"

echo "Installed into $DEST (previous files backed up to $BACKUP)."
echo "Restart Herdr, then pick the 'cockpit' layout (cmd-shift-l)."
