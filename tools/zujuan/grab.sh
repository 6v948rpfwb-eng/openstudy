#!/bin/bash
# 用法: ./grab.sh <输出json>   —— 抓 Safari 当前标签页的组卷网试卷
set -e
out="${1:-/tmp/zujuan-paper.json}"
osascript -e 'set js to (do shell script "cat '"$(dirname "$0")"'/grab.js")
tell application "Safari" to do JavaScript js in current tab of front window' > "$out"
python3 - "$out" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
figs=[u for q in d['questions'] for u in q['imgs'] if 'formula' not in u]
print(f"{d['title']} | {len(d['questions'])} 题 | 插图 {len(figs)} | 公式图 {sum(len(q['imgs']) for q in d['questions'])-len(figs)}")
PY
