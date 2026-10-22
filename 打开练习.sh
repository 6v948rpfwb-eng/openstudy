#!/bin/bash
# 打开练习页面。
#
# 为什么不用 python -m http.server：
#   静态服务器只能发文件、收不了 POST，做题记录就只能躺在浏览器里。
#   这里用 serve.js，多两个接口：/api/sync 把记录写进硬盘，/api/ask 记下你的提问。
#
# 存档目录写在 .env.local 的 OPENSTUDY_STORE 里（那个文件不进仓库）。

set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env.local ]; then . ./.env.local; fi

PORT="${OPENSTUDY_PORT:-8770}"
BASE="http://127.0.0.1:${PORT}"
# 参数：学科代号（physics / chemistry），默认 physics
SUBJECT="${1:-physics}"
URL="${BASE}/openstudy-data/openstudy-${SUBJECT}.html"

NODE="${OPENSTUDY_NODE:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node}"
if [ ! -x "$NODE" ]; then
  NODE="$(command -v node || true)"
fi
if [ -z "$NODE" ]; then
  echo "找不到 node，无法启动服务器。" >&2
  echo "装一个 node，或在 .env.local 里写 OPENSTUDY_NODE=/path/to/node" >&2
  exit 1
fi

if curl -s -o /dev/null --max-time 1 "${BASE}/api/health"; then
  echo "服务器已在运行：${URL}"
else
  echo "启动本地服务器（端口 ${PORT}）…"
  ARGS=(serve.js --port "${PORT}")
  if [ -n "${OPENSTUDY_STORE:-}" ]; then ARGS+=(--store "${OPENSTUDY_STORE}"); fi
  nohup "$NODE" "${ARGS[@]}" > /tmp/openstudy-server.log 2>&1 &
  for _ in $(seq 1 40); do
    if curl -s -o /dev/null --max-time 1 "${BASE}/api/health"; then break; fi
    sleep 0.2
  done
  echo "已启动：${URL}"
  echo "存档目录：${OPENSTUDY_STORE:-(未设置，落在 openstudy-data/store)}"
fi

open "${URL}"
