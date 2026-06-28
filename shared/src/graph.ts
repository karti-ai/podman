/**
 * Continual-learning graph: PodMan's visible "it learned" surface. A render of
 * the per-pod team_model — who owns/edits which files, where work collides, and
 * what PodMan learned from accepted interventions (the `learned_from` edges).
 *
 * Served embedded in the `team_model` document; mirrored into `graph_nodes` /
 * `graph_edges` collections so the model can be walked with MongoDB
 * `$graphLookup`. See docs/cont_learning.md.
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

export type PodLearningLoopStepKey = 'observe' | 'store' | 'predict' | 'outcome' | 'adapt';

export type PodLearningLoopStepStatus = 'quiet' | 'active' | 'complete' | 'planned';

export interface PodLearningLoopStep {
  key: PodLearningLoopStepKey;
  label: string;
  value: string;
  detail: string;
  status: PodLearningLoopStepStatus;
}

export interface PodLearningLoop {
  activeStep: PodLearningLoopStepKey;
  steps: PodLearningLoopStep[];
}

export type PodGraphActivityKind =
  | 'editing'
  | 'collision'
  | 'intervention'
  | 'outcome'
  | 'learned'
  | 'agent';

export interface PodGraphActivity {
  id: string;
  at: string;
  kind: PodGraphActivityKind;
  title: string;
  detail: string;
  nodeId?: string;
  edgeId?: string;
}

/** A point-in-time render of a pod's team_model. */
export interface PodGraph {
  podId: string;
  /** ISO timestamp the snapshot was generated. */
  generatedAt: string;
  nodes: PodGraphNode[];
  edges: PodGraphEdge[];
  metrics: PodGraphMetric[];
  loop?: PodLearningLoop;
  activity?: PodGraphActivity[];
}

/** One node as a standalone document in the `graph_nodes` collection. */
export interface GraphNodeDoc extends PodGraphNode {
  podId: string;
}

/** One edge as a standalone document in the `graph_edges` collection (for $graphLookup). */
export interface GraphEdgeDoc extends PodGraphEdge {
  podId: string;
}
