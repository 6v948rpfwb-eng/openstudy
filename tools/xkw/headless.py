#!/usr/bin/env python3
"""无窗口抓组卷网：用 /tmp/xkr/render（Swift WKWebView）执行 grab.py 的同一个 JS，不切屏幕。"""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
RENDER = "/tmp/xkr/render"
sys.path.insert(0, HERE)
import grab, xkhttp


def render(url, js, wait=8, cookies=True):
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as f:
        f.write(js); p = f.name
    ck = ""
    if cookies:
        c = xkhttp.safari_cookies()
        drop = {'acw_tc', 'alicgf_gfver', 'alicfw_gfver',
                'Hm_lvt_68fb48a14b4fce9d823df8a437386f93'}
        ck = "; ".join(f"{k}={v}" for k, v in c.items() if k not in drop)
    args = [RENDER, url, p, str(wait)]
    if ck:
        args.append(ck)
    out = subprocess.run(args, capture_output=True, text=True, timeout=120).stdout.strip()
    os.unlink(p)
    return out


def paper(url):
    raw = render(url, grab.JS_PAPER, 8)
    return json.loads(raw)


if __name__ == '__main__':
    d = paper(sys.argv[1])
    print(d['title'], len(d['questions']), '题')
    for q in d['questions'][:3]:
        print(' ', q['idx'], q['text'][:50])
