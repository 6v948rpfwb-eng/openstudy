#!/bin/bash
# 打开练习页面。
# 作用：如果本地服务器没在跑就起一个，然后在浏览器打开固定的网址。
# 固定用 http://127.0.0.1:8770 而不是双击 HTML，是为了让浏览器把作答记录
# 存到同一个 origin 下（file:// 打开时各浏览器隔离规则不一样，记录可能丢）。

set -euo pipefail
cd "$(dirname "$0")"

PORT=8770
URL="http://127.0.0.1:${PORT}/openstudy-data/openstudy-physics.html"

if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:${PORT}/"; then
  echo "服务器已在运行：${URL}"
else
  echo "启动本地服务器（端口 ${PORT}）…"
  nohup python3 -m http.server "${PORT}" --bind 127.0.0.1 >/tmp/openstudy-server.log 2>&1 &
  for _ in $(seq 1 30); do
    if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:${PORT}/"; then break; fi
    sleep 0.2
  done
  echo "已启动：${URL}"
fi

open "${URL}"
