// 给已有的骨架节点补上 family 字段（哪些模型属于哪个家族）
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const DIR = 'data/nodes';

const FAMILY_OF = {
  // OpenAI
  'gpt': 'openai',
  'gpt-2': 'openai',
  'gpt-3': 'openai',
  'chatgpt': 'openai',
  'gpt-4': 'openai',
  'o1': 'openai',
  'sora': 'openai',
  'dall-e': 'openai',
  'instructgpt': 'openai',
  // Anthropic
  'claude': 'anthropic',
  // Google
  'gemini': 'google',
  'bert': 'google',
  'alphafold2': 'google',
  // Meta
  'llama': 'meta',
  // DeepSeek
  'deepseek': 'deepseek',
  'deepseek-v3': 'deepseek',
  'deepseek-r1': 'deepseek',
  'deepseek-harness': 'deepseek',
  // Stability
  'stable-diffusion': 'stability',
};

let changed = 0;
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.yaml')) continue;
  const path = `${DIR}/${f}`;
  const lines = readFileSync(path, 'utf8').split('\n');
  const out = [];
  let currentId = null;
  let inserted = false;

  for (const line of lines) {
    const idMatch = /^- id:\s*(\S+)/.exec(line);
    if (idMatch) {
      currentId = idMatch[1];
      inserted = false;
      out.push(line);
      continue;
    }
    // 在 weight 之后插入 family（保持字段顺序好看一点）
    if (currentId && !inserted && /^\s+weight:/.test(line)) {
      out.push(line);
      const family = FAMILY_OF[currentId];
      if (family) {
        out.push(`  family: ${family}`);
        inserted = true;
        changed += 1;
      }
      continue;
    }
    out.push(line);
  }
  writeFileSync(path, out.join('\n'));
}
console.log(`已为 ${changed} 个节点补上 family`);
