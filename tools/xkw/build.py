#!/usr/bin/env python3
"""把 grab.py（题干/选项/图）+ collect.py（答案图/字母）合成开卷题库条目

用法: python3 build.py --q /tmp/xk-one.json --a /tmp/xk-a.json --bank openstudy-data/physics.bank.json --subject physics
"""
import base64, json, os, re, subprocess, sys, urllib.request

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
BASE = '/Users/shulizhe/Documents/deepseek-harness/ai/openstudy'
FIG = os.path.join(BASE, 'openstudy-data', 'figures')

args = sys.argv
opt = lambda k, d=None: args[args.index('--'+k)+1] if '--'+k in args else d
qdoc = json.load(open(opt('q')))
adoc = json.load(open(opt('a')))
subject = opt('subject', 'physics')
bank_path = opt('bank')
topics = json.load(open(os.path.join(BASE, 'tools', f'topics-{subject}.json'), encoding='utf8'))
bank = json.load(open(bank_path, encoding='utf8'))
tag = adoc['tag']
import re as _re
paper_title = _re.sub(r'[-_]组卷网$', '', (qdoc.get('title') or '')).strip() or f'组卷网 {tag}'
figdir = os.path.join(FIG, subject); os.makedirs(figdir, exist_ok=True)


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 200:
        return True
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': 'https://zujuan.xkw.com/'})
        data = urllib.request.urlopen(req, timeout=25).read()
        if len(data) < 100: return False
        open(path, 'wb').write(data); return True
    except Exception as e:
        print('  下载失败', url[:60], e); return False


def guess(text):
    for tid, t in topics['topics'].items():
        for cue in (t.get('cues') or []):
            if cue and cue in text: return tid
    return f'{ {"physics":"P","chemistry":"C","technology":"T"}.get(subject,"P") }-99'


added = 0
for i, q in enumerate(qdoc['questions']):
    ans = next((r for r in adoc['rows'] if r['index'] == i + 1), None)
    qid = ans['qid'] if ans else None
    if not qid: continue
    stem = re.sub(r'^\s*\d+[．.]\s*', '', q['text']).split('A．')[0].strip()
    stem = stem[:900]
    if len(stem) < 8: continue
    opts, optimgs = [], []
    for o in q['opts']:
        t = o['text'].strip().rstrip('．.')
        img = None
        if o.get('img') and '/formula/' in o['img']:
            name = f'xk-{qid}-{len(opts)}.svg'
            p = os.path.join(figdir, name)
            if fetch(o['img'], p):
                img = 'data:image/svg+xml;base64,' + base64.b64encode(open(p, 'rb').read()).decode()
        opts.append(t or '（见图）'); optimgs.append(img)
    figure = None
    for j, u in enumerate(q.get('figs') or []):
        ext = '.svg' if u.endswith('.svg') else '.jpg'
        name = f'xk-{qid}-fig{j}{ext}'
        if fetch(u, os.path.join(figdir, name)):
            figure = f'figures/{subject}/{name}'; break
    letter = (ans or {}).get('letter')
    idx = 'ABCDEFGH'.index(letter[0]) if letter and len(opts) > 1 else -1
    e = {
        'id': f'xk-{tag}-{i+1}', 'topic': guess(stem + ''.join(opts)),
        'type': 'choice' if idx >= 0 and idx < len(opts) else 'text',
        'difficulty': 0.55, 'stem': stem, 'choices': opts,
        'answer': {'value': idx} if idx >= 0 and idx < len(opts) else {'reference': '见解析'},
        'solution': (ans or {}).get('ocr') or '',
        'source': f'{paper_title}·第{i+1}题', 'sourceUrl': f'https://zujuan.xkw.com/13q{qid}.html',
        'solutionOcr': True,
    }
    if figure: e['figure'] = figure
    if any(optimgs): e['choiceImgs'] = optimgs
    if ans and ans.get('img'): e['solutionImg'] = ans['img']
    if not any(x['id'] == e['id'] for x in bank['questions']):
        bank['questions'].append(e); added += 1

json.dump(bank, open(bank_path, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print(f'新增 {added} 题，题库 {len(bank["questions"])} 题')
