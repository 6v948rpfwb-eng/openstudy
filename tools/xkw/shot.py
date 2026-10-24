#!/usr/bin/env python3
"""把组卷网试卷页按屏截图，便于一次性读题判答案。

用法: python3 shot.py <试卷URL> <输出目录> [每次滚动像素]
"""
import json, os, subprocess, sys, time
import grab

url, out = sys.argv[1], sys.argv[2]
step = int(sys.argv[3]) if len(sys.argv) > 3 else 800
os.makedirs(out, exist_ok=True)
for f in os.listdir(out):
    if f.endswith('.png'):
        os.remove(os.path.join(out, f))

grab.run_js(f'location.href="{url}"')
time.sleep(8)
grab.run_js('window.scrollTo(0,0)')
time.sleep(1)
WID = subprocess.run(['osascript', '-e', 'tell application "Safari" to id of front window'],
                      capture_output=True, text=True).stdout.strip()

y = 0
for i in range(14):
    grab.run_js(f'window.scrollTo(0,{y})')
    time.sleep(1.3)
    st = json.loads(grab.run_js('JSON.stringify([window.scrollY, document.body.scrollHeight, window.innerHeight])'))
    subprocess.run(['screencapture', '-x', f'-l{WID}', os.path.join(out, f'{i:02d}.png')], check=False)
    print(f'  屏 {i} scrollY={st[0]} 总高={st[1]}')
    if st[0] + st[2] >= st[1] - 10:
        break
    y += step
print('完成', out)
