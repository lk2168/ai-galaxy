// 从 Crossref 拉 AI 领域的高被引论文，生成 public/graph-papers.json
// 用法：node scripts/fetch-crossref.mjs [--per 1000] [--queries 14]
//
// 为什么用 Crossref 而不是 OpenAlex：
//   OpenAlex 免费额度按 IP 共享（$0.10/天），本机这个 IP 被别人用光了；
//   Crossref 不需要 key、没有共享预算，而且 works 记录里直接带 reference 列表，
//   引用边可以自己算出来。

import { writeFileSync, mkdirSync } from 'node:fs';

const MAILTO = '288989345+lk2168@users.noreply.github.com';
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const PER_QUERY = argOf('per', 1000);

// 覆盖 AI 各条主线，避免只拿到一个领域的论文
const QUERIES = [
  'deep learning',
  'neural network',
  'machine learning',
  'convolutional neural network',
  'reinforcement learning',
  'natural language processing',
  'computer vision',
  'generative adversarial network',
  'transformer neural network',
  'large language model',
  'object detection',
  'speech recognition',
  'image classification',
  'attention mechanism',
].slice(0, argOf('queries', 14));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': `ai-galaxy/0.1 (mailto:${MAILTO})`, Accept: 'application/json' },
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 200);
        throw new Error(`HTTP ${res.status} ${body}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt === tries) throw err;
      await sleep(1500 * attempt);
    }
  }
}

const yearOf = (item) => {
  const parts = item.issued?.['date-parts']?.[0];
  return parts && parts[0] ? Number(parts[0]) : null;
};

const doiOf = (item) => (typeof item.DOI === 'string' ? item.DOI.toLowerCase() : null);

const titleOf = (item) => {
  const t = Array.isArray(item.title) ? item.title[0] : item.title;
  return typeof t === 'string' ? t.replace(/\s+/g, ' ').replace(/<[^>]+>/g, '').trim() : '';
};

const t0 = Date.now();
const byDoi = new Map();

for (const q of QUERIES) {
  const url =
    `https://api.crossref.org/works?query.title=${encodeURIComponent(q)}` +
    `&rows=${PER_QUERY}&sort=is-referenced-by-count&order=desc` +
    `&select=DOI,title,issued,is-referenced-by-count,author,reference,type` +
    `&mailto=${MAILTO}`;
  let msg;
  try {
    const data = await getJson(url);
    msg = data.message;
  } catch (err) {
    console.error(`  「${q}」失败：${err.message}`);
    continue;
  }

  let added = 0;
  for (const item of msg.items ?? []) {
    const doi = doiOf(item);
    const year = yearOf(item);
    const title = titleOf(item);
    if (!doi || !year || !title) continue;
    if (year < 1940 || year > 2026) continue;
    // 只要论文与会议/书章，滤掉数据集、组件这类条目
    if (item.type && !['journal-article', 'proceedings-article', 'book-chapter', 'posted-content'].includes(item.type)) continue;
    if (byDoi.has(doi)) continue;

    const refs = (item.reference ?? [])
      .map((r) => (typeof r.DOI === 'string' ? r.DOI.toLowerCase() : null))
      .filter(Boolean);

    byDoi.set(doi, {
      doi,
      title,
      year,
      cited: Number(item['is-referenced-by-count']) || 0,
      authors: (item.author ?? [])
        .slice(0, 3)
        .map((a) => [a.given, a.family].filter(Boolean).join(' ').trim())
        .filter(Boolean),
      refs,
      query: q,
    });
    added += 1;
  }
  console.error(`  「${q}」+${added}，累计 ${byDoi.size}`);
  await sleep(600);
}

// —— 亮度：同年份桶内的引用百分位，避免老论文通吃 ——
const papers = [...byDoi.values()];
const buckets = new Map();
for (const p of papers) {
  const dec = Math.floor(p.year / 5) * 5;
  if (!buckets.has(dec)) buckets.set(dec, []);
  buckets.get(dec).push(p.cited);
}
for (const arr of buckets.values()) arr.sort((a, b) => a - b);
const percentile = (dec, v) => {
  const arr = buckets.get(dec);
  if (!arr?.length) return 0.5;
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo / Math.max(1, arr.length - 1);
};
for (const p of papers) {
  const dec = Math.floor(p.year / 5) * 5;
  p.weight = Math.round(18 + percentile(dec, p.cited) * 82);
}

// —— 节点与引用边 ——
const nodes = papers.map((p) => ({
  id: `cr:${p.doi}`,
  layer: 'paper',
  type: 'paper',
  name: p.title,
  year: p.year,
  weight: p.weight,
  cited: p.cited,
  authors: p.authors,
  summary: p.authors.length ? p.authors.join('、') : '',
  url: `https://doi.org/${p.doi}`,
}));

const idSet = new Set(nodes.map((n) => n.id));
const links = [];
const seen = new Set();
for (const p of papers) {
  // 每篇最多留 3 条出边，否则边数会爆炸到几十万
  let kept = 0;
  for (const ref of p.refs) {
    if (kept >= 3) break;
    const target = `cr:${ref}`;
    if (!idSet.has(target) || target === `cr:${p.doi}`) continue;
    const a = `cr:${p.doi}`;
    const key = a < target ? `${a}|${target}` : `${target}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: a, target, relation: '引用', strength: 3 });
    kept += 1;
  }
}

const out = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: 'crossref',
    papers: nodes.length,
    nodes: nodes.length,
    links: links.length,
    years: [Math.min(...nodes.map((n) => n.year)), Math.max(...nodes.map((n) => n.year))],
  },
  nodes,
  links,
};

mkdirSync('public', { recursive: true });
writeFileSync('public/graph-papers.json', JSON.stringify(out));
console.error(
  `完成：${nodes.length} 篇论文，${links.length} 条引用边，耗时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`,
);

