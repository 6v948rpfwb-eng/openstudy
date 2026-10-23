#!/usr/bin/env node
// 菁优网抓卷：列表 → 卷内题目 → 每题答案/解析
// 用法：
//   node grab.mjs papers --subject physics2
//   node grab.mjs paper  --subject physics2 --id <reportId> --out ../…
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const COOKIES_PY = '/Users/shulizhe/Documents/deepseek-harness/ai/quark-dl/cookies.py'
let COOKIE = ''
try {
  COOKIE = execFileSync('/usr/bin/python3', [COOKIES_PY, 'jyeoo.com'], { encoding: 'utf8' }).trim()
} catch { /* 无 cookie 也能抓公开页 */ }

const args = process.argv.slice(2)
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d }

async function get(url, referer = 'https://www.jyeoo.com/') {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: referer, ...(COOKIE ? { Cookie: COOKIE } : {}) } })
  return await r.text()
}

const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
const strip = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

function parsePaper(html) {
  const out = []
  const blocks = html.split('<li class="QUES_LI">').slice(1)
  for (const b of blocks) {
    const qid = (b.match(/<fieldset id="([A-Za-z0-9]+)"/) || [])[1]
    if (!qid) continue
    const p1 = (b.match(/<div class="pt1">([\s\S]*?)<\/div>/) || [])[1] || ''
    const p2raw = (b.match(/<div class="pt2">([\s\S]*?)(?=<div class="pt6"|<\/fieldset>)/) || [])[1] || ''
    const p2 = p2raw
    const stem = strip(p1.replace(/<!--[^>]*-->/g, ''))
    const choices = [...p2.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)].map((m) => strip(m[1]))
    const figs = [...b.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((u) => /jyeoo\.net|img\./i.test(u) && !/icon|logo|vip|pic_/i.test(u))
    const cate = (b.match(/data-cate="(\d+)"/) || [])[1]
    const label = (b.match(/data-label="([^"]*)"/) || [])[1] || ''
    out.push({ qid, cate, label, stem, choices, figs })
  }
  return out
}

function parseAnswer(html) {
  const txt = strip(html.replace(/<script[\s\S]*?<\/script>/g, ' '))
  const take = (a, b) => {
    const i = txt.indexOf(a); if (i < 0) return ''
    const j = b ? txt.indexOf(b, i + a.length) : -1
    return txt.slice(i + a.length, j > 0 ? j : i + 700).trim()
  }
  return {
    answer: take('【答案】', '【分析】') || take('【答案】', '【解答】'),
    analysis: take('【分析】', '【解答】'),
    solution: take('【解答】', '【点评】'),
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (args[0] === 'papers') {
  const subject = opt('subject', 'physics2')
  const html = await get(`https://www.jyeoo.com/${subject}/report/index?ed=1&gd=12_1&lbs=1300000&so=6`)
  const rows = [...html.matchAll(/report\/detail\/([A-Za-z0-9]+)[^>]*>([^<]{6,80})</g)].map((m) => ({ id: m[1], name: decode(m[2]).trim() }))
  const seen = new Set(); const uniq = rows.filter((r) => !seen.has(r.id) && seen.add(r.id))
  console.log(JSON.stringify(uniq, null, 1))
} else if (args[0] === 'paper') {
  const subject = opt('subject', 'physics2')
  const id = opt('id')
  const html = await get(`https://www.jyeoo.com/${subject}/report/detail/${id}`, `https://www.jyeoo.com/${subject}/report/index`)
  const qs = parsePaper(html)
  console.error(`卷内 ${qs.length} 题，开始取答案`)
  for (const q of qs) {
    const h = await get(`https://www.jyeoo.com/${subject}/ques/detail/${q.qid}`, `https://www.jyeoo.com/${subject}/report/detail/${id}`)
    Object.assign(q, parseAnswer(h))
    await sleep(400)
  }
  const out = opt('out', 'paper.json')
  writeFileSync(out, JSON.stringify({ subject, reportId: id, questions: qs }, null, 1))
  console.error(`已写 ${out}`)
} else {
  console.error('用法: papers | paper --subject --id [--out]')
  process.exit(1)
}
