#!/usr/bin/env python3
"""每日答案收割（后台标签页，不切屏幕）。

用法:
  python3 daily.py [--budget 28] [--subject chemistry] [--discover math,english]

队列 tools/xkw/queue.json：{"papers":[{"subject":"math","url":"...","tag":"..."}]}
抓到的答案落 /tmp/xkw-ans/<tag>.json，再由 build.py 入库；抓完的卷自动出队。
"""
import base64, json, os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
QUEUE = os.path.join(HERE, "queue.json")
OUTDIR = "/tmp/xkw-ans"
LOG = "/tmp/xkw-daily.log"

SLUG = {"physics": "gzwl", "chemistry": "gzhx", "math": "gzsx",
        "chinese": "gzyw", "english": "gzyy"}
KEEP = re.compile(r"2026|2025")


def log(msg):
    line = time.strftime("%m-%d %H:%M ") + msg
    print(line, flush=True)
    with open(LOG, "a") as f:
        f.write(line + "\n")


import headless  # 无窗口 WKWebView，绝不碰用户的 Safari


def js(code, wait=0, url=None):
    """在后台无窗口浏览器里打开 url 并执行 JS。"""
    if not url:
        return ""
    return headless.render(url, code, wait or 8)


JS_QIDS = ('(() => { const html = document.documentElement.innerHTML;'
           ' const pre = (location.pathname.match(/\\/(\\d+)p/) || [,"13"])[1];'
           ' const re = new RegExp(pre + "q(\\\\d{6,})", "g");'
           ' const ids = [...new Set([...html.matchAll(re)].map(m => m[1]))];'
           ' return JSON.stringify(ids); })()')

JS_ANS = ('(() => JSON.stringify(performance.getEntriesByType("resource")'
          '.map(e => e.name).filter(u => /getAnswerAndParse/.test(u))))()')

JS_LIST = ('(() => { const out = [...document.querySelectorAll("a")]'
           '.filter(a => /\\d+p\\d+\\.html/.test(a.href))'
           '.map(a => ({href: a.href, title: (a.innerText || "").replace(/\\s+/g, " ").trim()}));'
           ' const seen = new Set(); const uniq = [];'
           ' for (const it of out) { if (!seen.has(it.href)) { seen.add(it.href); uniq.push(it); } }'
           ' return JSON.stringify(uniq); })()')


def discover(subject, want=2):
    slug = SLUG.get(subject)
    if not slug:
        return []
    raw = js(JS_LIST, 9, "https://zujuan.xkw.com/%s/" % slug)
    try:
        items = json.loads(raw)
    except Exception:
        log("  发现失败（多半被滑块验证拦住）：" + subject)
        return []
    picked = [x for x in items if KEEP.search(x.get("title") or "")][:want]
    log("  %s 发现 %d 卷，取 %d 卷" % (subject, len(items), len(picked)))
    out = []
    for x in picked:
        m = re.search(r"/(\d+p\d+)\.html", x["href"])
        if m:
            out.append({"subject": subject, "url": x["href"], "tag": m.group(1)})
    return out


def qids_of(paper_url):
    m = re.search(r"/(\d+)p\d+\.html", paper_url)
    pre = m.group(1) if m else "13"
    raw = js(JS_QIDS, 9, paper_url)
    try:
        return pre, json.loads(raw)
    except Exception:
        return pre, []


def answer_url(pre, qid, wait=8):
    raw = js(JS_ANS, wait, "https://zujuan.xkw.com/%sq%s.html" % (pre, qid))
    try:
        u = json.loads(raw)
        return u[-1] if u else None
    except Exception:
        return None


def main():
    a = sys.argv[1:]
    budget = int(a[a.index("--budget") + 1]) if "--budget" in a else 28
    only = a[a.index("--subject") + 1] if "--subject" in a else None
    if "--discover" in a:
        subs = [x for x in a[a.index("--discover") + 1].split(",") if x]
        q = json.load(open(QUEUE)) if os.path.exists(QUEUE) else {"papers": []}
        have = {p.get("subject") for p in q.get("papers", [])}
        for sub in subs:
            if sub in have:
                continue
            q.setdefault("papers", []).extend(discover(sub))
        json.dump(q, open(QUEUE, "w"), ensure_ascii=False, indent=1)
        log("发现完成，队列 %d 卷" % len(q.get("papers", [])))

    if not os.path.exists(QUEUE):
        log("队列不存在：" + QUEUE)
        return
    q = json.load(open(QUEUE))
    os.makedirs(OUTDIR, exist_ok=True)

    groups = {}
    for p in q.get("papers", []):
        groups.setdefault(p.get("subject"), []).append(p)
    order = []
    while any(groups.values()):
        for k in list(groups):
            if groups[k]:
                order.append(groups[k].pop(0))

    used, left = 0, []
    for p in order:
        if only and p.get("subject") != only:
            left.append(p); continue
        if used >= budget:
            left.append(p); continue
        tag = p.get("tag") or re.search(r"/(\d+p\d+)\.html", p["url"]).group(1)
        log("卷 %s 开始（%s）" % (tag, p.get("subject")))
        pre, ids = qids_of(p["url"])
        log("  题数 %d" % len(ids))
        ans = {}
        for qid in ids:
            if used >= budget:
                break
            u = answer_url(pre, qid)
            if u:
                ans[qid] = {"url": u}
                used += 1
        json.dump({"subject": p.get("subject"), "tag": tag, "answers": ans},
                  open(os.path.join(OUTDIR, tag + ".json"), "w"), ensure_ascii=False)
        log("  拿到答案 %d 条，今日累计 %d" % (len(ans), used))
    json.dump({"papers": left}, open(QUEUE, "w"), ensure_ascii=False, indent=1)
    log("结束：用掉 %d，队列剩 %d 卷" % (used, len(left)))


if __name__ == "__main__":
    main()
