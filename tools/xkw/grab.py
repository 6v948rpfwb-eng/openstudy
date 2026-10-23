#!/usr/bin/env python3
"""组卷网抓卷（走 Safari 渲染 + AppleScript 执行 JS，绕开 WAF）

用法:
  python3 grab.py papers <科目首页URL>            # 列出试卷链接
  python3 grab.py paper <13pNNNNNNN.html> --out x.json
"""
import base64, json, subprocess, sys, time

JS_PAPERS = r"""
JSON.stringify([...document.querySelectorAll('a')]
  .map(a => ({href: a.href, title: (a.innerText||'').trim()}))
  .filter(o => /\/1[0-9]p\d+\.html$/.test(o.href) && o.title.length > 6))
"""

JS_PAPER = r"""
(() => {
  const clean = s => (s||'').replace(/\s+/g,' ').trim();
  const items = [...document.querySelectorAll('.tk-quest-item')];
  const qs = items.map((it, idx) => {
    const cnt = it.querySelector('.exam-item__cnt');
    const opts = [...it.querySelectorAll('table[name=optionsTable] td')].map(td => {
      const im = td.querySelector('img');
      const t = clean(td.innerText).replace(/^[A-H][．.]\s*/,'');
      return { text: t, img: im ? im.src : null };
    });
    const figs = [...(cnt ? cnt.querySelectorAll('img') : [])]
      .map(i => i.src).filter(s => !/formula/.test(s));
    const type = clean((it.querySelector('.top-msg, .addi-msg') || {}).innerText);
    return {
      idx: idx + 1,
      type,
      html: cnt ? cnt.innerHTML : '',
      text: cnt ? clean(cnt.innerText) : '',
      opts,
      figs,
    };
  });
  return JSON.stringify({ title: document.title, url: location.href, questions: qs });
})()
"""


def run_js(js, timeout=60):
    """在 Safari 前台文档里执行 JS，返回字符串结果。"""
    b64 = base64.b64encode(js.encode('utf-8')).decode('ascii')
    script = ('tell application "Safari" to do JavaScript "eval(atob(\\"'
              + b64 + '\\"))" in front document')
    r = subprocess.run(['osascript', '-e', script], capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:300])
    return r.stdout.strip()


def main():
    cmd = sys.argv[1]
    url = sys.argv[2]
    subprocess.run(['open', '-a', 'Safari', url], check=True)
    time.sleep(6)
    out = run_js(JS_PAPERS if cmd == 'papers' else JS_PAPER, timeout=90)
    if '--out' in sys.argv:
        path = sys.argv[sys.argv.index('--out') + 1]
        open(path, 'w', encoding='utf8').write(out)
        data = json.loads(out)
        n = len(data.get('questions', data))
        print(f'写到 {path}（{n} 项）')
    else:
        print(out)


if __name__ == '__main__':
    main()
