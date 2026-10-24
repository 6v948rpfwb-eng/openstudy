#!/bin/bash
# 用法: fetchpage.sh <url> <out.html>
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
CK=$(ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" "$(dirname "$0")/waf.js" "$1" 2>/dev/null)
curl -s -m 25 "$1" -H "User-Agent: $UA" -H "Referer: https://zujuan.xkw.com/" -H "Cookie: $CK" -o "$2" -w "%{http_code} %{size_download}\n"
