/**
 * build-framework-page.js —— 把 topics-<学科>.json 渲染成一个双击就能看的单文件网页
 *
 * 为什么单独做这一页：练习页（dist/openstudy.html）只关心「出题→判分」，
 * 而四组方法论 + 三张表是给「看」的——要能一眼看到每个考点属于哪一组、
 * 该走什么动作序列、必查什么。数据内联，不依赖服务器与 fetch。
 *
 * 跑法：
 *   node tools/build-framework-page.js                 # 默认 chemistry
 *   node tools/build-framework-page.js physics          # 需要 tools/topics-physics.json v2 格式
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const subject = process.argv[2] || 'chemistry'

const doc = JSON.parse(readFileSync(join(here, `topics-${subject}.json`), 'utf8'))
const topics = Object.entries(doc.topics)
const stats = { total: topics.length, tested: 0, byGroup: { A: 0, B: 0, C: 0, D: 0 }, byState: {} }
for (const [, t] of topics) {
  if (t.state) stats.tested++
  if (t.group) stats.byGroup[t.group] = (stats.byGroup[t.group] || 0) + 1
  const s = t.state || '未测'
  stats.byState[s] = (stats.byState[s] || 0) + 1
}

const GROUP_NOTE = {
  A: '错因：条件漏读 / 边界忘查 / 单位没换',
  B: '错因：凭印象选 / 扩大范围 / 反向题漏看',
  C: '错因：会但写错 / 格式缺项 / 判据缺失',
  D: '错因：要点漏 / 没有因果链 / 术语口语化',
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${doc.title} · 四组方法论与三张表</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
  :root{--bg:#fbf9f5;--card:#fff;--ink:#2b2b2b;--sub:#7a736c;--line:#e6e0d6;--accent:#2f6f4e;--accent-soft:#e7f1ea;--wrong:#a8443a;--wrong-soft:#f8e9e6;--warn:#b4762a;--warn-soft:#fbf1e2}
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  body{margin:0 auto;background:var(--bg);color:var(--ink);font:15px/1.65 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif;padding:18px 16px 70px;max-width:760px}
  h1{font-size:20px;margin:0 0 4px;letter-spacing:.4px}
  .sub{color:var(--sub);font-size:13px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-top:14px}
  .stat{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}
  .stat div{background:var(--accent-soft);border-radius:10px;padding:8px 12px;font-size:13px;color:#215440}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .chip{appearance:none;border:1px solid var(--line);background:#fff;color:var(--sub);border-radius:999px;padding:5px 13px;font-size:13px;font-family:inherit;cursor:pointer}
  .chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
  .gcard{cursor:pointer}
  .ghead{display:flex;align-items:center;gap:10px}
  .badge{display:inline-block;min-width:24px;text-align:center;border-radius:8px;padding:2px 8px;font-size:12px;font-weight:600}
  .bA{background:#e7eefb;color:#2c4f8f}.bB{background:#e7f1ea;color:#2f6f4e}.bC{background:var(--warn-soft);color:var(--warn)}.bD{background:#f0e9f7;color:#6a4a91}
  .gname{font-weight:600}
  .gcount{margin-left:auto;color:var(--sub);font-size:13px}
  ol,ul{margin:8px 0 0;padding-left:22px}
  li{margin:3px 0}
  .tag{font-size:12px;color:var(--sub);border:1px solid var(--line);border-radius:6px;padding:1px 7px;margin-left:6px}
  .tcard{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:13px 15px;margin-top:10px;cursor:pointer}
  .tcard.open{border-color:var(--accent)}
  .tline{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
  .tname{font-weight:600}
  .alias{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--sub)}
  .st{font-size:12px;border-radius:6px;padding:1px 7px}
  .stOK{background:var(--accent-soft);color:#2f6f4e}
  .stMid{background:var(--warn-soft);color:var(--warn)}
  .stBad{background:var(--wrong-soft);color:var(--wrong)}
  .stNone{background:#f1eee8;color:var(--sub)}
  .cues{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .cue{font-size:12px;color:#4a4a4a;background:#f6f3ec;border-radius:6px;padding:2px 8px}
  .body{display:none;margin-top:10px;border-top:1px dashed var(--line);padding-top:10px}
  .tcard.open .body{display:block}
  h3{font-size:13px;color:var(--sub);margin:12px 0 0;font-weight:600;letter-spacing:.3px}
  .foot{color:var(--sub);font-size:12px;margin-top:22px;text-align:center}
  .empty{color:var(--sub);font-size:13px;margin-top:16px;text-align:center}
</style>
</head>
<body>
<h1>${doc.title} · 四组方法论与三张表</h1>
<div class="sub">${doc.source || ''} · 生成 2026-10-22 · 数据源 topics-${subject}.json</div>
<div class="stat">
  <div>考点 ${stats.total}</div>
  <div>已测 ${stats.tested}</div>
  <div>A ${stats.byGroup.A}</div><div>B ${stats.byGroup.B}</div>
  <div>C ${stats.byGroup.C}</div><div>D ${stats.byGroup.D}</div>
</div>

<div class="card">
  <div class="ghead"><span class="gname">四组是什么</span><span class="gcount">判据形状 / 动作序列 / 检验方式 三者相同才同组</span></div>
  <div id="groups"></div>
</div>

<div class="chips" id="groupFilter"></div>
<div class="chips" id="stateFilter"></div>
<div id="list"></div>
<div class="empty" id="empty" style="display:none">没有符合条件的考点</div>
<div class="foot">点卡片展开动作序列与必查项 · 数据内联，可离线打开</div>

<script>
const DOC = ${JSON.stringify(doc)};
const GROUP_NOTE = ${JSON.stringify(GROUP_NOTE)};
const STATS = ${JSON.stringify(stats)};

const gBox = document.getElementById('groups');
for (const [g, info] of Object.entries(DOC.groups)) {
  const d = document.createElement('div');
  d.className = 'gcard';
  d.innerHTML = '<div class="ghead" style="margin-top:12px"><span class="badge b' + g + '">' + g + '</span>' +
    '<span class="gname">' + info.label + '</span><span class="gcount">' + (STATS.byGroup[g] || 0) + ' 个考点</span></div>' +
    '<div class="sub" style="margin-top:4px">' + (GROUP_NOTE[g] || '') + '</div>' +
    '<div class="body"><h3>动作序列（表 2）</h3><ol><li>' + info.steps.join('</li><li>') + '</li></ol>' +
    '<h3>必查项（表 3）</h3><ul><li>' + info.checks.join('</li><li>') + '</li></ul></div>';
  d.onclick = () => d.classList.toggle('open');
  gBox.appendChild(d);
}

let fg = 'all', fs = 'all';
const GROUP_FILTERS = [['all', '全部组'], ['A', 'A 条件→方程→边界'], ['B', 'B 证据→判断'], ['C', 'C 触发→精确复现'], ['D', 'D 骨架→成文']];
const STATE_FILTERS = [['all', '全部状态'], ['tested', '只看已测'], ['bad', '只看未掌握']];

const stateClass = (s) => s === '✅' ? 'stOK' : s === '🟡' ? 'stMid' : s === '🔴' ? 'stBad' : 'stNone';

function renderFilters(el, items, cur, onPick) {
  el.innerHTML = '';
  for (const [k, label] of items) {
    const b = document.createElement('button');
    b.className = 'chip' + (cur === k ? ' on' : '');
    b.textContent = label;
    b.onclick = () => onPick(k);
    el.appendChild(b);
  }
}

function renderList() {
  const list = document.getElementById('list');
  list.innerHTML = '';
  let n = 0;
  for (const [id, t] of Object.entries(DOC.topics)) {
    if (fg !== 'all' && t.group !== fg) continue;
    if (fs === 'tested' && !t.state) continue;
    if (fs === 'bad' && t.state !== '🔴') continue;
    n++;
    const steps = [...(DOC.groups[t.group]?.steps || []), ...(t.extraSteps || [])];
    const checks = [...(DOC.groups[t.group]?.checks || []), ...(t.extraChecks || [])];
    const d = document.createElement('div');
    d.className = 'tcard';
    d.innerHTML =
      '<div class="tline"><span class="badge b' + t.group + '">' + t.group + '</span>' +
      '<span class="tname">' + t.name + '</span>' +
      '<span class="st ' + stateClass(t.state) + '">' + (t.state || '未测') + '</span>' +
      (t.errorType ? '<span class="tag">' + t.errorType + '</span>' : '') +
      '<span class="alias">' + (t.alias || id) + '</span></div>' +
      ((t.cues && t.cues.length) ? '<div class="cues">' + t.cues.map(c => '<span class="cue">' + c + '</span>').join('') + '</div>' : '') +
      '<div class="body"><h3>动作序列</h3><ol><li>' + steps.join('</li><li>') + '</li></ol>' +
      '<h3>必查项</h3><ul><li>' + checks.join('</li><li>') + '</li></ul></div>';
    d.onclick = () => d.classList.toggle('open');
    list.appendChild(d);
  }
  document.getElementById('empty').style.display = n ? 'none' : 'block';
}

function renderAll() {
  renderFilters(document.getElementById('groupFilter'), GROUP_FILTERS, fg, k => { fg = k; renderAll(); });
  renderFilters(document.getElementById('stateFilter'), STATE_FILTERS, fs, k => { fs = k; renderAll(); });
  renderList();
}
renderAll();
</script>
</body>
</html>
`

const out = join(root, 'openstudy-data', `openstudy-${subject}-framework.html`)
writeFileSync(out, html)
console.log('已生成', out, `${(html.length / 1024).toFixed(1)} KB`, `考点 ${stats.total} / 已测 ${stats.tested}`)
