// 给「独苗家族」补一条连到主盘的边，避免它们在图上孤零零地飘着
import { readFileSync, appendFileSync } from 'node:fs';

const ANCHOR = {
  'nemotron-4': 'nvidia',
  'command-r': 'transformer',
  'jamba': 'transformer',
  'pi': 'eliza-effect',
  'olmo': 'llama',
  'pythia': 'transformer',
  'gen-3': 'ddpm',
  'minimax-01': 'attention-mechanism',
  'sensenova': 'alexnet',
  'spark': 'whisper',
  'baichuan-2': 'llama',
  'yi': 'llama',
  'step-1': 'ai-agent',
  'minicpm': 'llama',
  'pangu': 'expert-system',
  'luminous': 'gpt-3',
  'bloom': 'llama',
  'sarvam-1': 'bert',
  'allam': 'bert',
};

const lines = ['', '# ── 独苗家族挂到主盘上的血缘 ──────────────────────────────────'];
for (const [id, target] of Object.entries(ANCHOR)) {
  lines.push(`- { source: ${id}, target: ${target}, relation: 继承, strength: 2 }`);
}
appendFileSync('data/links.yaml', `\n${lines.join('\n')}\n`);
console.log(`已为 ${Object.keys(ANCHOR).length} 个独苗家族补上连线`);
