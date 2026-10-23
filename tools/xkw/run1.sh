#!/bin/bash
# 单卷全流程：抓题 → 抓答案 → 入库
set -u
SUBJ=$1; URL=$2; BANK=$3
TAG=$(echo "$URL" | sed -E 's#.*/([0-9]+)p([0-9]+)\.html#\2#')
cd "$(dirname "$0")"
echo "=== $SUBJ $TAG"
/usr/bin/python3 grab.py paper "$URL" --out "/tmp/xk-$SUBJ-$TAG.json" >/dev/null 2>&1 || { echo "grab 失败"; exit 1; }
/usr/bin/python3 -c "
import json,sys
d=json.load(open('/tmp/xk-$SUBJ-$TAG.json'))
print('  题目', len(d['questions']))" || { echo "解析失败"; exit 1; }
/usr/bin/python3 collect.py "$URL" --subject "$SUBJ" --out "/tmp/xk-$SUBJ-$TAG-a.json" 2>&1 | tail -2
/usr/bin/python3 build.py --q "/tmp/xk-$SUBJ-$TAG.json" --a "/tmp/xk-$SUBJ-$TAG-a.json" --bank "$BANK" --subject "$SUBJ" 2>&1 | tail -1
