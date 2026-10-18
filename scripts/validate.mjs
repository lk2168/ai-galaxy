// 数据校验脚本
// 用法：node scripts/validate.mjs
// 读取 data/nodes/*.yaml 与 data/links.yaml，校验节点与关系是否符合规范
// 有错误时退出码为 1；只有警告时退出码为 0

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';

// 项目根目录（scripts 的上级）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');

// 节点类型枚举
const TYPE_ENUM = ['person', 'paper', 'model', 'org', 'concept', 'event', 'project'];
// 关系类型枚举
const RELATION_ENUM = ['提出', '奠基', '继承', '改进', '取代', '合作', '发布', '推动', '影响', '竞争', '反驳'];
// id 合法字符：小写字母、数字、连字符
const ID_RE = /^[a-z0-9-]+$/;

// 收集错误（致命）与警告（非致命）
const errors = [];
const warnings = [];

// 读取并解析单个 YAML 文件，返回解析后的数组（出错时返回空数组并记录错误）
function loadYamlArray(absolutePath, label) {
  let raw;
  try {
    raw = readFileSync(absolutePath, 'utf8');
  } catch {
    // 关系文件或节点目录可能尚不存在：当作空，不致命
    return [];
  }
  let data;
  try {
    data = yaml.load(raw);
  } catch (e) {
    errors.push(`❌ ${label} — YAML 解析失败：${e.message}`);
    return [];
  }
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data)) {
    errors.push(`❌ ${label} — 顶层必须是 YAML 数组`);
    return [];
  }
  return data;
}

// 计算字符串实际字符数（用展开运算符，避免 emoji/代理对被算成 2）
function charLength(str) {
  return [...String(str)].length;
}

// ---------- 解析节点 ----------
const nodesDir = join(root, 'data', 'nodes');
const nodeFiles = existsSync(nodesDir)
  ? readdirSync(nodesDir).filter((f) => f.endsWith('.yaml'))
  : [];

const nodes = [];          // 全部节点
const idToFile = new Map(); // id -> 来源文件名（用于检测重复与定位）

for (const file of nodeFiles) {
  const list = loadYamlArray(join(nodesDir, file), file);
  for (const item of list) {
    if (item === null || typeof item !== 'object') {
      errors.push(`❌ ${file} — 存在非对象条目`);
      continue;
    }
    const id = item.id;

    // id 存在性
    if (id === undefined || id === null) {
      errors.push(`❌ ${file} — 存在缺少 id 的条目`);
      continue;
    }

    // id 唯一性
    if (idToFile.has(id)) {
      errors.push(`❌ ${file}:${id} — id 重复（已在 ${idToFile.get(id)} 定义）`);
      continue;
    }
    idToFile.set(id, file);

    // id 字符规则
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      errors.push(`❌ ${file}:${id} — id 只能含小写字母、数字和连字符`);
    }

    // type 枚举
    if (!TYPE_ENUM.includes(item.type)) {
      errors.push(`❌ ${file}:${id} — type 必须是 ${TYPE_ENUM.join('|')} 之一`);
    }

    // year：1800–2100 整数
    const year = item.year;
    if (typeof year !== 'number' || !Number.isInteger(year) || year < 1800 || year > 2100) {
      errors.push(`❌ ${file}:${id} — year 必须是 1800–2100 的整数`);
    }

    // weight：0–100 的数字
    const weight = item.weight;
    if (typeof weight !== 'number' || Number.isNaN(weight) || weight < 0 || weight > 100) {
      errors.push(`❌ ${file}:${id} — weight 必须是 0–100 的数字`);
    }

    // summary：10–200 字
    const summary = item.summary;
    if (typeof summary !== 'string' || charLength(summary) < 10 || charLength(summary) > 200) {
      errors.push(`❌ ${file}:${id} — summary 长度需在 10–200 字之间`);
    }

    // sources：至少 1 条，且每条以 https:// 开头
    const sources = item.sources;
    if (!Array.isArray(sources) || sources.length < 1) {
      errors.push(`❌ ${file}:${id} — sources 至少要有 1 条`);
    } else if (!sources.every((s) => typeof s === 'string' && s.startsWith('https://'))) {
      errors.push(`❌ ${file}:${id} — sources 每条都必须以 https:// 开头`);
    }

    // tags：字符串数组
    const tags = item.tags;
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) {
      errors.push(`❌ ${file}:${id} — tags 必须是字符串数组`);
    }

    nodes.push(item);
  }
}

// ---------- 解析关系 ----------
const links = loadYamlArray(join(root, 'data', 'links.yaml'), 'links.yaml');
const pairSeen = new Set();   // 已出现的 (source,target) 有序对
const degree = new Map();     // id -> 连边数

for (const link of links) {
  if (link === null || typeof link !== 'object') {
    errors.push(`❌ links.yaml — 存在非对象条目`);
    continue;
  }
  const { source, target, relation, strength } = link;

  // source 存在性
  if (!idToFile.has(source)) {
    errors.push(`❌ links.yaml:${source} — source 节点不存在`);
  }
  // target 存在性
  if (!idToFile.has(target)) {
    errors.push(`❌ links.yaml:${target} — target 节点不存在`);
  }
  // relation 枚举
  if (!RELATION_ENUM.includes(relation)) {
    errors.push(`❌ links.yaml — relation 必须是 ${RELATION_ENUM.join('|')} 之一`);
  }
  // strength：1–5 整数
  if (typeof strength !== 'number' || !Number.isInteger(strength) || strength < 1 || strength > 5) {
    errors.push(`❌ links.yaml — strength 必须是 1–5 的整数`);
  }
  // 自环
  if (source !== undefined && source === target) {
    errors.push(`❌ links.yaml:${source} — 不允许自环（${source} → ${target}）`);
  }
  // 重复对（按 source→target 有序对判定）
  if (source !== undefined && target !== undefined) {
    const key = `${source}__${target}`;
    if (pairSeen.has(key)) {
      errors.push(`❌ links.yaml:${source} — 重复关系：${source} → ${target}`);
    } else {
      pairSeen.add(key);
    }
  }
  // 统计度数（仅当两端均为合法节点）
  if (idToFile.has(source)) degree.set(source, (degree.get(source) || 0) + 1);
  if (idToFile.has(target)) degree.set(target, (degree.get(target) || 0) + 1);
}

// ---------- 孤立节点检查（仅警告）----------
const isolated = nodes
  .filter((n) => !(degree.get(n.id) > 0))
  .map((n) => n.id);
if (isolated.length > 0) {
  warnings.push(`⚠️ 孤立节点（尚无任何边，可能尚未连线）：${isolated.join(', ')}`);
}

// ---------- 输出 ----------
for (const e of errors) console.log(e);
for (const w of warnings) console.log(w);

if (errors.length > 0) {
  console.log(`\n共发现 ${errors.length} 个错误、${warnings.length} 个警告。`);
  process.exit(1);
}

if (warnings.length > 0) {
  console.log(`\n✅ 校验通过（含 ${warnings.length} 条警告）：${nodes.length} 个节点，${links.length} 条关系`);
  process.exit(0);
}

console.log(`✅ 校验通过：${nodes.length} 个节点，${links.length} 条关系`);
process.exit(0);
