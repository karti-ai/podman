import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { PodGraph, PodGraphNode, PodGraphEdge, PodGraphNodeKind } from '@podman/shared';
import { fetchPodGraph } from '../lib/graph.js';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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

  const toggleVariant = (m: Mode) => (mode === m && !selected ? 'default' : 'outline');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <style>{`
          .pm-node{cursor:pointer}
          .pm-lbl{fill:var(--foreground);font-size:11px;font-weight:500}
          .pm-dim{opacity:.18;transition:opacity .25s}
        `}</style>

        <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="text-base font-medium">Team memory</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">What PodMan learned · {podId}</p>
            </div>
            <Button variant="outline" size="sm" onClick={onClose}>
              ← Pods
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 border-b px-4 py-3">
            <Button variant={toggleVariant('risk')} size="sm" onClick={() => pick('risk')}>
              Risk path
            </Button>
            <Button variant={toggleVariant('learn')} size="sm" onClick={() => pick('learn')}>
              Learning edges
            </Button>
            <Button variant={toggleVariant('all')} size="sm" onClick={() => pick('all')}>
              Whole graph
            </Button>
          </div>

          {error && <p className="px-4 py-4 text-sm text-destructive">Graph error: {error}</p>}
          {!graph && !error && (
            <p className="px-4 py-4 text-sm text-muted-foreground">Loading graph…</p>
          )}

          {graph && (
            <>
              <div className="grid lg:grid-cols-[190px_1fr_250px]">
                <div className="space-y-3 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Workflow metrics
                  </p>
                  {graph.metrics.map((m) => (
                    <div key={m.label} className="rounded-lg border bg-card px-3 py-2.5">
                      <p className="text-2xl font-medium tabular-nums">{m.value}</p>
                      <p className="mt-1 text-xs font-medium uppercase text-muted-foreground">
                        {m.label}
                      </p>
                      <p className="mt-1 text-xs leading-snug text-muted-foreground">{m.detail}</p>
                    </div>
                  ))}
                </div>

                <div className="min-h-[472px] border-y bg-card lg:border-x lg:border-y-0">
                  <svg
                    viewBox="0 0 720 472"
                    role="img"
                    aria-label="PodMan team-memory graph"
                    className="block h-auto w-full"
                  >
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

                <div className="border-t bg-muted p-4 lg:border-l lg:border-t-0">
                  {sel ? (
                    <>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {sel.kind}
                      </p>
                      <h3 className="mb-3 mt-1 text-lg font-medium">{sel.label}</h3>
                      <div className="flex items-center justify-between border-b py-1.5 text-sm text-muted-foreground">
                        <span>Status</span>
                        <Badge variant="outline" style={{ color: statusColor(sel.status) }}>
                          {sel.status}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between border-b py-1.5 text-sm text-muted-foreground">
                        <span>Relationships</span>
                        <span className="font-medium text-foreground">{relCount}</span>
                      </div>
                      <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                        {sel.summary}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Continual learning
                      </p>
                      <h3 className="mb-3 mt-1 text-lg font-medium">It learned</h3>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        The violet{' '}
                        <span className="font-medium" style={{ color: VIOLET }}>
                          learned_from
                        </span>{' '}
                        edges are ownership PodMan retained from accepted interventions — the graph
                        gets sharper every session. Click any node to trace its relationships.
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3 border-t px-4 py-2.5 text-xs text-muted-foreground">
                {LEGEND.map((l) => (
                  <span key={l.label} className="flex items-center gap-1.5">
                    <span className="inline-block size-3" style={l.swatch} />
                    {l.label}
                  </span>
                ))}
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-[3px] w-3" style={{ background: RED }} />
                  collides
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-[3px] w-3" style={{ background: VIOLET }} />
                  learned_from
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
