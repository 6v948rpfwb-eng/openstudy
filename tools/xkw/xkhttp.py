#!/usr/bin/env python3
"""组卷网纯 HTTP 访问：先用 waf.js 解 WAF，再带 Safari 登录 Cookie 请求。全程不启动浏览器。"""
import base64, glob, json, os, subprocess, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
NODE = "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
      "(KHTML, like Gecko) Version/18.0 Safari/605.1.15")
sys.path.insert(0, "/Users/shulizhe/Documents/deepseek-harness/ai/quark-dl")
import cookies as QC

COOKIE_PATH = "/Users/shulizhe/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies"


def safari_cookies(domain_kw="xkw"):
    try:
        rows = QC.load(COOKIE_PATH)
    except Exception:
        return {}
    out = {}
    for r in rows:
        if domain_kw in r["domain"]:
            out[r["name"]] = r["value"]
    return out


def waf_cookies(url):
    env = dict(os.environ, ELECTRON_RUN_AS_NODE="1")
    try:
        p = subprocess.run([NODE, os.path.join(HERE, "waf.js"), url],
                           capture_output=True, text=True, env=env, timeout=30)
        s = p.stdout.strip()
    except Exception:
        return {}
    out = {}
    for part in s.split("; "):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k] = v
    return out


def cookie_header(url):
    ck = safari_cookies()
    ck.update(waf_cookies(url))
    return "; ".join(f"{k}={v}" for k, v in ck.items())


def get(url, referer="https://zujuan.xkw.com/"):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Referer": referer, "Cookie": cookie_header(url),
        "Accept": "text/html,application/xhtml+xml",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "ignore")


def post_form(url, data, referer="https://zujuan.xkw.com/"):
    body = urllib.parse.urlencode(data).encode()
    hdr = {
        "User-Agent": UA, "Referer": referer, "Cookie": cookie_header(url),
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/plain, */*",
    }
    ut = safari_cookies().get("user_token", "")
    uid = safari_cookies().get("userId", "")
    if ut:
        hdr["enVqdWFu"] = base64.b64encode(f"{uid}{ut}".encode()).decode()
    req = urllib.request.Request(url, data=body, headers=hdr, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "ignore")


if __name__ == "__main__":
    u = sys.argv[1]
    if len(sys.argv) > 2 and sys.argv[2] == "api":
        print(post_form("https://zujuan.xkw.com/zujuan-api/check_ques_parse",
                        {"quesId": 32484095, "bankId": 14}, referer=u)[:400])
    else:
        h = get(u)
        print(len(h), h[:80].replace("\n", " "))
