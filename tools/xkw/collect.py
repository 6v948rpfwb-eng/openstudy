#!/usr/bin/env python3
"""组卷网：试卷 → 题目 id → 答案长图（JPEG）+ OCR 文本

用法: python3 collect.py <13p试卷URL> --subject physics --out /tmp/xk-卷.json
"""
import json, os, re, subprocess, sys, time
import grab

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
COOKIES_PY = '/Users/shulizhe/Documents/deepseek-harness/ai/quark-dl/cookies.py'
FIG_ROOT = '/Users/shulizhe/Documents/deepseek-harness/ai/openstudy/openstudy-data/figures'


def cookie():
    try:
        return subprocess.run(['/usr/bin/python3', COOKIES_PY, 'xkw.com'], capture_output=True, text=True).stdout.strip()
    except Exception:
        return ''


def ocr(path):
    r = subprocess.run(['/tmp/ocr', path], capture_output=True, text=True)
    return r.stdout.strip()


PRE = '13'


def answer_url(qid):
    """在当前标签页里导航到单题页，从 performance 里取答案图 URL。"""
    target = f'{PRE}q{qid}'
    url = f'https://zujuan.xkw.com/{target}.html'
    try:
        grab.run_js(f'location.href="{url}"')
    except Exception:
        grab.subprocess.run(['open', '-a', 'Safari', url], check=True)
    js = ('JSON.stringify(performance.getEntriesByType("resource").map(e=>e.name)'
          '.filter(u=>/getAnswerAndParse/.test(u)).slice(-1))')
    for _ in range(30):
        time.sleep(1.2)
        try:
            href = grab.run_js('location.href') or ''
        except Exception:
            href = ''
        if target not in href:
            continue
        out = grab.run_js(js)
        if out and out != '[]':
            return json.loads(out)[0]
    # 最后一次机会：直接在页面里读答案区块是否已渲染
    return None


def main():
    url = sys.argv[1]
    subject = sys.argv[sys.argv.index('--subject') + 1] if '--subject' in sys.argv else 'physics'
    out_path = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else '/tmp/xk-paper.json'
    global PRE
    m = re.search(r'/(\d+)p(\d+)\.html', url)
    PRE, tag = m.group(1), m.group(2)
    print(f'前缀 {PRE}q，卷号 {tag}')
    figdir = os.path.join(FIG_ROOT, subject)
    os.makedirs(figdir, exist_ok=True)

    grab.subprocess.run(['open', '-a', 'Safari', url], check=True)
    time.sleep(7)
    qids = json.loads(grab.run_js(
        f'JSON.stringify([...new Set((document.documentElement.innerHTML.match(/{PRE}q(\\d{{6,}})/g)||[]).map(s=>s.slice({len(PRE)+1})))])'))
    print(f'题目 {len(qids)} 道')

    rows = []
    for i, qid in enumerate(qids, 1):
        u = answer_url(qid)
        row = {'qid': qid, 'index': i, 'answerUrl': u, 'img': None, 'ocr': None, 'letter': None}
        if u:
            p = os.path.join(figdir, f'ans-{qid}.jpg')
            if not os.path.exists(p):
                subprocess.run(['curl', '-s', '-m', '25', u, '-H', f'User-Agent: {UA}',
                                '-H', 'Referer: https://zujuan.xkw.com/', '-H', f'Cookie: {cookie()}',
                                '-o', p], check=False)
            if os.path.exists(p) and os.path.getsize(p) > 2000:
                row['img'] = f'figures/{subject}/ans-{qid}.jpg'
                txt = ocr(p)
                row['ocr'] = txt
                m = re.search(r'【答案】\s*([A-H]{1,4})', txt)
                row['letter'] = m.group(1) if m else None
        rows.append(row)
        print(f'  {i}/{len(qids)} {qid} 答案={row["letter"]} 图={"有" if row["img"] else "无"}')
        time.sleep(1)

    json.dump({'paperUrl': url, 'tag': tag, 'rows': rows}, open(out_path, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    ok = sum(1 for r in rows if r['letter'])
    print(f'写出 {out_path}：{ok}/{len(rows)} 题拿到字母答案')


if __name__ == '__main__':
    main()
