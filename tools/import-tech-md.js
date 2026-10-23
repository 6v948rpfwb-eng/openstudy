#!/usr/bin/env node
/**
 * import-tech-md.js —— 把技术诊断卷（纯文本题）转成开卷题库
 *
 * 为什么单独写：技术真题原卷大量题目依赖图形（三视图、电路图、流程图），
 * 纯文本进不了题库。`学科-技术/题库/2026-09-27-技术全科-诊断测验第2轮.md`
 * 是已经筛过的「不依赖图形」版本，题干、选项、答案、覆盖考点都在里面，
 * 所以只解析这一份文件，不解析原卷。
 *
 * 用法：
 *   node tools/import-tech-md.js \
 *     --topics tools/topics-technology.json \
 *     --out openstudy-data/technology.bank.json \
 *     "../高三学习/学科-技术/题库/2026-09-27-技术全科-诊断测验第2轮.md"
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
const topicsPath = flag('--topics', 'tools/topics-technology.json');
const outPath = flag('--out', 'openstudy-data/technology.bank.json');
const dryRun = args.includes('--dry-run');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('用法：node tools/import-tech-md.js --topics <考点表> --out <题库> <诊断卷.md>');
  process.exit(1);
}

const topicsDoc = JSON.parse(fs.readFileSync(topicsPath, 'utf8'));
const topics = topicsDoc.topics ?? {};
const aliasToId = new Map();
for (const [id, t] of Object.entries(topics)) {
  if (t.alias) aliasToId.set(t.alias, id);
}
const idToAlias = new Map([...aliasToId].map(([a, i]) => [i, a]));

// ---------- 1. 读原文，按题号切块 ----------
// 两种排法：诊断卷用 `**12.** 题干`，原卷用 `12. 题干`。同一份文件只用一种。
function parseFile(text, fileLabel) {
  const blocks = new Map(); // 题号 -> {num, stem, choices, part}
  const bold = /^\*\*(\d+)\.\*\*/m.test(text);
  const cut = text.search(/^#+ 参考答案/m);
  const body = cut > 0 ? text.slice(0, cut) : text;
  const lines = body.split(/\r?\n/);
  let current = null;
  let part = '';
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const t = line.replace(/^\s+/, '');
    if (/^#+ .*信息技术/.test(t)) { part = 'it'; current = null; continue; }
    if (/^#+ .*通用技术/.test(t)) { part = 'gt'; current = null; continue; }
    if (t.startsWith('```')) continue; // 代码块围栏本身跳过，内容仍会进题干
    const m = bold ? t.match(/^\*\*(\d+)\.\*\*\s*(.*)$/) : t.match(/^(\d+)\.\s+(.*)$/);
    if (m && Number(m[1]) <= 40) {
      current = { num: Number(m[1]), part, stem: m[2].trim(), choices: [] };
      blocks.set(current.num, current);
      continue;
    }
    if (!current) continue;
    if (t.startsWith('**') || t.startsWith('>') || t === '' || t.startsWith('|') || /^\*\*\d+[-（]/.test(t)) {
      if (/^\*\*\d+[-（]/.test(t)) current = null;
      continue;
    }
    if (/^A\.\s*\S/.test(t) && /B\./.test(t) && current.choices.length === 0) {
      const parsed = [];
      for (const seg of t.split(/　+/).map((x) => x.trim()).filter(Boolean)) {
        const g = seg.match(/^([A-D])\.\s*(.+)$/);
        if (g) parsed.push({ letter: g[1], text: g[2].trim() });
      }
      if (parsed.length === 4) {
        parsed.sort((a, b) => a.letter.localeCompare(b.letter));
        current.choices = parsed.map((x) => x.text);
        continue;
      }
    }
    const opt = t.match(/^([A-D])\.\s*(.+)$/);
    if (opt) {
      if (current.choices.length < 4) current.choices.push(opt[2].trim());
      continue;
    }
    if (current.choices.length === 0) {
      current.stem += (current.stem && !/[：。；]$/.test(current.stem) ? ' ' : '') + t.trim();
    }
  }
  return blocks;
}

// ---------- 2. 答案 ----------
function parseAnswers(text) {
  const answers = new Map();
  const re = /^\*\*(\d+)\.\s*([A-D])\s*(?:\*\*|（)/gm;
  let m;
  while ((m = re.exec(text))) {
    const num = Number(m[1]);
    if (!answers.has(num)) answers.set(num, m[2]);
  }
  return answers;
}

// ---------- 3. 覆盖度说明里的「题号 → 考点」 ----------
function parseTopicMap(text) {
  const map = new Map();
  const re = /^\|\s*(\d+)(?:（[^）]*）)?\s*\|([^|]*)\|/gm;
  let m;
  while ((m = re.exec(text))) {
    const num = Number(m[1]);
    const cell = m[2];
    const first = cell.match(/`技-(\d+)`/);
    if (first && !map.has(num)) map.set(num, Number(first[1]));
  }
  return map;
}

// 原卷里有几道题，诊断卷已经替我核对过答案、也标了考点，但原卷文件本身没写答案表。
// 这几条只补「答案 + 考点」，题干仍从原卷原文读，不自己编。
const EXTRA = {
  '2026-1月-浙江选考-技术-真题': {
    1: { answer: 'B', topic: 'T-01', note: '诊断卷第 1 轮已核对' },
    2: { answer: 'B', topic: 'T-28', note: '诊断卷第 1 轮已核对' },
    3: { answer: 'D', topic: 'T-30', note: '诊断卷第 1 轮已核对' },
  },
};

const all = new Map();
for (const rel of files) {
  const abs = path.resolve(rel);
  const text = fs.readFileSync(abs, 'utf8');
  const blocks = parseFile(text, path.basename(rel));
  const answers = parseAnswers(text);
  const topicMap = parseTopicMap(text);
  for (const [num, b] of blocks) {
    if (b.choices.length !== 4) continue;
    const base = path.basename(rel, '.md');
    const extra = (Object.entries(EXTRA).find(([k]) => base.includes(k)) || [])[1]?.[num];
    const ans = answers.get(num) ?? extra?.answer;
    if (!ans) continue;
    const tech = topicMap.get(num);
    const topicId = tech ? aliasToId.get(`技-${String(tech).padStart(2, '0')}`) : (extra?.topic ?? null);
    if (!topicId) continue;
    const tag = base.includes('诊断') ? 'diag' : base.includes('真题') ? 'zj' : base.slice(0, 6);
    const id = `${tag}-q${num}`;
    all.set(id, {
      id,
      topic: topicId,
      type: 'choice',
      difficulty: 0.25,
      stem: b.stem.replace(/\s+/g, ' ').trim(),
      choices: b.choices.map((c) => c.replace(/\s+/g, ' ').trim()),
      answer: { value: [b.choices.length ? 'ABCD'.indexOf(ans) : 0] },
      solution: `正确答案 ${ans}`,
      source: `${path.basename(rel)} 第${num}题（原卷 2026-01 浙江技术第${num}题）`,
      sourceUrl: '',
    });
  }
}

const questions = [...all.values()].sort((a, b) => a.id.localeCompare(b.id));
const missingTopic = questions.filter((q) => !topics[q.topic]);

const doc = {
  subject: 'technology',
  title: '高中技术（信息技术 + 通用技术）',
  version: 1,
  topics,
  questions,
};
if (missingTopic.length) {
  console.error(`✗ ${missingTopic.length} 道题的考点不在考点表里：`, missingTopic.map((q) => q.topic).join(', '));
  process.exit(1);
}
console.log(`解析 ${questions.length} 道题（跳过：选项不足 4 个、无答案、无考点映射）`);
const byTopic = {};
for (const q of questions) byTopic[q.topic] = (byTopic[q.topic] ?? 0) + 1;
for (const [t, c] of Object.entries(byTopic)) {
  console.log(`  ${t} ${topics[t]?.name ?? '?'} × ${c}`);
}
if (dryRun) {
  console.log('（--dry-run，不写文件）');
} else {
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');
  console.log(`✓ 写入 ${outPath}`);
}
