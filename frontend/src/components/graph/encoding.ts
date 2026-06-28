import type { CSSProperties } from 'react';
import type {
  PodGraph,
  PodGraphNode,
  PodGraphEdge,
  PodGraphNodeKind,
  PodGraphActivityKind,
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
export const ACTIVITY_TAG: Record<PodGraphActivityKind, { color: string; label: string }> = {
  editing: { color: SLATE, label: 'EDITING' },
  collision: { color: RED, label: 'COLLISION' },
  intervention: { color: AMBER, label: 'NUDGE' },
  outcome: { color: GREEN, label: 'OUTCOME' },
  learned: { color: VIOLET, label: 'LEARNED' },
  agent: { color: BLUE, label: 'AGENT' },
  suppressed: { color: VIOLET, label: 'SUPPRESSED' },
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

function joinNames(ids: string[], label: (id: string) => string): string {
  const u = [...new Set(ids)].map(label);
  if (u.length <= 1) return u[0] ?? '';
  if (u.length === 2) return `${u[0]} and ${u[1]}`;
  return `${u.slice(0, -1).join(', ')} and ${u[u.length - 1]}`;
}

/**
 * A plain-English walk of the flow through a node — what PodMan saw, flagged,
 * suggested, and learned — so clicking a node explains the path, not just shows
 * attributes. Built by traversing the node's incident edges.
 */
export function flowNarrative(graph: PodGraph, nodeId: string): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const node = byId.get(nodeId);
  if (!node) return '';
  const label = (id: string): string => byId.get(id)?.label ?? id;
  const out = graph.edges.filter((e) => e.source === nodeId);
  const inc = graph.edges.filter((e) => e.target === nodeId);

  switch (node.kind) {
    case 'engineer': {
      const edits = out.filter((e) => e.kind === 'editing').map((e) => e.target);
      const collisions = out.filter((e) => e.kind === 'collides');
      const owns = out.filter((e) => e.kind === 'owns').map((e) => label(e.target));
      const learned = inc.some((e) => e.kind === 'learned_from');
      const parts: string[] = [];
      if (edits.length) parts.push(`${node.label} is working in ${joinNames(edits, label)}.`);
      if (collisions.length)
        parts.push(
          `PodMan flagged ${collisions.length} overlap${collisions.length === 1 ? '' : 's'} involving ${node.label}.`,
        );
      if (learned)
        parts.push(
          `From an accepted intervention PodMan learned ${node.label} owns ${owns[0] ?? 'this file'} — retained across sessions.`,
        );
      else if (owns.length) parts.push(`PodMan has ${node.label} owning ${joinNames(owns, (s) => s)}.`);
      return parts.join(' ') || `${node.label} has no active flow right now.`;
    }
    case 'file': {
      const editors = inc.filter((e) => e.kind === 'editing' || e.kind === 'owns').map((e) => e.source);
      const hasCollision = out.some((e) => e.kind === 'touches');
      const parts: string[] = [];
      if (editors.length) parts.push(`${node.label} is being edited by ${joinNames(editors, label)}.`);
      if (hasCollision)
        parts.push('Two of those edits overlap before push, so PodMan opened a collision on it.');
      return parts.join(' ') || node.summary || node.label;
    }
    case 'collision': {
      const engineers = inc.filter((e) => e.kind === 'collides').map((e) => e.source);
      const fileEdge = inc.find((e) => e.kind === 'touches');
      const file = fileEdge ? label(fileEdge.source) : 'the same file';
      const intervention = out.find((e) => e.kind === 'warns');
      let s = `${joinNames(engineers, label) || 'Two engineers'} are both editing ${file} before pushing — the overlap git can't see.`;
      if (intervention) s += ` PodMan stepped in and suggested a ${label(intervention.target)}.`;
      return s;
    }
    case 'intervention': {
      const colEdge = inc.find((e) => e.kind === 'warns');
      const learned = out.find((e) => e.kind === 'learned_from');
      // Resolve the collision's underlying file via its touches edge (file → collision).
      let file = '';
      if (colEdge) {
        const fileEdge = graph.edges.find((e) => e.kind === 'touches' && e.target === colEdge.source);
        file = fileEdge ? label(fileEdge.source) : '';
      }
      let s = `PodMan offered a ${node.label}${file ? ` for the overlap on ${file}` : ''}.`;
      if (learned)
        s += ` The pod accepted it, so PodMan learned ${label(learned.target)} owns ${file || 'the file'} — the graph got sharper.`;
      return s;
    }
    case 'feature': {
      const contributors = inc.filter((e) => e.kind === 'owns' || e.kind === 'touches').map((e) => e.source);
      return contributors.length
        ? `${node.label} is built on work by ${joinNames(contributors, label)}.`
        : node.summary || node.label;
    }
    default:
      return node.summary ?? '';
  }
}

/** Short explainer for the current view when nothing is selected. */
export function modeBlurb(mode: Mode): string {
  if (mode === 'learn')
    return 'The violet learned_from links are ownership PodMan kept from accepted interventions — the graph sharpens every session.';
  if (mode === 'all')
    return 'Everyone, every file, and every collision and intervention PodMan is tracking for this pod.';
  return 'The lit path: files where two editors collide before push → the nudge PodMan sent → what it learned.';
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
  { label: 'editing', color: SLATE_EDGE },
  { label: 'touches', color: SLATE_FAINT },
];
