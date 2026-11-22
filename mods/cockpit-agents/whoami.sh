#!/bin/sh
# whoami.sh <terminal>  ->  "<account>|<model>"
# account: prime (~/.claude-personal), team (~/.claude), pechiche (~/.claude-pechiche), or empty.
# model:   the model id of the last assistant message in that session, or empty.
addr="$1"
pid=$(hc get "$addr" 2>/dev/null | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get("foreground",{}).get("pid",""))
except Exception:
    pass')
[ -z "$pid" ] && { echo "|"; exit 0; }
for pair in "prime:$HOME/.claude-personal" "team:$HOME/.claude" "pechiche:$HOME/.claude-pechiche"; do
  acct=${pair%%:*}; dir=${pair#*:}
  f="$dir/sessions/$pid.json"
  [ -f "$f" ] || continue
  sid=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("sessionId",""))' "$f")
  t=$(ls "$dir"/projects/*/"$sid".jsonl 2>/dev/null | head -1)
  model=""
  [ -n "$t" ] && model=$(tail -c 400000 "$t" | grep -o '"model":"[^"]*"' | grep -v synthetic | tail -1 | cut -d'"' -f4)
  [ -z "$model" ] && model=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("model",""))' "$dir/settings.json" 2>/dev/null)
  echo "$acct|$model"
  exit 0
done
echo "|"
