#!/usr/bin/env python3
"""快速探测一份卷的前 2 道题是否有答案（免费可见）。"""
import json, re, sys, time
import grab

def qids_of(url):
    grab.run_js(f'location.href="{url}"')
    time.sleep(7)
    m = re.search(r'/(\d+)p\d+\.html', url)
    pre = m.group(1)
    return pre, json.loads(grab.run_js(
        f'JSON.stringify([...new Set((document.documentElement.innerHTML.match(/{pre}q(\\\\d{{6,}})/g)||[]).map(s=>s.slice({len(pre)+1})))].slice(0,2)))'))

for url in sys.argv[1:]:
    try:
        pre, qs = qids_of(url)
        ok = 0
        for q in qs:
            grab.run_js(f'location.href="https://zujuan.xkw.com/{pre}q{q}.html"')
            time.sleep(8)
            n = json.loads(grab.run_js('JSON.stringify(performance.getEntriesByType("resource").map(e=>e.name).filter(u=>/Answer|Parse/.test(u)).length)'))
            ok += 1 if n else 0
        print(f'{url.split("/")[-1]:22s} 前2题有答案 {ok}/2')
    except Exception as e:
        print(url, 'ERR', e)
