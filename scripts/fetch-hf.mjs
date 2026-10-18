// 从 HuggingFace（走国内镜像）拉模型，生成 public/graph-hf.json
// 用法：node scripts/fetch-hf.mjs [--pages 20] [--per 1000]
//
// 为什么用它：HF 上有上百万个模型，按下载量排序取前两万，
// 星图一下就能密到接近诗云那种「银河」的质感。

import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://hf-mirror.com/api/models';
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const PAGES = argOf('pages', 20);
const PER = argOf('per', 1000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ORG_TO_FAMILY = {
  'meta-llama': 'meta',
  'facebook': 'meta',
  'openai': 'openai',
  'Qwen': 'qwen',
  'deepseek-ai': 'deepseek',
  'mistralai': 'mistral',
  'google': 'google',
  'microsoft': 'microsoft',
  'stabilityai': 'stability',
  'THUDM': 'zhipu',
  'THU-KEG': 'zhipu',
  'moonshotai': 'moonshot',
  'baichuan-inc': 'baichuan',
  '01-ai': 'yi',
  'internlm': 'shanghai-ai-lab',
  'OpenGVLab': 'shanghai-ai-lab',
  'openbmb': 'modelbest',
  'Tencent': 'tencent',
  'ByteDance': 'bytedance',
  'MiniMaxAI': 'minimax',
  'xai-org': 'xai',
  'cohere': 'cohere',
  'nvidia': 'nvidia',
  'ai21labs': 'ai21',
  'tiiuae': 'uae',
  'allenai': 'allenai',
  'EleutherAI': 'eleuther',
  'bigscience': 'bigscience',
  'BAAI': 'baidu',
  'ernie-research': 'baidu',
  'PaddlePaddle': 'baidu',
};

function familyOf(id) {
  const org = id.split('/')[0];
  if (ORG_TO_FAMILY[org]) return ORG_TO_FAMILY[org];
  const low = id.toLowerCase();
  if (low.includes('llama')) return 'meta';
  if (low.includes('qwen')) return 'qwen';
  if (low.includes('deepseek')) return 'deepseek';
  if (low.includes('mistral') || low.includes('mixtral')) return 'mistral';
  if (low.includes('gemma')) return 'google';
  if (low.includes('phi-')) return 'microsoft';
  if (low.includes('glm') || low.includes('chatglm')) return 'zhipu';
  if (low.includes('stable-diffusion') || low.includes('sdxl')) return 'stability';
  if (low.includes('whisper') || low.includes('gpt')) return 'openai';
  if (low.includes('falcon')) return 'uae';
  if (low.includes('bloom')) return 'bigscience';
  return null;
}

const seen = new Set();
const models = [];

for (let page = 1; page <= PAGES; page += 1) {
  const skip = (page - 1) * PER;
  // hf-mirror 不认 page / cursor，只认 skip
  const url = `${BASE}?sort=downloads&direction=-1&limit=${PER}&skip=${skip}&full=true`;
  let list;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ai-galaxy/0.1' },
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    list = await res.json();
  } catch (err) {
    console.error(`  第 ${page} 页失败：${err.message}`);
    await sleep(1500);
    continue;
  }
  if (!Array.isArray(list) || list.length === 0) break;

  let added = 0;
  for (const m of list) {
    if (!m || typeof m.id !== 'string' || seen.has(m.id)) continue;
    seen.add(m.id);
    const downloads = Number(m.downloads) || 0;
    if (downloads <= 0) continue;
    const created = m.createdAt ? new Date(m.createdAt) : null;
    const year = created && !Number.isNaN(created.getTime()) ? created.getFullYear() : 2024;
    if (year < 2017 || year > 2026) continue;
    models.push({
      id: m.id,
      downloads,
      likes: Number(m.likes) || 0,
      year,
      pipeline: m.pipeline_tag ?? m.pipelineTag ?? '',
      tags: (m.tags ?? []).slice(0, 6),
      family: familyOf(m.id),
    });
    added += 1;
  }
  console.error(`  第 ${page} 页 +${added}，累计 ${models.length}`);
  if (list.length < PER) break;
  await sleep(250);
}

// 亮度：下载量取对数后归一化
const vals = models.map((m) => Math.log10(1 + m.downloads));
const max = Math.max(...vals);
const min = Math.min(...vals);
models.forEach((m, i) => {
  const t = max > min ? (vals[i] - min) / (max - min) : 0.3;
  m.weight = Math.round(16 + t * 84);
});

const nodes = models.map((m) => ({
  id: `hf:${m.id}`,
  layer: 'model',
  type: 'model',
  name: m.id,
  year: m.year,
  weight: m.weight,
  downloads: m.downloads,
  likes: m.likes,
  family: m.family ?? undefined,
  summary: [m.pipeline, m.tags.slice(0, 3).join('、')].filter(Boolean).join(' · ').slice(0, 120),
  url: `https://huggingface.co/${m.id}`,
}));

const out = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: 'huggingface (hf-mirror)',
    nodes: nodes.length,
    links: 0,
    years: [Math.min(...nodes.map((n) => n.year)), Math.max(...nodes.map((n) => n.year))],
  },
  nodes,
  links: [],
};

mkdirSync('public', { recursive: true });
writeFileSync('public/graph-hf.json', JSON.stringify(out));
console.error(`完成：${nodes.length} 个模型`);

