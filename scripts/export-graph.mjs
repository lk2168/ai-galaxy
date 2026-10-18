// 把 YAML 数据合并成前端使用的 public/graph.json
// 用法：node scripts/export-graph.mjs
// 生成结构：{ nodes: [...], links: [...], meta: { generatedAt, nodeCount, linkCount, years:[最小,最大] } }

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';

// 项目根目录（scripts 的上级）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');

const nodesDir = join(root, 'data', 'nodes');
const linksPath = join(root, 'data', 'links.yaml');

// 读取所有节点文件
const nodeFiles = existsSync(nodesDir)
  ? readdirSync(nodesDir).filter((f) => f.endsWith('.yaml'))
  : [];
const nodes = [];
for (const file of nodeFiles) {
  const data = yaml.load(readFileSync(join(nodesDir, file), 'utf8'));
  if (Array.isArray(data)) nodes.push(...data);
}

// 读取关系文件
let links = [];
if (existsSync(linksPath)) {
  const data = yaml.load(readFileSync(linksPath, 'utf8'));
  if (Array.isArray(data)) links = data;
}

// 计算每个节点的度数（无论作为 source 还是 target 都 +1，供前端调亮度）
const degree = new Map();
for (const link of links) {
  if (!link) continue;
  if (link.source) degree.set(link.source, (degree.get(link.source) || 0) + 1);
  if (link.target) degree.set(link.target, (degree.get(link.target) || 0) + 1);
}

// 节点保留全部原始字段，并补充 degree
const outNodes = nodes.map((n) => ({ ...n, degree: degree.get(n.id) || 0 }));

// 关系里的 source/target 转成前端库要的字符串 id
const outLinks = links.map((l) => ({
  source: String(l.source),
  target: String(l.target),
  relation: l.relation,
  strength: l.strength,
}));

// 年份范围
const years = nodes.map((n) => Number(n.year)).filter((y) => Number.isFinite(y));
const minYear = years.length ? Math.min(...years) : null;
const maxYear = years.length ? Math.max(...years) : null;

const graph = {
  nodes: outNodes,
  links: outLinks,
  meta: {
    generatedAt: new Date().toISOString(),
    nodeCount: outNodes.length,
    linkCount: outLinks.length,
    years: [minYear, maxYear],
  },
};

// 写出到 public/graph.json（确保目录存在）
const outDir = join(root, 'public');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'graph.json');
writeFileSync(outPath, JSON.stringify(graph, null, 2), 'utf8');

console.log(
  `已生成 ${outPath}：节点 ${outNodes.length} 个，关系 ${outLinks.length} 条，年份跨度 ${minYear ?? '—'}–${maxYear ?? '—'}`
);
