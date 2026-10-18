import type { GraphNode } from './types';

/**
 * 单中心布局：Transformer 在正中心，其余一切按「离 2017 年有多远」向外展开。
 *
 * 为什么这样改：
 *   双星系并排看着好看，但它讲的故事是「两个时代并列」。
 *   真实的故事是「一切最终都汇到 Transformer 这一个架构上」——
 *   早期的东西是它的前提，晚期的东西是它的后代。所以只有一个中心，
 *   中心是一颗黑洞（事件视界 + 吸积盘），所有星绕着它转。
 *
 * 极坐标：
 *   θ = 流派扇区（8 条旋臂）+ 随半径扭转，看起来是旋涡
 *   r = |年份 - 2017| 的幂映射；2017 在中心，越早/越晚都在外圈
 *   早期与晚期分别落在中心的两侧，形成展开的双翼
 */

export const SPLIT_YEAR = 2017;

/** 左半边（早期）的旋臂 */
export const FOUNDATION_ARMS = ['符号主义', '连接主义', '统计学习', '深度学习'] as const;
/** 右半边（晚期）的旋臂 */
export const EMERGENCE_ARMS = ['大模型', '开源与推理', '多模态与生成', '智能体'] as const;

/** 中心：黑洞所在（Transformer 就嵌在这里） */
export const GALAXY_CENTER = { x: 0, y: 0, z: 0 };
/** 插件星团单独浮在主盘外侧，像一颗伴星系 */
// 插件星团的位置由 pluginCenter() 算出来：它挂在 DeepSeek 家族旁边

/** 模型家族：每个家族是一颗环绕主星系的卫星星团（40 个，按地区与影响力排） */
export const FAMILIES = [
  { id: 'openai', label: 'OpenAI', region: 'us' },
  { id: 'anthropic', label: 'Anthropic', region: 'us' },
  { id: 'google', label: 'Google', region: 'us' },
  { id: 'meta', label: 'Meta / LLaMA', region: 'us' },
  { id: 'microsoft', label: '微软 Phi', region: 'us' },
  { id: 'xai', label: 'xAI', region: 'us' },
  { id: 'amazon', label: '亚马逊', region: 'us' },
  { id: 'nvidia', label: '英伟达', region: 'us' },
  { id: 'cohere', label: 'Cohere', region: 'us' },
  { id: 'ai21', label: 'AI21', region: 'other' },
  { id: 'inflection', label: 'Inflection', region: 'us' },
  { id: 'allenai', label: 'Allen AI', region: 'us' },
  { id: 'eleuther', label: 'EleutherAI', region: 'us' },
  { id: 'runway', label: 'Runway', region: 'us' },
  { id: 'stability', label: 'Stability', region: 'other' },
  { id: 'deepseek', label: 'DeepSeek', region: 'cn' },
  { id: 'qwen', label: '阿里 Qwen', region: 'cn' },
  { id: 'zhipu', label: '智谱 GLM', region: 'cn' },
  { id: 'moonshot', label: '月之暗面', region: 'cn' },
  { id: 'bytedance', label: '字节豆包', region: 'cn' },
  { id: 'tencent', label: '腾讯混元', region: 'cn' },
  { id: 'minimax', label: 'MiniMax', region: 'cn' },
  { id: 'baidu', label: '百度文心', region: 'cn' },
  { id: 'sensetime', label: '商汤', region: 'cn' },
  { id: 'iflytek', label: '讯飞星火', region: 'cn' },
  { id: 'baichuan', label: '百川', region: 'cn' },
  { id: 'yi', label: '零一万物', region: 'cn' },
  { id: 'stepfun', label: '阶跃星辰', region: 'cn' },
  { id: 'shanghai-ai-lab', label: '上海 AI Lab', region: 'cn' },
  { id: 'modelbest', label: '面壁', region: 'cn' },
  { id: 'huawei', label: '华为盘古', region: 'cn' },
  { id: 'mistral', label: 'Mistral', region: 'other' },
  { id: 'aleph-alpha', label: 'Aleph Alpha', region: 'other' },
  { id: 'bigscience', label: 'BigScience', region: 'other' },
  { id: 'uae', label: '阿联酋 TII', region: 'other' },
  { id: 'sarvam', label: '印度 Sarvam', region: 'other' },
  { id: 'korea', label: '韩国', region: 'other' },
  { id: 'japan', label: '日本', region: 'other' },
  { id: 'russia', label: '俄罗斯', region: 'other' },
  { id: 'allam', label: '沙特', region: 'other' },
] as const;

export const FAMILY_R = 880;

/** 第 i 个家族星团的球心：美国 / 中国 / 其他地区各占一段扇区，标签不再挤在一起 */
export function familyCenter(i: number) {
  const fam = FAMILIES[i];
  const buckets: Record<string, number[]> = { us: [], cn: [], other: [] };
  FAMILIES.forEach((f, idx) => buckets[f.region].push(idx));
  const list = buckets[fam.region];
  const pos = Math.max(0, list.indexOf(i));
  const total = Math.max(1, list.length);

  const [start, span] =
    fam.region === 'us' ? [0.15, 2.0] : fam.region === 'cn' ? [2.3, 2.05] : [4.5, 1.55];
  const a = start + (total > 1 ? pos / (total - 1) : 0.5) * span;
  const rr = FAMILY_R + (pos % 2) * 95;

  return {
    x: Math.cos(a) * rr,
    y: 120 + (pos % 3) * 100,
    z: Math.sin(a) * rr,
  };
}

/**
 * 一颗星属于哪个家族。
 * 骨架模型直接读 family 字段；开源项目按名字和简介匹配品牌词。
 */
export function familyOf(node: GraphNode & { family?: string; layer?: string }): string | null {
  if (node.family) return node.family;
  if (node.layer !== 'project' && node.layer !== 'model') return null;
  const topics = ((node as GraphNode).topics ?? []).join(' ');
  const hay = `${node.name} ${node.summary ?? ''} ${topics}`.toLowerCase();
  if (/deepseek/.test(hay)) return 'deepseek';
  if (/anthropic|claude/.test(hay)) return 'anthropic';
  if (/mistral|mixtral/.test(hay)) return 'mistral';
  if (/qwen|tongyi/.test(hay)) return 'qwen';
  if (/chatglm|zhipu|glm-4/.test(hay)) return 'zhipu';
  if (/kimi|moonshot/.test(hay)) return 'moonshot';
  if (/stable-?diffusion|sdxl|stabilityai/.test(hay)) return 'stability';
  if (/grok|xai/.test(hay)) return 'xai';
  if (/llama|meta-llama/.test(hay)) return 'meta';
  if (/openai|chatgpt|dall-e|whisper/.test(hay)) return 'openai';
  if (/gemini|google-deepmind|gemma/.test(hay)) return 'google';
  return null;
}

const CORE_HOLE = 78;
const MAX_R = 1250;
const MAX_DELTA_YEARS = 76; // 1941 到 2017 的距离

/** 每种节点的颜色（骨架层用，sRGB） */
export const TYPE_COLORS: Record<string, [number, number, number]> = {
  person: [1.0, 0.82, 0.48],
  paper: [0.42, 0.89, 0.92],
  model: [1.0, 0.6, 0.3],
  org: [0.48, 0.64, 1.0],
  concept: [0.65, 0.55, 1.0],
  event: [1.0, 0.42, 0.62],
  project: [0.55, 0.95, 0.72],
};

export const TYPE_LABELS: Record<string, string> = {
  person: '人物',
  paper: '论文',
  model: '模型',
  org: '机构',
  concept: '概念',
  event: '事件',
  project: '开源项目',
};

export const LAYER_LABELS: Record<string, string> = {
  skeleton: '史书骨架',
  paper: '论文',
  project: '开源项目',
  plugin: 'DSH 插件',
};

/** HSL → RGB */
export function hsl(h: number, s: number, l: number): [number, number, number] {
  const hue = ((((h % 360) + 360) % 360) / 360);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const chan = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [chan(hue + 1 / 3), chan(hue), chan(hue - 1 / 3)];
}

export interface PlacedStar {
  node: GraphNode;
  index: number;
  x: number;
  y: number;
  z: number;
  size: number;
  rgb: [number, number, number];
  arm: number;
  side: 'foundation' | 'emergence';
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** 一颗星属于哪条旋臂（0-7） */
function armOf(node: GraphNode & { topic?: string; category?: string }): number {
  const tags = (node.tags ?? []).join(' ');
  const topic = node.topic ?? '';
  const isFoundation = node.year < SPLIT_YEAR;

  if (topic) {
    if (/强化学习/.test(topic)) return 5;
    if (/生成|多模态/.test(topic)) return 6;
    if (/语音/.test(topic)) return 7;
    if (/文本/.test(topic)) return 0;
    if (/神经网络/.test(topic)) return 3;
    if (/机器学习与算法/.test(topic)) return 4;
  }

  if (node.layer === 'project') {
    const topics = ((node as GraphNode).topics ?? []).join(' ');
  const hay = `${node.name} ${node.summary ?? ''} ${topics}`.toLowerCase();
    if (/agent|langchain|autogpt|mcp/.test(hay)) return 7;
    if (/diffus|image|video|vision|multimodal|clip/.test(hay)) return 6;
    if (/pytorch|tensorflow|keras|training|framework|compiler|vllm/.test(hay)) return 3;
    if (/gpt|llm|transformer|bert|language model/.test(hay)) return 0;
    return 4;
  }

  if (isFoundation) {
    if (/符号|知识|专家|逻辑|语言|机器人|具身/.test(tags)) return 1;
    if (/卷积|序列|训练|视觉|连接|硬件|算力|数据/.test(tags)) return 2;
    if (/统计|概率|集成|理论|因果|强化/.test(tags)) return 4;
    return 5;
  }

  if (/智能体|协议|工程|工具/.test(tags)) return 7;
  if (/生成|多模态|视频|科学|视觉/.test(tags)) return 6;
  if (/开源|架构|推理|对齐/.test(tags)) return 1;
  return 0;
}

/**
 * 一颗星的颜色：层定主色系，类别在色系内偏移。
 */
function colorOf(node: GraphNode & { topic?: string; category?: string; layer?: string }, w: number): [number, number, number] {
  // 按「旋臂」分区上色，而不是按图层。
  // 诗云的震撼有一半来自颜色分区：绿的、红的、蓝的各自成片，
  // 一眼能看出结构。全同色的话，几万个点只是一片均匀的噪点。
  // 插件星团占了近六千颗，全部同色会成一大块死色；按类别在橙红区间里分开
  if (node.layer === 'plugin') {
    const ph = hash(node.category ?? 'other');
    return hsl(22 + ph * 46, 0.5, 0.26 + w * 0.44);
  }

  const arm = armOf(node as never);
  const HUES = [36, 186, 142, 214, 272, 330, 200, 18];
  const hue = HUES[arm] ?? 214;
  const boost = node.layer === 'skeleton' ? 0.1 : 0;
  // 亮度曲线调陡：低权重压到几乎黑，高权重推到接近纯白。
  // 「都差不多亮」是数据图的特征，真实星空是极端的动态范围。
  const l = 0.04 + Math.pow(w, 2.8) * 0.9;
  return hsl(hue, 0.5 + boost, l);
}

/** 距离中心的「时间距离」，0 在 2017，1 在最早或最晚 */
function timeDelta(year: number): number {
  return Math.min(1, Math.abs(year - SPLIT_YEAR) / MAX_DELTA_YEARS);
}

/**
 * 插件星团挂在 DeepSeek 家族星团旁边：
 * 它本来就是 DeepSeek Harness 的生态，不该飘在星系另一头。
 */
export function pluginCenter() {
  const idx = FAMILIES.findIndex((f) => f.id === 'deepseek');
  const c = familyCenter(Math.max(0, idx));
  return { x: c.x + 340, y: c.y + 230, z: c.z + 300 };
}

export function layoutStars(nodes: GraphNode[]): PlacedStar[] {
  const pc = pluginCenter();
  const placed: PlacedStar[] = [];

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i] as GraphNode & { topic?: string; category?: string };
    const seed = hash(node.id);
    const seed2 = hash(`${node.id}#y`);
    const w = Math.max(0, Math.min(100, node.weight)) / 100;
    const rgb = colorOf(node, w);

    // ── 插件星团：浮在主盘外侧的一颗球状伴星系 ──
    if (node.layer === 'plugin') {
      const cat = node.category ?? 'other';
      const h = hash(cat);
      const theta = h * Math.PI * 2;
      const phi = Math.acos(2 * ((h * 7.31) % 1) - 1);
      const dirX = Math.sin(phi) * Math.cos(theta);
      const dirY = Math.cos(phi);
      const dirZ = Math.sin(phi) * Math.sin(theta);

      const CAT_R = 190;
      const inR = Math.sqrt(seed) * 78;
      const a2 = seed2 * Math.PI * 2;
      const p2 = Math.acos(2 * ((seed * 3.7) % 1) - 1);
      const offX = inR * Math.sin(p2) * Math.cos(a2);
      const offY = inR * Math.cos(p2) * 0.8;
      const offZ = inR * Math.sin(p2) * Math.sin(a2);

      placed.push({
        node,
        index: i,
        x: pc.x + dirX * CAT_R + offX,
        y: pc.y + dirY * CAT_R * 0.85 + offY,
        z: pc.z + dirZ * CAT_R + offZ,
        size: 1.25 + Math.pow(w, 2) * 4.2,
        rgb,
        arm: 0,
        side: 'emergence',
      });
      continue;
    }

    // ── 人物：游离在主体之外的「名人星」──
    // 主盘讲的是「东西」，人不是东西。把他们单独散到外圈的球壳上，
    // 一方面让主盘干净，另一方面背景里就有了「远处还有星」的纵深。
    if (node.layer === 'skeleton' && node.type === 'person') {
      const r = 1150 + seed * 950;
      const a1 = seed2 * Math.PI * 2;
      const p1 = Math.acos(2 * ((seed * 3.3) % 1) - 1);
      placed.push({
        node,
        index: i,
        x: r * Math.sin(p1) * Math.cos(a1),
        y: r * Math.cos(p1) * 0.62,
        z: r * Math.sin(p1) * Math.sin(a1),
        size: 1.4 + w * 2.6,
        rgb,
        arm: 0,
        side: node.year < SPLIT_YEAR ? 'foundation' : 'emergence',
      });
      continue;
    }

    // ── 模型家族：环绕主星系的一颗卫星星团 ──
    // 模型靠近球心，属于这个家族的开源项目在外层，从外面看是「一颗星系带着它的应用层」
    const fam = familyOf(node as GraphNode & { family?: string });
    if (fam) {
      const idx = FAMILIES.findIndex((f) => f.id === fam);
      if (idx >= 0) {
        const c = familyCenter(idx);
        const inner = node.layer === 'skeleton';
        let px: number;
        let py: number;
        let pz: number;

        if (inner) {
          // 模型：球心附近
          const rr = Math.sqrt(seed) * 150;
          const a1 = seed2 * Math.PI * 2;
          const p1 = Math.acos(2 * ((seed * 3.1) % 1) - 1);
          px = c.x + rr * Math.sin(p1) * Math.cos(a1);
          py = c.y + rr * Math.cos(p1) * 0.85;
          pz = c.z + rr * Math.sin(p1) * Math.sin(a1);
        } else {
          // 生态项目：排成一条绕家族的轨道，像行星
          const orbitR = 170 + ((seed * 7.3) % 1) * 120;
          const a1 = seed2 * Math.PI * 2;
          px = c.x + Math.cos(a1) * orbitR;
          py = c.y + (seed - 0.5) * 34;
          pz = c.z + Math.sin(a1) * orbitR;
        }

        placed.push({
          node,
          index: i,
          x: px,
          y: py,
          z: pz,
          size: inner ? 1.5 + Math.pow(w, 2) * 5.2 : 1.2 + Math.pow(w, 2) * 3.6,
          rgb,
          arm: 0,
          side: node.year < SPLIT_YEAR ? 'foundation' : 'emergence',
        });
        continue;
      }
    }

    const side: 'foundation' | 'emergence' = node.year < SPLIT_YEAR ? 'foundation' : 'emergence';
    const arm = armOf(node);

    // ── 下面这套位置算法是照诗云的 positions.ts 抄的 ──
    // 它讲了一个我之前不懂的事：真实的盘状星系，旋臂只在**外圈**成立。
    // 中心那块是「模糊」的——所有方向都被抹开，于是堆成一颗圆形核球，
    // 而不是一个由几条臂交叉出来的十字。这一步是「像星系」和「像风车」的分界。

    // 半径 = 影响力（越重要越靠近黑洞）
    const t = Math.min(1, Math.pow(1 - w, 1.15));
    const radius = CORE_HOLE + t * MAX_R;

    // 三个确定性随机数，凑一个近似高斯（Irwin–Hall）
    const ra = hash(node.id + '#a');
    const rb = hash(node.id + '#b');
    const rc = hash(node.id + '#c');
    const gauss = ra + rb + rc - 1.5; // ≈ N(0, 0.5)

    // 4 条旋臂 + 对数扭转
    const BRANCHES = 4;
    const branch = (Math.floor(ra * BRANCHES) / BRANCHES) * Math.PI * 2;
    const TWIST = 5.2;
    const twist = t * TWIST;
    const armDev = gauss * 0.42 * 0.45;

    // ★ 中心模糊：t < 0.5 时把角度彻底打散，核球才会是圆的
    const centerBlur = Math.max(0, 0.5 - t) / 0.5;
    const az = hash(node.id + '#az');
    const angle = branch + twist + armDev + (az - 0.5) * Math.PI * 2 * centerBlur;

    // 盘厚：中心鼓起来（bulge），边缘变薄
    const bulge = 1 + Math.max(0, 0.45 - t) * 2.6;
    const yGauss = hash(node.id + '#y') + hash(node.id + '#y2') + hash(node.id + '#y3') - 1.5;
    const y = yGauss * radius * 0.11 * 2.1 * bulge;

    // 面内散射：让每条臂是「有宽度的带状」而不是一张纸
    const sxu = hash(node.id + '#sx');
    const szu = hash(node.id + '#sz');
    const scatX = Math.pow(sxu, 2.2) * (sxu > 0.5 ? 1 : -1) * 0.22 * radius;
    const scatZ = Math.pow(szu, 2.2) * (szu > 0.5 ? 1 : -1) * 0.22 * radius;

    placed.push({
      node,
      index: i,
      x: Math.cos(angle) * radius + scatX,
      y,
      z: Math.sin(angle) * radius + scatZ,
      // 中心区的星点收小：那里密度最高，点一大会叠成一团白
      size: (0.9 + Math.pow(w, 5) * 2.6) * (0.35 + 0.65 * Math.min(1, radius / 420)),
      rgb,
      arm,
      side,
    });
  }

  return placed;
}

export const GALAXY_CENTERS = { core: GALAXY_CENTER };


















