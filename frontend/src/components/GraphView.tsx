import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { PodGraph, PodGraphNode, PodGraphEdge, PodGraphNodeKind } from '@podman/shared';
import { fetchPodGraph } from '../lib/graph.js';

type Mode = 'risk' | 'learn' | 'all';

// Fixed, light-readable hues for the node/edge encoding (kept stable across
// light/dark so kinds stay distinguishable; the chrome uses shadcn tokens).
const BLUE = '#2563eb';
const SLATE = '#475569';
const SLATE_EDGE = '#94a3b8';
const SLATE_FAINT = '#cbd5e1';
const AMBER = '#d97706';
const RED = '#dc2626';
const VIOLET = '#7c3aed';

const KIND_COLOR: Record<PodGraphNodeKind, string> = {
  engineer: BLUE,
  file: SLATE,
  feature: AMBER,
  collision: RED,
  intervention: VIOLET,
};

const EDGE: Record<PodGraphEdge['kind'], { c: string; w: number; dash?: boolean }> = {
  owns: { c: BLUE, w: 2.6 },
  editing: { c: SLATE_EDGE, w: 2 },
  touches: { c: SLATE_FAINT, w: 1.6 },
  collides: { c: RED, w: 3.2 },
  warns: { c: AMBER, w: 3.2 },
  learned_from: { c: VIOLET, w: 2.4, dash: true },
};

function NodeShape({ node }: { node: PodGraphNode }) {
  const c = KIND_COLOR[node.kind];
  const { x, y } = node;
  switch (node.kind) {
    case 'engineer':
      return <rect x={x - 15} y={y - 15} width={30} height={30} rx={4} fill={c} />;
    case 'file':
      return (
        <rect
          x={x - 15}
          y={y - 15}
          width={30}
          height={30}
          rx={4}
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
  { label: 'engineer', swatch: { background: BLUE } },
  { label: 'file', swatch: { border: `2px solid ${SLATE}` } },
  { label: 'feature', swatch: { background: AMBER, borderRadius: '50%' } },
  { label: 'collision', swatch: { background: RED, clipPath: 'polygon(50% 0,100% 100%,0 100%)' } },
  { label: 'intervention', swatch: { background: VIOLET, transform: 'rotate(45deg)' } },
];

function statusColor(status: string): string {
  if (status === 'risk') return RED;
  if (status === 'learned') return VIOLET;
  return 'var(--foreground)';
}

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
        .pm-graph{font-family:inherit;background:var(--card);color:var(--foreground);border:1px solid var(--border);border-radius:12px;overflow:hidden}
        .pm-graph *{box-sizing:border-box}
        .pm-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)}
        .pm-ttl{font-weight:600;font-size:16px;color:var(--foreground)}
        .pm-sub{font-size:12px;color:var(--muted-foreground);margin-top:3px}
        .pm-x{background:transparent;border:1px solid var(--border);color:var(--foreground);font-size:13px;padding:6px 12px;border-radius:8px;cursor:pointer}
        .pm-x:hover{background:var(--accent)}
        .pm-bar{display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap}
        .pm-btn{font-size:13px;color:var(--foreground);background:transparent;border:1px solid var(--border);padding:6px 12px;cursor:pointer;border-radius:8px}
        .pm-btn:hover{background:var(--accent)}
        .pm-btn.on{background:var(--primary);border-color:var(--primary);color:var(--primary-foreground)}
        .pm-grid{display:grid;grid-template-columns:190px 1fr 250px}
        .pm-col{padding:14px}
        .pm-railR{border-left:1px solid var(--border);background:var(--muted)}
        .pm-st{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted-foreground);margin:2px 0 12px;font-weight:500}
        .pm-kpi{border:1px solid var(--border);background:var(--card);border-radius:10px;padding:11px 12px;margin-bottom:10px}
        .pm-num{font-weight:600;font-size:26px;line-height:1;font-variant-numeric:tabular-nums;color:var(--foreground)}
        .pm-klab{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground);margin-top:6px;font-weight:500}
        .pm-kdet{font-size:11px;color:var(--muted-foreground);margin-top:5px;line-height:1.45}
        .pm-canvas{background:var(--card);border-left:1px solid var(--border);border-right:1px solid var(--border);min-height:472px}
        .pm-canvas svg{width:100%;height:auto;display:block}
        .pm-node{cursor:pointer}
        .pm-lbl{font-weight:500;font-size:11px;fill:var(--foreground)}
        .pm-dim{opacity:.18;transition:opacity .25s}
        .pm-dkind{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted-foreground)}
        .pm-dname{font-weight:600;font-size:18px;margin:5px 0 10px;color:var(--foreground)}
        .pm-drow{display:flex;justify-content:space-between;font-size:13px;padding:7px 0;border-bottom:1px solid var(--border);color:var(--muted-foreground)}
        .pm-drow b{color:var(--foreground);font-weight:500}
        .pm-note{font-size:13px;color:var(--muted-foreground);line-height:1.55;margin-top:10px}
        .pm-legend{display:flex;gap:14px;flex-wrap:wrap;padding:10px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--muted-foreground)}
        .pm-lg{display:flex;align-items:center;gap:6px}
        .pm-sw{width:13px;height:13px;display:inline-block}
        @media(max-width:760px){.pm-grid{grid-template-columns:1fr}.pm-railR{border-left:0;border-top:1px solid var(--border)}.pm-canvas{border:0;border-top:1px solid var(--border)}}
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
        <p style={{ padding: '16px', color: 'var(--destructive)', fontSize: 13 }}>
          Graph error: {error}
        </p>
      )}
      {!graph && !error && (
        <p style={{ padding: '16px', color: 'var(--muted-foreground)', fontSize: 13 }}>
          Loading graph…
        </p>
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
                      {n.label}
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
                    <b style={{ color: statusColor(sel.status) }}>{sel.status}</b>
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
                    The violet <b style={{ color: VIOLET }}>learned_from</b> edges are ownership
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
              <span className="pm-sw" style={{ background: RED, height: 3 }} />
              collides
            </span>
            <span className="pm-lg">
              <span className="pm-sw" style={{ background: VIOLET, height: 3 }} />
              learned_from
            </span>
          </div>
        </>
      )}
    </div>
  );
}
