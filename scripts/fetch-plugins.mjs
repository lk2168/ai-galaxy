// 拉取 DSH 插件生态，生成 public/graph-plugins.json
// 数据源：https://awesome-dsh-plugin.com/plugins.json（社区维护的公开目录）
//
// 这批节点单独成团：它们不是「AI 的历史」，而是「AI 的现在」——
// 围绕 DeepSeek Harness 长出来的一圈插件，按类别分成若干小星团。

import { writeFileSync, mkdirSync } from 'node:fs';

const SOURCE = 'https://awesome-dsh-plugin.com/plugins.json';
const ANCHOR = 'deepseek-harness'; // 骨架层里的锚点节点 id
const MAILTO = '288989345+lk2168@users.noreply.github.com';

const res = await fetch(SOURCE, {
  headers: { 'User-Agent': `ai-galaxy/0.1 (mailto:${MAILTO})`, Accept: 'application/json' },
  signal: AbortSignal.timeout(40000),
});
if (!res.ok) throw new Error(`插件目录拉取失败：HTTP ${res.status}`);
const raw = await res.json();
const list = Array.isArray(raw) ? raw : (raw.plugins ?? raw.items ?? []);
console.error(`插件目录 ${list.length} 条`);

const yearOf = (v) => {
  const m = /^(\d{4})/.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
};

const nodes = [];
const seen = new Set();
for (const p of list) {
  const owner = p.owner ?? '';
  const name = p.name ?? '';
  if (!name) continue;
  const id = `dsh:${owner}/${name}`;
  if (seen.has(id)) continue;
  seen.add(id);

  const downloads = Number(p.downloads) || 0;
  const stars = Number(p.stars) || 0;
  const year = yearOf(p.added) ?? yearOf(p.downloadsStart) ?? 2026;

  nodes.push({
    id,
    layer: 'plugin',
    type: 'project',
    name,
    year,
    // 下载量比 star 更能反映「真的有人在用」，所以主要看下载
    downloads,
    stars,
    category: p.category ?? 'other',
    summary: (p.description?.zh ?? p.description?.en ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
    url: p.url ?? p.page ?? '',
    weight: 0,
  });
}

// —— 亮度：下载量的对数，再压到 20-100 ——
const values = nodes.map((n) => Math.log10(1 + n.downloads * 4 + n.stars * 60));
const min = Math.min(...values);
const max = Math.max(...values);
nodes.forEach((n, i) => {
  const t = max > min ? (values[i] - min) / (max - min) : 0.4;
  n.weight = Math.round(18 + t * 82);
});

// —— 连线：每个类别里最亮的 3 个插件连到 DSH 锚点，其余靠空间聚集表达归属 ——
const byCategory = new Map();
for (const n of nodes) {
  if (!byCategory.has(n.category)) byCategory.set(n.category, []);
  byCategory.get(n.category).push(n);
}
const links = [];
for (const [category, arr] of byCategory) {
  arr.sort((a, b) => b.weight - a.weight);
  for (const n of arr.slice(0, 3)) {
    links.push({ source: n.id, target: ANCHOR, relation: '属于', strength: 2 });
  }
  console.error(`  ${category}: ${arr.length} 个，取前 3 连锚点`);
}

const out = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: 'awesome-dsh-plugin',
    anchors: [ANCHOR],
    categories: [...byCategory.keys()].sort(),
    nodes: nodes.length,
    links: links.length,
  },
  nodes,
  links,
};

mkdirSync('public', { recursive: true });
writeFileSync('public/graph-plugins.json', JSON.stringify(out));
const top = [...nodes].sort((a, b) => b.downloads - a.downloads).slice(0, 5);
console.error(`完成：${nodes.length} 个插件，${byCategory.size} 个类别，${links.length} 条锚点线`);
console.error('下载量前五：' + top.map((n) => `${n.name}(${n.downloads})`).join('、'));
