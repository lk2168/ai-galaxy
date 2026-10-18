// 按家族自动生成「模型演进链」：同家族内按年份串成一条线
import { readFileSync, readdirSync, appendFileSync, writeFileSync } from 'node:fs';
import yaml from 'js-yaml';

const DIR = 'data/nodes';
const all = [];
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.yaml')) continue;
  const arr = yaml.load(readFileSync(`${DIR}/${f}`, 'utf8')) ?? [];
  for (const n of arr) all.push(n);
}

const existing = yaml.load(readFileSync('data/links.yaml', 'utf8')) ?? [];
const seen = new Set();
for (const l of existing) {
  const k = l.source < l.target ? `${l.source}|${l.target}` : `${l.target}|${l.source}`;
  seen.add(k);
}

const byFamily = new Map();
for (const n of all) {
  if (!n.family) continue;
  if (!byFamily.has(n.family)) byFamily.set(n.family, []);
  byFamily.get(n.family).push(n);
}

let added = 0;
const lines = ['', '# ── 自动生成的家族演进链（同家族按年份串联）─────────────────────'];
for (const [family, arr] of byFamily) {
  arr.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
  for (let i = 1; i < arr.length; i += 1) {
    const a = arr[i - 1].id;
    const b = arr[i].id;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push(`- { source: ${a}, target: ${b}, relation: 改进, strength: 3 }`);
    added += 1;
  }
  if (arr.length === 1) {
    // 独苗家族：连到它最接近的机构节点，避免孤立
    const anchor = { openai: 'openai', anthropic: 'anthropic', google: 'google-brain', meta: 'meta-ai', deepseek: 'deepseek' }[family];
    if (anchor) {
      const k = arr[0].id < anchor ? `${arr[0].id}|${anchor}` : `${anchor}|${arr[0].id}`;
      if (!seen.has(k)) {
        seen.add(k);
        lines.push(`- { source: ${arr[0].id}, target: ${anchor}, relation: 合作, strength: 2 }`);
        added += 1;
      }
    }
  }
}
appendFileSync('data/links.yaml', `\n${lines.join('\n')}\n`);
console.log(`新增 ${added} 条家族演进连线，覆盖 ${byFamily.size} 个家族`);
