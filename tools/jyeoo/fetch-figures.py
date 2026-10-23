#!/usr/bin/env python3
"""把题库里的 figureHint 下载成本地配图（写回 figure 字段）。
用法: fetch-figures.py <bank.json> <subject> [--limit N]"""
import json, os, sys, urllib.request

bank_path, subject = sys.argv[1], sys.argv[2]
limit = int(sys.argv[sys.argv.index('--limit')+1]) if '--limit' in sys.argv else 9999
base = os.path.dirname(os.path.dirname(os.path.abspath(bank_path)))
figdir = os.path.join(base, 'figures', subject)
os.makedirs(figdir, exist_ok=True)

bank = json.load(open(bank_path, encoding='utf8'))
done = skip = fail = 0
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
for q in bank['questions']:
    url = q.pop('figureHint', None)
    if not url or q.get('figure'):
        continue
    if done >= limit:
        q['figureHint'] = url
        continue
    name = q['id'] + '.jpg'
    path = os.path.join(figdir, name)
    if os.path.exists(path):
        q['figure'] = f'figures/{subject}/{name}'; skip += 1; continue
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': 'https://www.jyeoo.com/'})
        data = urllib.request.urlopen(req, timeout=25).read()
        if len(data) < 500:
            raise ValueError('too small')
        open(path, 'wb').write(data)
        q['figure'] = f'figures/{subject}/{name}'; done += 1
    except Exception as e:
        q['figureHint'] = url; fail += 1
        print('FAIL', q['id'], e)
json.dump(bank, open(bank_path, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print(f'下载 {done}，已有 {skip}，失败 {fail}，题库 {len(bank["questions"])} 题')
