import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type PointerEvent,
} from 'react';
import type { PodGraph, PodGraphNode, PodGraphNodeKind } from '@podman/shared';
import { ForceSim } from './forceSim.js';
import { EDGE, KIND_COLOR, nodeRadius, type Highlight } from './encoding.js';

const W = 760;
const H = 480;
const MARGIN = 48;

/** Map the server's 0..720×0..472 layout into the canvas as a seed position. */
function mapX(x: number): number {
  return MARGIN + (Math.max(0, Math.min(720, x)) / 720) * (W - 2 * MARGIN);
}
function mapY(y: number): number {
  return MARGIN + (Math.max(0, Math.min(472, y)) / 472) * (H - 2 * MARGIN);
}

function linkDistance(kind: string): number {
  if (kind === 'collides') return 122;
  if (kind === 'owns') return 104;
  if (kind === 'learned_from') return 150;
  return 134;
}
function linkStrength(strength: number): number {
  return Math.max(0.18, Math.min(0.9, strength));
}

/** Stable +/- so parallel edges between the same pair fan to opposite sides. */
function curveSign(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) % 2;
  return h === 0 ? 1 : -1;
}

function edgePath(ax: number, ay: number, bx: number, by: number, id: string): string {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const off = curveSign(id) * len * 0.13;
  const cx = (ax + bx) / 2 + nx * off;
  const cy = (ay + by) / 2 + ny * off;
  return `M${ax.toFixed(1)},${ay.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`;
}

function nodeShape(
  kind: PodGraphNodeKind,
  color: string,
  cx: number,
  cy: number,
  r: number,
): ReactElement | null {
  switch (kind) {
    case 'engineer':
      return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={4} fill={color} />;
    case 'file':
      return (
        <rect
          x={cx - r}
          y={cy - r}
          width={r * 2}
          height={r * 2}
          rx={4}
          fill="var(--card)"
          stroke={color}
          strokeWidth={2.4}
        />
      );
    case 'feature':
      return <circle cx={cx} cy={cy} r={r} fill={color} />;
    case 'collision':
      return (
        <polygon
          points={`${cx},${cy - r} ${cx + r},${cy + r * 0.78} ${cx - r},${cy + r * 0.78}`}
          fill={color}
        />
      );
    case 'intervention':
      return (
        <polygon points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`} fill={color} />
      );
    default:
      return null;
  }
}

function showLabel(
  node: PodGraphNode,
  dimmed: boolean,
  hovered: boolean,
  selected: boolean,
): boolean {
  if (hovered || selected) return true;
  if (dimmed) return false;
  // Collisions cluster and often share a filename — reveal on hover/select only.
  if (node.kind === 'collision') return false;
  return true;
}

interface DragState {
  id: string;
  pointerId: number;
  moved: boolean;
}

export function GraphCanvas({
  graph,
  highlight,
  selected,
  onSelect,
}: {
  graph: PodGraph;
  highlight: Highlight | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<ForceSim | null>(null);
  if (!simRef.current) simRef.current = new ForceSim(W, H);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const sigRef = useRef<string>('');
  const [, setFrame] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);

  const loop = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    const working = sim.tick();
    setFrame((f) => (f + 1) % 1_000_000);
    if (working || dragRef.current) {
      rafRef.current = requestAnimationFrame(loop);
    } else {
      rafRef.current = null;
    }
  }, []);

  const ensureRaf = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  // Rebuild the simulation when the graph data changes, preserving positions.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    const nodeInputs = graph.nodes.map((n) => ({
      id: n.id,
      radius: nodeRadius(n),
      seedX: mapX(n.x),
      seedY: mapY(n.y),
    }));
    const linkInputs = graph.edges.map((e) => ({
      source: e.source,
      target: e.target,
      distance: linkDistance(e.kind),
      strength: linkStrength(e.strength),
    }));
    const sig =
      nodeInputs
        .map((n) => n.id)
        .sort()
        .join(',') +
      '|' +
      graph.edges
        .map((e) => e.id)
        .sort()
        .join(',');
    const first = sigRef.current === '';
    const changed = sig !== sigRef.current;
    sim.setData(nodeInputs, linkInputs);
    if (changed) {
      sigRef.current = sig;
      sim.reheat(first ? 1 : 0.5);
    }
    // Always (re)arm the loop — ensureRaf is idempotent via the rafRef==null
    // guard. This must NOT be gated on `changed`: under React StrictMode the
    // dev double-invoke cancels the frame between effect passes, and pass 2 sees
    // an unchanged sig, so a `changed`-gated start would leave the sim frozen.
    if (sim.nodes.length) ensureRaf();
  }, [graph, ensureRaf]);

  // Clean up the animation frame on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  function toSvg(evt: PointerEvent): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function onNodePointerDown(evt: PointerEvent, id: string) {
    evt.stopPropagation();
    const sim = simRef.current;
    if (!sim) return;
    (evt.currentTarget as Element).setPointerCapture(evt.pointerId);
    dragRef.current = { id, pointerId: evt.pointerId, moved: false };
    const { x, y } = toSvg(evt);
    sim.pin(id, x, y);
    sim.setActive(true);
    ensureRaf();
  }

  function onNodePointerMove(evt: PointerEvent) {
    const drag = dragRef.current;
    const sim = simRef.current;
    if (!drag || !sim || drag.pointerId !== evt.pointerId) return;
    drag.moved = true;
    const { x, y } = toSvg(evt);
    sim.pin(drag.id, x, y);
    ensureRaf();
  }

  function onNodePointerUp(evt: PointerEvent, id: string) {
    const drag = dragRef.current;
    const sim = simRef.current;
    if (!drag || !sim || drag.pointerId !== evt.pointerId) return;
    (evt.currentTarget as Element).releasePointerCapture?.(evt.pointerId);
    sim.setActive(false);
    // A press that never moved is a click — toggle selection (node stays pinned).
    if (!drag.moved) onSelect(selected === id ? null : id);
    dragRef.current = null;
    ensureRaf();
  }

  function onNodeDoubleClick(id: string) {
    const sim = simRef.current;
    if (!sim) return;
    sim.unpin(id);
    sim.reheat(0.5);
    ensureRaf();
  }

  const sim = simRef.current;
  const dimNode = (id: string) => (highlight ? !highlight.nodes.has(id) : false);
  const dimEdge = (id: string) => (highlight ? !highlight.edges.has(id) : false);
  const hotEdge = (id: string) => (highlight ? highlight.edges.has(id) : false);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="PodMan team-memory graph — drag nodes to rearrange"
      className="block h-full max-h-[560px] w-full touch-none select-none"
      onPointerDown={() => onSelect(null)}
    >
      <g>
        {graph.edges.map((e) => {
          const a = sim?.get(e.source);
          const b = sim?.get(e.target);
          if (!a || !b) return null;
          const style = EDGE[e.kind];
          const hot = hotEdge(e.id);
          return (
            <path
              key={e.id}
              className={`pm-edge pm-enter ${dimEdge(e.id) ? 'pm-dim' : ''} ${e.kind === 'learned_from' ? 'pm-dash' : ''}`}
              d={edgePath(a.x, a.y, b.x, b.y, e.id)}
              fill="none"
              stroke={style.c}
              strokeWidth={hot ? style.w + 1.4 : style.w}
              strokeOpacity={hot ? 1 : 0.78}
              strokeDasharray={style.dash ? '7 6' : undefined}
              strokeLinecap="round"
            />
          );
        })}
      </g>
      <g>
        {graph.nodes.map((n) => {
          const p = sim?.get(n.id);
          if (!p) return null;
          const r = p.radius;
          const dimmed = dimNode(n.id);
          const isHover = hovered === n.id;
          const isSel = selected === n.id;
          const color = KIND_COLOR[n.kind];
          const pinned = p.fx != null;
          return (
            <g
              key={n.id}
              className={`pm-node pm-enter ${dimmed ? 'pm-dim' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`${n.kind}: ${n.label}`}
              onPointerDown={(ev) => onNodePointerDown(ev, n.id)}
              onPointerMove={onNodePointerMove}
              onPointerUp={(ev) => onNodePointerUp(ev, n.id)}
              onDoubleClick={() => onNodeDoubleClick(n.id)}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered((cur) => (cur === n.id ? null : cur))}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  onSelect(selected === n.id ? null : n.id);
                }
              }}
            >
              {(isSel || isHover) && (
                <circle cx={p.x} cy={p.y} r={r + 7} fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.5} />
              )}
              {pinned && !isSel && !isHover && (
                <circle cx={p.x} cy={p.y} r={r + 4} fill="none" stroke={color} strokeWidth={1} strokeDasharray="2 3" strokeOpacity={0.4} />
              )}
              {nodeShape(n.kind, color, p.x, p.y, r)}
              {showLabel(n, dimmed, isHover, isSel) && (
                <text className="pm-lbl" x={p.x} y={p.y + r + 13} textAnchor="middle">
                  {n.label}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
