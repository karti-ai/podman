import type { CSSProperties } from 'react';
import type {
  PodGraph,
  PodGraphNode,
  PodGraphEdge,
  PodGraphNodeKind,
  ActivityKind,
} from '@podman/shared';

/**
 * Fixed, light-readable hues for the node/edge encoding. Kept stable across
 * light/dark so kinds stay distinguishable; only the chrome uses shadcn tokens.
 */
export const BLUE = '#2563eb';
export const SLATE = '#475569';
export const SLATE_EDGE = '#94a3b8';
export const SLATE_FAINT = '#cbd5e1';
export const AMBER = '#d97706';
export const RED = '#dc2626';
export const VIOLET = '#7c3aed';
export const GREEN = '#16a34a';

/** Tag color + short label per activity-stream kind. */
export const ACTIVITY_TAG: Record<ActivityKind, { color: string; label: string }> = {
  editing: { color: SLATE, label: 'EDITING' },
  collision: { color: RED, label: 'COLLISION' },
  warns: { color: AMBER, label: 'WARNS' },
  outcome: { color: GREEN, label: 'OUTCOME' },
  learned_from: { color: VIOLET, label: 'LEARNED' },
};

export const KIND_COLOR: Record<PodGraphNodeKind, string> = {
  engineer: BLUE,
  file: SLATE,
  feature: AMBER,
  collision: RED,
  intervention: VIOLET,
};

export interface EdgeStyle {
  c: string;
  w: number;
  dash?: boolean;
}

export const EDGE: Record<PodGraphEdge['kind'], EdgeStyle> = {
  owns: { c: BLUE, w: 2.4 },
  editing: { c: SLATE_EDGE, w: 1.9 },
  touches: { c: SLATE_FAINT, w: 1.5 },
  collides: { c: RED, w: 2.8 },
  warns: { c: AMBER, w: 2.8 },
  learned_from: { c: VIOLET, w: 2.4, dash: true },
};

/** Collision/drawing radius for a node — scaled by its 0..1 weight. */
export function nodeRadius(node: PodGraphNode): number {
  const base = node.kind === 'collision' || node.kind === 'intervention' ? 14 : 13;
  return base + Math.max(0, Math.min(1, node.weight)) * 7;
}

export function statusColor(status: string): string {
  if (status === 'risk') return RED;
  if (status === 'learned') return VIOLET;
  if (status === 'active') return BLUE;
  return 'var(--muted-foreground)';
}

export type Mode = 'risk' | 'learn' | 'all';

export interface Highlight {
  nodes: Set<string>;
  edges: Set<string>;
}

/**
 * The lit set for the current mode/selection. A selected node lights its
 * incident edges + neighbors; otherwise the mode lights the risk or learning
 * chain (collision → intervention → learned_from). `all` lights everything.
 */
export function highlightFor(graph: PodGraph, mode: Mode, selected: string | null): Highlight | null {
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

export const NODE_LEGEND: Array<{ label: string; swatch: CSSProperties }> = [
  { label: 'engineer', swatch: { background: BLUE } },
  { label: 'file', swatch: { border: `2px solid ${SLATE}` } },
  { label: 'feature', swatch: { background: AMBER, borderRadius: '50%' } },
  { label: 'collision', swatch: { background: RED, clipPath: 'polygon(50% 0,100% 100%,0 100%)' } },
  { label: 'intervention', swatch: { background: VIOLET, transform: 'rotate(45deg)' } },
];

export const EDGE_LEGEND: Array<{ label: string; color: string; dash?: boolean }> = [
  { label: 'collides', color: RED },
  { label: 'warns', color: AMBER },
  { label: 'learned_from', color: VIOLET, dash: true },
  { label: 'owns', color: BLUE },
];
