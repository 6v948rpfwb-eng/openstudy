#!/bin/sh
# 开卷启动器：先确保本地服务在跑（记录要存在服务端才靠得住），再用 Safari 打开页面。
# 服务不在时自己拉起来，日志写 /tmp/openstudy-serve.log。

DIR="/Users/shulizhe/Documents/deepseek-harness/ai/openstudy"
ELECTRON="/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"
URL="http://127.0.0.1:8770/openstudy-data/openstudy.html"

if ! curl -s -m 2 -o /dev/null "http://127.0.0.1:8770/api/state?subject=physics"; then
  cd "$DIR" || exit 1
  ELECTRON_RUN_AS_NODE=1 nohup "$ELECTRON" serve.js >/tmp/openstudy-serve.log 2>&1 &
  i=0
  while [ $i -lt 30 ]; do
    sleep 0.2
    if curl -s -m 1 -o /dev/null "http://127.0.0.1:8770/api/state?subject=physics"; then break; fi
    i=$((i + 1))
  done
fi

open -a Safari "$URL"
