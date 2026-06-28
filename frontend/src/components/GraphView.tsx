import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { PodGraph, PodGraphNode, PodGraphEdge, PodGraphNodeKind } from '@podman/shared';
import { fetchPodGraph } from '../lib/graph.js';

type Mode = 'risk' | 'learn' | 'all';

const KIND_COLOR: Record<PodGraphNodeKind, string> = {
  engineer: '#3B5BFF',
  file: '#ECE7DA',
  feature: '#F6C445',
  collision: '#E2403A',
  intervention: '#8b6cff',
};

const EDGE: Record<PodGraphEdge['kind'], { c: string; w: number; dash?: boolean }> = {
  owns: { c: '#3B5BFF', w: 2.6 },
  editing: { c: '#ECE7DA', w: 2 },
  touches: { c: '#5d5d66', w: 1.6 },
  collides: { c: '#E2403A', w: 3.2 },
  warns: { c: '#F6C445', w: 3.2 },
  learned_from: { c: '#8b6cff', w: 2.4, dash: true },
};

function NodeShape({ node }: { node: PodGraphNode }) {
  const c = KIND_COLOR[node.kind];
  const { x, y } = node;
  switch (node.kind) {
    case 'engineer':
      return <rect x={x - 15} y={y - 15} width={30} height={30} fill={c} />;
    case 'file':
      return (
        <rect
          x={x - 15}
          y={y - 15}
          width={30}
          height={30}
          fill="none"
          stroke={c}
          strokeWidth={2.6}
        />
      );
    case 'feature':
      return <circle cx={x} cy={y} r={17} fill={c} />;
    case 'collision':
      return <polygon points={`${x},${y - 18} ${x + 17},${y + 13} ${x - 17},${y + 13}`} fill={c} />;
    case 'intervention':
      return (
        <polygon points={`${x},${y - 18} ${x + 18},${y} ${x},${y + 18} ${x - 18},${y}`} fill={c} />
      );
    default:
      return null;
  }
}

interface Highlight {
  nodes: Set<string>;
  edges: Set<string>;
}

function highlightFor(graph: PodGraph, mode: Mode, selected: string | null): Highlight | null {
  if (selected) {
    const es = graph.edges.filter((e) => e.source === selected || e.target === selected);
    return {
      nodes: new Set([selected, ...es.flatMap((e) => [e.source, e.target])]),
      edges: new Set(es.map((e) => e.id)),
    };
  }
  if (mode === 'all') return null;
  const kinds: PodGraphEdge['kind'][] =
    mode === 'risk' ? ['collides', 'warns', 'learned_from'] : ['learned_from', 'warns'];
  const collisions = new Set(graph.nodes.filter((n) => n.kind === 'collision').map((n) => n.id));
  const es = graph.edges.filter(
    (e) =>
      kinds.includes(e.kind) ||
      (mode === 'risk' && (collisions.has(e.target) || collisions.has(e.source))),
  );
  return {
    nodes: new Set(es.flatMap((e) => [e.source, e.target])),
    edges: new Set(es.map((e) => e.id)),
  };
}

const LEGEND: Array<{ label: string; swatch: CSSProperties }> = [
  { label: 'engineer', swatch: { background: '#3B5BFF' } },
  { label: 'file', swatch: { border: '2px solid #ECE7DA' } },
  { label: 'feature', swatch: { background: '#F6C445', borderRadius: '50%' } },
  {
    label: 'collision',
    swatch: { background: '#E2403A', clipPath: 'polygon(50% 0,100% 100%,0 100%)' },
  },
  { label: 'intervention', swatch: { background: '#8b6cff', transform: 'rotate(45deg)' } },
];

export function GraphView({ podId, onClose }: { podId: string; onClose: () => void }) {
  const [graph, setGraph] = useState<PodGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('risk');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setGraph(null);
    setError(null);
    fetchPodGraph(podId)
      .then((g) => alive && setGraph(g))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [podId]);

  const hi = useMemo(
    () => (graph ? highlightFor(graph, mode, selected) : null),
    [graph, mode, selected],
  );
  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);
  const sel = selected ? nodeById.get(selected) : undefined;
  const relCount = selected
    ? (graph?.edges ?? []).filter((e) => e.source === selected || e.target === selected).length
    : 0;

  const dimNode = (id: string) => (hi ? !hi.nodes.has(id) : false);
  const dimEdge = (id: string) => (hi ? !hi.edges.has(id) : false);
  const hotEdge = (id: string) => (hi ? hi.edges.has(id) : false);

  function pick(next: Mode) {
    setMode(next);
    setSelected(null);
  }

  return (
    <div className="pm-graph">
      <style>{`
        .pm-graph{--bg:#0c0c0e;--panel:#141417;--line:#2a2a31;--paper:#ECE7DA;--mut:#8d897e;--red:#E2403A;--yel:#F6C445;--vio:#8b6cff;
          font-family:'Space Grotesk',system-ui,sans-serif;background:var(--bg);color:var(--paper);border:1px solid var(--line);border-radius:14px;overflow:hidden}
        .pm-graph *{box-sizing:border-box}
        .pm-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:3px solid var(--paper)}
        .pm-ttl{font-weight:800;font-size:18px;letter-spacing:.14em;text-transform:uppercase;font-family:Archivo,'Space Grotesk',sans-serif}
        .pm-sub{font-size:10px;letter-spacing:.3em;color:var(--mut);text-transform:uppercase;margin-top:5px}
        .pm-x{background:transparent;border:1px solid var(--line);color:var(--paper);font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:7px 12px;border-radius:2px;cursor:pointer}
        .pm-x:hover{border-color:var(--paper)}
        .pm-bar{display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}
        .pm-btn{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--paper);background:transparent;border:1px solid var(--line);padding:7px 12px;cursor:pointer;border-radius:2px}
        .pm-btn:hover{border-color:var(--paper)}
        .pm-btn.on{background:var(--red);border-color:var(--red);color:#fff}
        .pm-grid{display:grid;grid-template-columns:180px 1fr 240px}
        .pm-col{padding:14px}
        .pm-railR{border-left:1px solid var(--line);background:#17171b}
        .pm-st{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:var(--mut);margin:2px 0 12px}
        .pm-kpi{border:1px solid var(--line);border-left:5px solid var(--vio);padding:10px 11px;margin-bottom:10px}
        .pm-num{font-weight:800;font-size:26px;line-height:.9;font-variant-numeric:tabular-nums;font-family:Archivo,sans-serif}
        .pm-klab{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--mut);margin-top:6px}
        .pm-kdet{font-size:10px;color:var(--mut);margin-top:5px;line-height:1.4}
        .pm-canvas{background:var(--panel);border-left:1px solid var(--line);border-right:1px solid var(--line);min-height:472px}
        .pm-canvas svg{width:100%;height:auto;display:block}
        .pm-node{cursor:pointer}
        .pm-lbl{font-weight:500;font-size:11px;letter-spacing:.06em;fill:var(--paper);text-transform:uppercase}
        .pm-dim{opacity:.12;transition:opacity .25s}
        .pm-dkind{font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--mut)}
        .pm-dname{font-weight:800;font-size:20px;margin:5px 0 8px;font-family:Archivo,sans-serif}
        .pm-drow{display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-bottom:1px solid var(--line);color:var(--mut)}
        .pm-drow b{color:var(--paper);font-weight:500}
        .pm-note{font-size:12px;color:var(--mut);line-height:1.5;margin-top:10px}
        .pm-legend{display:flex;gap:14px;flex-wrap:wrap;padding:10px 16px;border-top:1px solid var(--line);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut)}
        .pm-lg{display:flex;align-items:center;gap:6px}
        .pm-sw{width:13px;height:13px;display:inline-block}
        @media(max-width:760px){.pm-grid{grid-template-columns:1fr}.pm-railR{border-left:0;border-top:1px solid var(--line)}.pm-canvas{border:0;border-top:1px solid var(--line)}}
      `}</style>

      <div className="pm-hd">
        <div>
          <div className="pm-ttl">Team memory</div>
          <div className="pm-sub">What PodMan learned · {podId}</div>
        </div>
        <button className="pm-x" onClick={onClose}>
          ← Pods
        </button>
      </div>

      <div className="pm-bar">
        <button
          className={`pm-btn ${mode === 'risk' && !selected ? 'on' : ''}`}
          onClick={() => pick('risk')}
        >
          Risk path
        </button>
        <button
          className={`pm-btn ${mode === 'learn' && !selected ? 'on' : ''}`}
          onClick={() => pick('learn')}
        >
          Learning edges
        </button>
        <button
          className={`pm-btn ${mode === 'all' && !selected ? 'on' : ''}`}
          onClick={() => pick('all')}
        >
          Whole graph
        </button>
      </div>

      {error && (
        <p style={{ padding: '16px', color: '#ff7d76', fontSize: 13 }}>Graph error: {error}</p>
      )}
      {!graph && !error && (
        <p style={{ padding: '16px', color: '#8d897e', fontSize: 13 }}>Loading graph…</p>
      )}

      {graph && (
        <>
          <div className="pm-grid">
            <div className="pm-col">
              <div className="pm-st">Workflow metrics</div>
              {graph.metrics.map((m) => (
                <div className="pm-kpi" key={m.label}>
                  <div className="pm-num">{m.value}</div>
                  <div className="pm-klab">{m.label}</div>
                  <div className="pm-kdet">{m.detail}</div>
                </div>
              ))}
            </div>

            <div className="pm-canvas">
              <svg viewBox="0 0 720 472" role="img" aria-label="PodMan team-memory graph">
                {graph.edges.map((e) => {
                  const a = nodeById.get(e.source);
                  const b = nodeById.get(e.target);
                  if (!a || !b) return null;
                  const s = EDGE[e.kind];
                  return (
                    <line
                      key={e.id}
                      className={dimEdge(e.id) ? 'pm-dim' : undefined}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={s.c}
                      strokeWidth={hotEdge(e.id) ? s.w + 1.6 : s.w}
                      strokeDasharray={s.dash ? '7 6' : undefined}
                      strokeLinecap="round"
                    />
                  );
                })}
                {graph.nodes.map((n) => (
                  <g
                    key={n.id}
                    className={`pm-node ${dimNode(n.id) ? 'pm-dim' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${n.kind}: ${n.label}`}
                    onClick={() => setSelected((cur) => (cur === n.id ? null : n.id))}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        setSelected((cur) => (cur === n.id ? null : n.id));
                      }
                    }}
                  >
                    <NodeShape node={n} />
                    <text className="pm-lbl" x={n.x} y={n.y + 33} textAnchor="middle">
                      {n.label.toUpperCase()}
                    </text>
                  </g>
                ))}
              </svg>
            </div>

            <div className="pm-col pm-railR">
              {sel ? (
                <>
                  <div className="pm-dkind">{sel.kind}</div>
                  <div className="pm-dname">{sel.label}</div>
                  <div className="pm-drow">
                    <span>Status</span>
                    <b
                      style={{
                        color:
                          sel.status === 'risk'
                            ? '#E2403A'
                            : sel.status === 'learned'
                              ? '#b7a4ff'
                              : '#ECE7DA',
                      }}
                    >
                      {sel.status}
                    </b>
                  </div>
                  <div className="pm-drow">
                    <span>Relationships</span>
                    <b>{relCount}</b>
                  </div>
                  <div className="pm-note">{sel.summary}</div>
                </>
              ) : (
                <>
                  <div className="pm-dkind">Continual learning</div>
                  <div className="pm-dname">It learned</div>
                  <div className="pm-note">
                    Violet <b style={{ color: '#b7a4ff' }}>learned_from</b> edges are ownership
                    PodMan retained from accepted interventions — the graph gets sharper every
                    session. Click any node to trace its relationships.
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="pm-legend">
            {LEGEND.map((l) => (
              <span className="pm-lg" key={l.label}>
                <span className="pm-sw" style={l.swatch} />
                {l.label}
              </span>
            ))}
            <span className="pm-lg">
              <span className="pm-sw" style={{ background: '#E2403A', height: 3 }} />
              collides
            </span>
            <span className="pm-lg">
              <span className="pm-sw" style={{ background: '#8b6cff', height: 3 }} />
              learned_from
            </span>
          </div>
        </>
      )}
    </div>
  );
}
