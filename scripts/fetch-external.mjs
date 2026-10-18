// 从 OpenAlex（论文）与 GitHub（开源项目）拉真实数据，生成 public/graph-external.json
// 用法：node scripts/fetch-external.mjs [--papers 400] [--repos 300] [--dry]
//
// 设计要点：
// 1. 论文按「每个主题取高被引」拉，避免只有一个领域的论文
// 2. 引用关系只保留「两端都在数据集内」的边，否则会拖进几十万外部节点
// 3. 亮度（weight）按「同年份分桶内的引用百分位」算，否则老论文会通吃
// 4. 全程带 mailto，遵守 OpenAlex 的礼貌池约定

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MAILTO = '288989345+lk2168@users.noreply.github.com';
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const DRY = args.includes('--dry');
const PAPER_LIMIT_PER_TOPIC = argOf('papers', 400);
const MAX_REPOS = argOf('repos', 400);

// AI 的核心主题（OpenAlex topics，2024 年后取代了旧的 concepts）
const TOPICS = [
  ['T10036', '神经网络及其应用'],
  ['T10320', '神经网络方法'],
  ['T12072', '机器学习与算法'],
  ['T10462', '强化学习'],
  ['T10775', '生成对抗网络与图像合成'],
  ['T13910', '文本计算方法'],
  ['T11714', '多模态机器学习'],
  ['T10201', '语音识别与合成'],
];

// GitHub 上按 star 找 AI 相关仓库
const GH_QUERIES = [
  'topic:artificial-intelligence',
  'topic:machine-learning',
  'topic:deep-learning',
  'topic:llm',
  'topic:large-language-model',
  'topic:ai',
  'topic:agent',
  'topic:rag',
  'topic:prompt-engineering',
  'topic:stable-diffusion',
  'topic:comfyui',
  'topic:openai',
  'topic:transformer',
  'topic:fine-tuning',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': `ai-galaxy/0.1 (mailto:${MAILTO})`, Accept: 'application/json' },
        // 没有超时的话，一个卡住的连接就能让整个任务永远挂着
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`HTTP ${res.status} ${body}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt === tries) throw err;
      await sleep(600 * attempt);
    }
  }
}

// ── 论文 ──────────────────────────────────────────────────────────────
async function fetchPapers() {
  const byId = new Map();
  for (const [topicId, label] of TOPICS) {
    let page = 1;
    let got = 0;
    while (got < PAPER_LIMIT_PER_TOPIC) {
      const pageSize = Math.min(100, PAPER_LIMIT_PER_TOPIC - got);
      const url =
        `https://api.openalex.org/works?filter=topics.id:${topicId}` +
        `&sort=cited_by_count:desc&per-page=${pageSize}&page=${page}` +
        `&mailto=${MAILTO}&select=id,doi,title,publication_year,cited_by_count,referenced_works,type`;
      const data = await getJson(url);
      const rows = data.results ?? [];
      for (const w of rows) {
        const id = String(w.id ?? '').replace('https://openalex.org/', '');
        if (!id || byId.has(id)) continue;
        if (!w.publication_year) continue;
        // 只要正经论文/综述/会议文章，滤掉数据集与组件这类噪声
        if (w.type && !['article', 'review', 'preprint', 'book-chapter'].includes(w.type)) continue;
        byId.set(id, {
          openalexId: id,
          title: (w.title ?? '').replace(/\s+/g, ' ').trim(),
          year: w.publication_year,
          cited: w.cited_by_count ?? 0,
          doi: w.doi ?? null,
          topic: label,
          authors: (w.authorships ?? [])
            .slice(0, 3)
            .map((a) => a?.author?.display_name)
            .filter(Boolean),
          refs: (w.referenced_works ?? []).map((r) => String(r).replace('https://openalex.org/', '')),
        });
        got += 1;
      }
      if (rows.length === 0) break;
      page += 1;
      await sleep(150);
    }
    console.error(`  ${label}: 累计 ${got} 篇`);
  }
  return [...byId.values()];
}

// ── 开源项目 ──────────────────────────────────────────────────────────
async function fetchRepos() {
  const byFullName = new Map();
  for (const q of GH_QUERIES) {
    for (let page = 1; page <= 3; page += 1) {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}+stars:>400&sort=stars&order=desc&per_page=100&page=${page}`;
      let data;
      try {
        const res = await fetch(url, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'ai-galaxy/0.1',
            ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
          },
          signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      } catch (err) {
        console.error(`  GitHub ${q} 第 ${page} 页失败：${err.message}`);
        break;
      }
      for (const r of data.items ?? []) {
        if (r.archived) continue;
        if (byFullName.has(r.full_name)) continue;
        byFullName.set(r.full_name, {
          fullName: r.full_name,
          stars: r.stargazers_count,
          forks: r.forks_count,
          language: r.language,
          createdAt: r.created_at,
          pushedAt: r.pushed_at,
          description: (r.description ?? '').trim(),
          topics: r.topics ?? [],
          url: r.html_url,
          fork: r.fork,
        });
      }
      if ((data.items ?? []).length < 100) break;
      if (byFullName.size >= MAX_REPOS) break;
      await sleep(1200); // 搜索接口对未认证请求限得比较紧
    }
    console.error(`  ${q}: 累计 ${byFullName.size} 个仓库`);
    if (byFullName.size >= MAX_REPOS) break;
  }
  return [...byFullName.values()].slice(0, MAX_REPOS);
}

// ── 亮度归一化：同年份桶内的引用百分位 ────────────────────────────────
function weightFromCite(papers) {
  const buckets = new Map();
  for (const p of papers) {
    const dec = Math.floor(p.year / 5) * 5;
    if (!buckets.has(dec)) buckets.set(dec, []);
    buckets.get(dec).push(p.cited);
  }
  for (const arr of buckets.values()) arr.sort((a, b) => a - b);
  const pct = (dec, v) => {
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
    // 百分位压到 20–100：即使桶里最低的那篇也不至于完全黑掉
    p.weight = Math.round(20 + pct(dec, p.cited) * 80);
  }
}

function weightFromStar(repos) {
  const vals = repos.map((r) => Math.log10(Math.max(1, r.stars)));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  repos.forEach((r, i) => {
    const t = max > min ? (vals[i] - min) / (max - min) : 0.5;
    r.weight = Math.round(30 + t * 70);
  });
}

// ── 主流程 ────────────────────────────────────────────────────────────
const t0 = Date.now();
console.error('拉取论文（OpenAlex）…');
const papers = await fetchPapers();
weightFromCite(papers);

console.error('拉取开源项目（GitHub）…');
const repos = await fetchRepos();
weightFromStar(repos);

// 建立节点
const nodes = [];
for (const p of papers) {
  nodes.push({
    id: `oa:${p.openalexId}`,
    layer: 'paper',
    type: 'paper',
    name: p.title,
    year: p.year,
    weight: p.weight,
    cited: p.cited,
    topic: p.topic,
    authors: p.authors,
    url: p.doi ? `https://doi.org/${String(p.doi).replace('https://doi.org/', '')}` : `https://openalex.org/${p.openalexId}`,
  });
}
for (const r of repos) {
  const year = Number(String(r.createdAt).slice(0, 4));
  nodes.push({
    id: `gh:${r.fullName}`,
    layer: 'project',
    type: 'project',
    name: r.fullName,
    year: Number.isFinite(year) ? year : 2008,
    weight: r.weight,
    stars: r.stars,
    forks: r.forks,
    language: r.language,
    summary: r.description,
    topics: r.topics,
    url: r.url,
  });
}

// 引用边：只保留两端都在集合内的
const paperIds = new Set(papers.map((p) => `oa:${p.openalexId}`));
const links = [];
const seen = new Set();
// 每篇最多留 3 条出边（指向集合内被引最高的），避免边数爆炸
const byIdMap = new Map(papers.map((p) => [p.openalexId, p]));
for (const p of papers) {
  const inside = p.refs.filter((r) => paperIds.has(`oa:${r}`));
  if (!inside.length) continue;
  inside.sort((a, b) => (byIdMap.get(b)?.cited ?? 0) - (byIdMap.get(a)?.cited ?? 0));
  for (const ref of inside.slice(0, 3)) {
    const a = `oa:${p.openalexId}`;
    const b = `oa:${ref}`;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: a, target: b, relation: '引用', strength: 3 });
  }
}

const out = {
  meta: {
    generatedAt: new Date().toISOString(),
    papers: papers.length,
    repos: repos.length,
    nodes: nodes.length,
    links: links.length,
    years: [Math.min(...nodes.map((n) => n.year)), Math.max(...nodes.map((n) => n.year))],
  },
  nodes,
  links,
};

console.error(
  `完成：${nodes.length} 个节点（论文 ${papers.length}，项目 ${repos.length}），${links.length} 条引用边，耗时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`,
);
if (!DRY) {
  const path = 'public/graph-external.json';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(out));
  console.error(`已写入 ${path}`);
} else {
  console.error('（--dry 模式，未写文件）');
}



