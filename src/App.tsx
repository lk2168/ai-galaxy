import { useCallback, useEffect, useMemo, useState } from 'react';
import Galaxy, { type ViewRequest } from './galaxy/Galaxy';
import { FAMILIES, TYPE_COLORS, TYPE_LABELS } from './galaxy/layout';
import type { GraphData, GraphNode } from './galaxy/types';

const rgb = (c: [number, number, number]) =>
  `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;

export default function App() {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [threshold, setThreshold] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [viewRequest, setViewRequest] = useState<ViewRequest | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusRequest, setFocusRequest] = useState<{ id: string; key: number } | null>(null);
  const [familyFocus, setFamilyFocus] = useState<string | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    const load = async () => {
      const res = await fetch(`${base}graph.json`);
      if (!res.ok) throw new Error(`加载骨架数据失败：${res.status}`);
      const skeleton = (await res.json()) as GraphData;

      // 论文层和项目层各自可选：任何一层还没跑到，页面照样能开
      const optional = async (file: string) => {
        try {
          const r = await fetch(`${base}${file}`);
          return r.ok ? ((await r.json()) as GraphData) : null;
        } catch {
          return null;
        }
      };
      const [projects, papers, plugins, hf] = await Promise.all([
        optional('graph-external.json'),
        optional('graph-papers.json'),
        optional('graph-plugins.json'),
        optional('graph-hf.json'),
      ]);

      const nodes = [...skeleton.nodes, ...(projects?.nodes ?? []), ...(papers?.nodes ?? []), ...(plugins?.nodes ?? []), ...(hf?.nodes ?? [])];
      const links = [...skeleton.links, ...(projects?.links ?? []), ...(papers?.links ?? []), ...(plugins?.links ?? [])];
      const years: [number, number] = [
        Math.min(...nodes.map((n) => n.year)),
        Math.max(...nodes.map((n) => n.year)),
      ];
      setData({
        nodes,
        links,
        meta: {
          nodeCount: nodes.length,
          linkCount: links.length,
          years,
          papers: papers?.nodes.length ?? 0,
          projects: projects?.nodes.length ?? 0,
          plugins: plugins?.nodes.length ?? 0,
          hf: hf?.nodes.length ?? 0,
          skeleton: skeleton.nodes.length,
        },
      });
      // 星星一多，默认只点亮骨架，否则第一眼是一团白雾
      setThreshold(nodes.length > 1200 ? 74 : 0);
    };
    load().catch((e: Error) => setError(e.message));
  }, []);

  const onSelect = useCallback((node: GraphNode | null) => setSelected(node), []);

  const flyTo = useCallback((where: 'foundation' | 'emergence' | 'all') => {
    const presets = {
      foundation: {
        target: [-420, 0, 0] as [number, number, number],
        cam: [-820, 320, 620] as [number, number, number],
      },
      emergence: {
        target: [420, 0, 0] as [number, number, number],
        cam: [820, 320, 620] as [number, number, number],
      },
      all: {
        target: [0, 0, 0] as [number, number, number],
        cam: [0, 1420, 3100] as [number, number, number],
      },
    };
    // key 每次都要变，否则点同一个按钮不会二次触发
    setViewRequest({ ...presets[where], key: Date.now() });
  }, []);

  // 支持用 ?view=foundation / emergence / all 直接定位，方便把某片星发给别人
  useEffect(() => {
    if (!data) return;
    const v = new URLSearchParams(window.location.search).get('view');
    if (v === 'foundation' || v === 'emergence' || v === 'all') {
      const timer = window.setTimeout(() => flyTo(v), 350);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [data, flyTo]);

  // 支持 #node=xxx 直接定位：把「我在看哪颗星」发给别人
  useEffect(() => {
    if (!data) return;
    const m = /#node=(.+)$/.exec(window.location.hash);
    if (!m) return;
    const node = data.nodes.find((n) => n.id === decodeURIComponent(m[1]));
    if (node) {
      setSelected(node);
      setFocusRequest({ id: node.id, key: Date.now() });
    }
  }, [data]);

  // 选中哪颗星，地址栏就跟着变。
  // ★ 只在有选中时写：如果这里顺手把空 hash 也写回去，首屏就会把用户带来的 #node 冲掉
  useEffect(() => {
    if (!selected) return;
    const base = window.location.pathname + window.location.search;
    history.replaceState(null, '', `${base}#node=${encodeURIComponent(selected.id)}`);
  }, [selected]);

  // 支持 ?family=openai 直接进入某个家族视图（方便分享与截图验证）
  useEffect(() => {
    const fam = new URLSearchParams(window.location.search).get('family');
    if (fam) setFamilyFocus(fam);
  }, []);

  const byId = useMemo(() => {
    const m = new Map<string, GraphNode>();
    data?.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [data]);

  const neighbours = useMemo(() => {
    if (!data || !selected) return [];
    const out: { node: GraphNode; relation: string; direction: 'out' | 'in' }[] = [];
    for (const l of data.links) {
      if (l.source === selected.id) {
        const n = byId.get(l.target);
        if (n) out.push({ node: n, relation: l.relation, direction: 'out' });
      } else if (l.target === selected.id) {
        const n = byId.get(l.source);
        if (n) out.push({ node: n, relation: l.relation, direction: 'in' });
      }
    }
    return out.sort((a, b) => b.node.weight - a.node.weight);
  }, [data, selected, byId]);

  const years = data?.meta?.years ?? [1943, 2025];

  // 搜索：先按名字匹配，再看摘要；结果按影响力排序，最多 8 条
  const results = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!data || q.length < 1) return [];
    return data.nodes
      .filter((n) => n.name.toLowerCase().includes(q) || (n.summary ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8);
  }, [searchQuery, data]);

  const onFamilyClick = useCallback((id: string) => {
    setFamilyFocus((cur) => (cur === id ? null : id));
  }, []);

  // 按 ESC 退出家族视图
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFamilyFocus(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = useCallback((node: GraphNode) => {
    setSelected(node);
    setFocusRequest({ id: node.id, key: Date.now() });
    setSearchQuery('');
  }, []);

  return (
    <div className="app">
      <header className="hud hud-title">
        <h1>AI 星图</h1>
        <p>
          共 <b>{data?.nodes.length ?? '…'}</b> 颗星，<b>{data?.links.length ?? '…'}</b> 条连线
        </p>
        <p className="muted">
          {years[0]} – {years[1]} · 中心是 Transformer，离它越远就越早或越晚
        </p>
        {data ? (
          <p className="muted">
            骨架 {data.meta.skeleton ?? 0} · 论文 {data.meta.papers ?? 0} · 项目 {data.meta.projects ?? 0} · HF {data.meta.hf ?? 0} · 插件 {data.meta.plugins ?? 0}
          </p>
        ) : null}
      </header>

      <div className="hud hud-search">
        <input
          className="search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜一颗星：Transformer、图灵、ResNet、ComfyUI…"
          spellCheck={false}
        />
        {results.length > 0 && (
          <div className="search-results">
            {results.map((n) => (
              <button key={n.id} className="search-row" onClick={() => pick(n)}>
                <span className="search-name">{n.name.length > 46 ? `${n.name.slice(0, 46)}…` : n.name}</span>
                <span className="search-meta">
                  {TYPE_LABELS[n.type] ?? n.type} · {n.year}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="hud hud-legend">
        <div className="legend-title">它在人类群星里的位置</div>
        <div className="legend-row">
          <span className="dot" style={{ background: 'rgb(255, 180, 92)', boxShadow: '0 0 8px rgb(255, 180, 92)' }} />
          <span>论文（金）</span>
        </div>
        <div className="legend-row">
          <span className="dot" style={{ background: 'rgb(255, 138, 61)', boxShadow: '0 0 8px rgb(255, 138, 61)' }} />
          <span>开源项目（橙）</span>
        </div>
        <div className="legend-row">
          <span className="dot" style={{ background: 'rgb(255, 210, 122)', boxShadow: '0 0 8px rgb(255, 210, 122)' }} />
          <span>DSH 插件（琥珀）</span>
        </div>
        <div className="legend-sub">史书骨架 138 颗，按类型分：</div>
        {Object.entries(TYPE_LABELS)
          .filter(([type]) => type !== 'project')
          .map(([type, label]) => (
            <div className="legend-row" key={type}>
              <span
                className="dot"
                style={{
                  background: rgb(TYPE_COLORS[type] ?? [0.8, 0.8, 0.9]),
                  boxShadow: `0 0 8px ${rgb(TYPE_COLORS[type] ?? [0.8, 0.8, 0.9])}`,
                }}
              />
              <span>{label}</span>
            </div>
          ))}
        <div className="legend-note">
          星越大越亮 = 影响力越大
          <br />
          悬停一颗星，会点亮与它相连的那些
        </div>
      </div>

      <div className="hud hud-controls">
        <div className="view-row">
          <button className="ghost" onClick={() => flyTo('foundation')}>
            ← 更早
          </button>
          <button className="ghost" onClick={() => flyTo('all')}>
            全景
          </button>
          <button className="ghost" onClick={() => flyTo('emergence')}>
            更晚 →
          </button>
        </div>
        <label className="slider-label">
          只点亮影响力 ≥ {threshold <= 0 ? '全部（拖动可只看亮星）' : threshold}
          <input type="range" min={0} max={100} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        </label>
        <button className="ghost" onClick={() => setSpinning((s) => !s)}>
          {spinning ? '停止自转' : '开始自转'}
        </button>
        <div className="hint">左键拖动旋转 · 右键拖动平移 · 滚轮缩放 · 点击星星看详情</div>
        {familyFocus && (
          <div className="family-badge">
            只看 {FAMILIES.find((f) => f.id === familyFocus)?.label ?? familyFocus}
            <button className="family-clear" onClick={() => setFamilyFocus(null)}>退出</button>
          </div>
        )}
      </div>

      {error && <div className="hud hud-error">{error}</div>}

      {data && (
        <Galaxy
          data={data}
          selectedId={selected?.id ?? null}
          onSelect={onSelect}
          focusThreshold={threshold}
          spinning={spinning}
          viewRequest={viewRequest}
          focusRequest={focusRequest}
          familyFocus={familyFocus}
          onFamilyClick={onFamilyClick}
        />
      )}

      {selected && (
        <aside className="panel">
          <button className="panel-close" onClick={() => setSelected(null)} aria-label="关闭">
            ×
          </button>
          <div className="panel-kicker">
            {TYPE_LABELS[selected.type] ?? selected.type} · {selected.year}
          </div>
          <h2>{selected.name}</h2>
          {selected.summary && <p className="panel-summary">{selected.summary}</p>}

          <div className="weight">
            <div className="weight-bar">
              <div className="weight-fill" style={{ width: `${selected.weight}%` }} />
            </div>
            <span>影响力 {selected.weight} / 100</span>
          </div>

          {selected.cited !== undefined && <div className="panel-meta">被引用 {selected.cited.toLocaleString()} 次</div>}
          {selected.stars !== undefined && <div className="panel-meta">GitHub ★ {selected.stars.toLocaleString()}</div>}
          {selected.authors?.length ? <div className="panel-meta">作者：{selected.authors.join('、')}</div> : null}

          {selected.tags?.length ? (
            <div className="tags">
              {selected.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
          ) : null}

          {selected.sources?.length ? (
            <div className="sources">
              {selected.sources.map((s) => (
                <a key={s} href={s} target="_blank" rel="noreferrer">
                  来源 ↗
                </a>
              ))}
            </div>
          ) : null}

          {neighbours.length > 0 && (
            <div className="neighbours">
              <div className="neighbours-title">与它有 {neighbours.length} 条连线</div>
              {neighbours.slice(0, 12).map((n) => (
                <button key={n.node.id + n.relation} className="neighbour" onClick={() => setSelected(n.node)}>
                  <span className="neighbour-rel">{n.direction === 'out' ? n.relation : `被${n.relation}`}</span>
                  <span className="neighbour-name">{n.node.name}</span>
                </button>
              ))}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}












