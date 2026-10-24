#!/usr/bin/env python3
"""紧凑打印一份抓好的卷子，便于逐题判答案。

用法: python3 show.py /tmp/xk-tech-3091027.json [起始序号] [结束序号]
"""
import json, re, sys

path = sys.argv[1]
a = int(sys.argv[2]) if len(sys.argv) > 2 else 1
b = int(sys.argv[3]) if len(sys.argv) > 3 else 999
d = json.load(open(path, encoding='utf8'))
print('卷:', d.get('title', '')[:60], '| 题数', len(d['questions']))
for i, q in enumerate(d['questions'], 1):
    if not (a <= i <= b):
        continue
    t = re.sub(r'\s+', ' ', q['text'])
    t = t.split('A．')[0].strip()
    print(f'\n[{i}] {t[:700]}')
    for j, o in enumerate(q.get('opts') or []):
        ot = re.sub(r'\s+', ' ', o['text']).strip()
        mark = ' <公式图>' if o.get('img') else ''
        print(f'   {"ABCDEFG"[j]}. {ot[:120]}{mark}')
    if q.get('figs'):
        print('   图:', ' | '.join(q['figs'][:3]))
