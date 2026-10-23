#!/usr/bin/env node
/**
 * annotate-graph.js —— 给考典表补上「知识点图」用的结构
 *
 * 只做一件事：往 `tools/topics-*.json` 里写 `graph` 字段：
 *   graph.modules = [{ id, label, topics: [考点编号…] }]   // 每一列
 *   graph.edges   = [[起点, 终点], …]                       // 跨列的连线
 * 同列内按 topics 数组顺序自动连成一条链，不用手写。
 *
 * 判据：同列 = 同一块知识，学的时候按数组顺序学；edges = 跨块的前提关系（先学 A 才能学 B）。
 * 用法：node tools/annotate-graph.js
 */

import fs from 'node:fs';

const PHYSICS = {
  modules: [
    { id: 'mech', label: '力学', topics: ['P-01', 'P-02', 'P-03', 'P-04', 'P-05'] },
    { id: 'wave', label: '振动与波', topics: ['P-06'] },
    { id: 'elec', label: '电场与电路', topics: ['P-07', 'P-08'] },
    { id: 'mag', label: '磁场与电磁感应', topics: ['P-09', 'P-10'] },
    { id: 'heat', label: '热·光·近代', topics: ['P-11', 'P-12', 'P-13'] },
    { id: 'exp', label: '实验与综合', topics: ['P-14', 'P-98'] },
  ],
  edges: [
    ['P-05', 'P-14'],
    ['P-08', 'P-14'],
    ['P-06', 'P-11'],
    ['P-07', 'P-09'],
    ['P-04', 'P-09'],
  ],
};

const CHEMISTRY = {
  modules: [
    { id: 'basic', label: '概念与用语', topics: ['C-01', 'C-02', 'C-03', 'C-04', 'C-05', 'C-33'] },
    { id: 'elem', label: '元素化合物', topics: ['C-07', 'C-08', 'C-09'] },
    { id: 'struct', label: '结构·周期律', topics: ['C-10', 'C-11', 'C-22', 'C-37', 'C-34', 'C-38', 'C-35', 'C-32', 'C-39'] },
    { id: 'principle', label: '反应原理', topics: ['C-06', 'C-12', 'C-18', 'C-21', 'C-17', 'C-13', 'C-15', 'C-19', 'C-20', 'C-16', 'C-14', 'C-31', 'C-36'] },
    { id: 'organic', label: '有机', topics: ['C-23', 'C-24', 'C-26', 'C-28', 'C-25', 'C-29', 'C-30', 'C-27'] },
    { id: 'lab', label: '实验', topics: ['C-43', 'C-40', 'C-41', 'C-44', 'C-42', 'C-45'] },
  ],
  edges: [
    ['C-09', 'C-10'],
    ['C-10', 'C-11'],
    ['C-19', 'C-36'],
    ['C-20', 'C-41'],
    ['C-26', 'C-41'],
    ['C-32', 'C-39'],
    ['C-17', 'C-21'],
    ['C-14', 'C-45'],
    ['C-03', 'C-16'],
    ['C-08', 'C-41'],
  ],
};

function withGraph(file, graph, skip = []) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const known = new Set(Object.keys(doc.topics));
  for (const m of graph.modules) {
    for (const t of m.topics) {
      if (!known.has(t)) throw new Error(`${file}: 模块 ${m.id} 引用了不存在的考点 ${t}`);
    }
  }
  for (const [a, b] of graph.edges) {
    if (!known.has(a) || !known.has(b)) throw new Error(`${file}: 连线引用了不存在的考点 ${a}→${b}`);
  }
  const inModules = new Set(graph.modules.flatMap((m) => m.topics));
  const missing = [...known].filter((t) => !inModules.has(t) && !skip.includes(t));
  if (missing.length) console.warn(`⚠ ${file}: 这些考点没出现在图里：${missing.join(', ')}`);
  doc.graph = graph;
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  console.log(`✓ ${file}：${graph.modules.length} 列 / ${inModules.size} 个节点 / ${graph.edges.length} 条跨列连线`);
}

withGraph('tools/topics-physics.json', PHYSICS, ['P-99']);
withGraph('tools/topics-chemistry.json', CHEMISTRY, ['C-99']);
