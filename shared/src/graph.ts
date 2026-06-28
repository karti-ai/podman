/**
 * Continual-learning graph: PodMan's visible "it learned" surface. A render of
 * the per-pod team_model — who owns/edits which files, where work collides, and
 * what PodMan learned from accepted interventions (the `learned_from` edges).
 *
 * Served embedded in the `team_model` document; mirrored into `graph_nodes` /
 * `graph_edges` collections so the model can be walked with MongoDB
 * `$graphLookup`. See docs/graph.md.
 */

export type PodGraphNodeKind = 'engineer' | 'feature' | 'file' | 'collision' | 'intervention';

export type PodGraphEdgeKind =
  'owns' | 'editing' | 'touches' | 'collides' | 'warns' | 'learned_from';

/** `learned` marks a node PodMan retained from a past accepted intervention. */
export type PodGraphNodeStatus = 'stable' | 'active' | 'risk' | 'learned';

export interface PodGraphNode {
  /** Stable graph id, e.g. "engineer:karti" or "file:auth.ts". */
  id: string;
  kind: PodGraphNodeKind;
  label: string;
  summary: string;
  /** 0–1 relative importance — drives node size in the viz. */
  weight: number;
  status: PodGraphNodeStatus;
  /** Layout position on the SVG canvas (viewBox 0..720 x 0..472). */
  x: number;
  y: number;
}

export interface PodGraphEdge {
  id: string;
  /** Source node id. */
  source: string;
  /** Target node id. */
  target: string;
  kind: PodGraphEdgeKind;
  label: string;
  /** 0–1 confidence/strength — drives edge thickness. */
  strength: number;
}

export interface PodGraphMetric {
  label: string;
  value: string;
  detail: string;
}

/** The five stages of PodMan's continual-learning loop, in order. */
export type LearningStageKey = 'observe' | 'store' | 'predict' | 'outcome' | 'adapt';

/** One stage of the learning-loop rail (observe→store→predict→outcome→adapt). */
export interface LearningStage {
  key: LearningStageKey;
  /** UPPERCASE display title, e.g. "OBSERVE". */
  title: string;
  /** Headline figure for the stage, e.g. "5/s" or "124". */
  value: string;
  /** One-line detail under the title. */
  detail: string;
  /** True for the single most-recently-active stage (pulses in the UI). */
  active: boolean;
}

/** Kind of an activity-stream entry (drives the colored tag). */
export type ActivityKind = 'editing' | 'collision' | 'warns' | 'outcome' | 'learned_from';

/** One time-tagged entry in the activity stream. */
export interface ActivityEvent {
  /** Stable id (source doc id + kind) so the UI can animate diffs. */
  id: string;
  /** ISO timestamp the event happened. */
  at: string;
  kind: ActivityKind;
  /** Human-readable line, e.g. "Yahya opened auth.ts — unpushed changes". */
  text: string;
}

/** A point-in-time render of a pod's team_model. */
export interface PodGraph {
  podId: string;
  /** ISO timestamp the snapshot was generated. */
  generatedAt: string;
  nodes: PodGraphNode[];
  edges: PodGraphEdge[];
  metrics: PodGraphMetric[];
  /** Continual-learning loop counts (observe→…→adapt). Additive/optional. */
  loop?: LearningStage[];
  /** Recent activity feed, most-recent first, capped ~8. Additive/optional. */
  activity?: ActivityEvent[];
}

/** One node as a standalone document in the `graph_nodes` collection. */
export interface GraphNodeDoc extends PodGraphNode {
  podId: string;
}

/** One edge as a standalone document in the `graph_edges` collection (for $graphLookup). */
export interface GraphEdgeDoc extends PodGraphEdge {
  podId: string;
}
