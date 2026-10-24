#!/bin/bash
set -u
B=/Users/shulizhe/Documents/deepseek-harness/ai/openstudy/openstudy-data
run() { ./run1.sh "$1" "$2" "$B/$1.bank.json" 2>&1 | tail -2; }

echo "--- 化学 学军等校"; run chemistry "https://zujuan.xkw.com/14p3200789.html"
echo "--- 化学 强基联盟"; run chemistry "https://zujuan.xkw.com/14p2900155.html"
echo "--- 技术 稽阳联谊"; run technology "https://zujuan.xkw.com/28p3189271.html"
echo "--- 技术 江浙皖十月"; run technology "https://zujuan.xkw.com/28p3505440.html"
echo "--- 物理 七校联盟"; run physics "https://zujuan.xkw.com/13p3246347.html"
echo "--- 物理 嘉兴二模"; run physics "https://zujuan.xkw.com/13p3159919.html"
