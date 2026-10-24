#!/usr/bin/env python3
"""每日答案收割（后台标签页，不切屏）：按队列逐卷抓答案，超过配额自动停。

用法: python3 daily.py [--budget 28] [--subject chemistry]
队列文件 tools/xkw/queue.json：{"papers":[{"subject":"chemistry","url":"...","tag":"..."}]}
抓完的卷从队列里移除，答案落到 /tmp/xkw-ans/<tag>.json，再由 build.py 入库。
"""
import json, os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
QUEUE = os.path.join(HERE, "queue.json")
OUTDIR = "/tmp/xkw-ans"
LOG = "/tmp/xkw-daily.log"
UA = "Safari"


def log(msg):
    line = time.strftime("%m-%d %H:%M ") + msg
    print(line)
    with open(LOG, "a") as f:
        f.write(line + "\n")


def open_bg(url):
    subprocess.run(["open", "-g", "-a", "Safari", url], check=False)


def js(code):
    """在 Safari 最前面那个标签页里执行 JS（用 open -g 打开，不会抢焦点）。"""
    b64 = __import__("base64").b64encode(code.encode()).decode()
    sc = f'''tell application "Safari"
  set d to front document
  do JavaScript "eval(atob('{b64}'))" in d
end tell'''
    p = subprocess.run(["osascript", "-e", sc], capture_output=True, text=True)
    return p.stdout.strip()


def qids_of(paper_url):
    open_bg(paper_url)
    time.sleep(7)
    m = re.search(r"/(\d+)p\d+\.html", paper_url)
    pre = m.group(1) if m else "13"
    s = js(f'''JSON.stringify([...new Set((document.documentElement.innerHTML.match(/{pre}q(\\d{{6,}})/g)||[]).map(t=>t.slice({len(pre)+1})))])''')
    try:
        return pre, json.loads(s)
    except Exception:
        return pre, []


def answer_urls(pre, qid, wait=7):
    open_bg(f"https://zujuan.xkw.com/{pre}q{qid}.html")
    time.sleep(wait)
    s = js('''JSON.stringify(performance.getEntriesByType("resource").map(e=>e.name).filter(u=>/getAnswerAndParse/.test(u)))''')
    try:
        u = json.loads(s)
        return u[-1] if u else None
    except Exception:
        return None


def main():
    budget = 28
    only = None
    a = sys.argv[1:]
    if "--budget" in a:
        budget = int(a[a.index("--budget") + 1])
    if "--subject" in a:
        only = a[a.index("--subject") + 1]
    if not os.path.exists(QUEUE):
        log("队列不存在：" + QUEUE)
        return
    q = json.load(open(QUEUE))
    os.makedirs(OUTDIR, exist_ok=True)
    used, left = 0, []
    for p in q.get("papers", []):
        if only and p.get("subject") != only:
            left.append(p); continue
        if used >= budget:
            left.append(p); continue
        tag = p.get("tag") or re.search(r"/(\d+p\d+)\.html", p["url"]).group(1)
        log(f"卷 {tag} 开始")
        pre, ids = qids_of(p["url"])
        log(f"  题数 {len(ids)}")
        ans = {}
        for qid in ids:
            if used >= budget:
                break
            u = answer_urls(pre, qid)
            if u:
                ans[qid] = {"url": u}
                used += 1
        json.dump({"subject": p.get("subject"), "tag": tag, "answers": ans},
                  open(os.path.join(OUTDIR, tag + ".json"), "w"), ensure_ascii=False)
        log(f"  拿到答案 {len(ans)} 条，今日累计 {used}")
    json.dump({"papers": left}, open(QUEUE, "w"), ensure_ascii=False, indent=1)
    log(f"结束：今日用掉 {used}，队列剩 {len(left)} 卷")


if __name__ == "__main__":
    main()
