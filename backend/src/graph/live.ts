import type {
  PodGraph,
  PodGraphNode,
  PodGraphEdge,
  PodGraphMetric,
  PodGraphNodeKind,
  PodGraphEdgeKind,
  PodGraphNodeStatus,
} from '@podman/shared';
import { collections, getGitStates, getDb } from '../memory/db.js';

/**
 * Live materializer: build a pod's continual-learning graph from the real
 * collections the agent writes (pods, engineer_states, observations, collisions,
 * interventions, outcomes) — NOT the hardcoded demo. See docs/live-ui-spec.md §1.
 *
 * Pure-read and best-effort. Returns `null` when there is no real activity yet
 * (only bare roster), so `loadPodGraph` can fall back to the demo graph.
 */

const ACTIVE_WINDOW_MS = 90_000;
const MAX_OBSERVATIONS = 250;

/** Strip a `git status --short` XY code (and rename `old -> new`) to a clean path. */
export function parseGitStatusPath(line: string): string {
  let s = line.trim();
  const arrow = s.indexOf(' -> ');
  if (arrow !== -1) s = s.slice(arrow + 4);
  else s = s.replace(/^[ACDMRTU?!]{1,2}\s+/, '');
  return normalizeFile(s);
}

/** Normalize a file path so vision (`collisions.file`) and git paths match. */
export function normalizeFile(f: string): string {
  return f
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^\.\//, '');
}

const STATUS_RANK: Record<PodGraphNodeStatus, number> = {
  stable: 0,
  active: 1,
  learned: 2,
  risk: 3,
};

interface Builder {
  nodes: Map<string, PodGraphNode>;
  edges: Map<string, PodGraphEdge>;
}

function nodeKey(kind: PodGraphNodeKind, key: string): string {
  return `${kind}:${key}`;
}

function upsertNode(
  b: Builder,
  kind: PodGraphNodeKind,
  key: string,
  patch: Partial<Omit<PodGraphNode, 'id' | 'kind' | 'x' | 'y'>>,
): string {
  const id = nodeKey(kind, kind === 'engineer' ? key.toLowerCase() : key);
  const cur = b.nodes.get(id);
  if (!cur) {
    b.nodes.set(id, {
      id,
      kind,
      label: patch.label ?? key,
      summary: patch.summary ?? '',
      weight: patch.weight ?? 0.6,
      status: patch.status ?? 'stable',
      x: 0,
      y: 0,
    });
    return id;
  }
  if (patch.label) cur.label = patch.label;
  if (patch.summary) cur.summary = patch.summary;
  if (patch.weight && patch.weight > cur.weight) cur.weight = patch.weight;
  if (patch.status && STATUS_RANK[patch.status] > STATUS_RANK[cur.status])
    cur.status = patch.status;
  return id;
}

function upsertEdge(
  b: Builder,
  source: string,
  target: string,
  kind: PodGraphEdgeKind,
  label: string,
  strength: number,
): void {
  const id = `${kind}:${source}->${target}`;
  const cur = b.edges.get(id);
  if (!cur) b.edges.set(id, { id, source, target, kind, label, strength });
  else if (strength > cur.strength) cur.strength = strength;
}

const COLUMN_X: Record<PodGraphNodeKind, number> = {
  engineer: 78,
  file: 300,
  feature: 360,
  collision: 470,
  intervention: 622,
};

/** Deterministic column layout so the SVG renders stably across refreshes. */
function layout(nodes: PodGraphNode[]): void {
  const byKind = new Map<PodGraphNodeKind, PodGraphNode[]>();
  for (const n of nodes) {
    const list = byKind.get(n.kind) ?? [];
    list.push(n);
    byKind.set(n.kind, list);
  }
  for (const [kind, list] of byKind) {
    list.sort((a, b) => a.id.localeCompare(b.id));
    const n = list.length;
    list.forEach((node, i) => {
      node.x = COLUMN_X[kind];
      node.y = Math.round(((i + 1) / (n + 1)) * 452) + 10;
    });
  }
}

const SEVERITY_WEIGHT: Record<string, number> = { info: 0.4, warn: 0.7, critical: 1 };

export async function materializePodGraph(podId: string): Promise<PodGraph | null> {
  const c = await collections();
  const db = await getDb();

  const [pod, observations, collisionDocs, interventionDocs, outcomeDocs, gitStates] =
    await Promise.all([
      c.pods.findOne({ id: podId }),
      c.observations.find({ podId }).sort({ observedAt: -1 }).limit(MAX_OBSERVATIONS).toArray(),
      c.collisions.find({ podId }).sort({ detectedAt: -1 }).limit(100).toArray(),
      c.interventions.find({ podId }).toArray(),
      c.outcomes.find({ podId }).toArray(),
      getGitStates(podId),
    ]);

  // Optional supervised ownership map (team_model.ownership: file -> engineer).
  let ownership: Record<string, string> = {};
  try {
    const tm = await db
      .collection<{ podId: string; ownership?: Record<string, string> }>('team_model')
      .findOne({ podId });
    ownership = tm?.ownership ?? {};
  } catch {
    /* ownership is optional */
  }

  const b: Builder = { nodes: new Map(), edges: new Map() };
  const now = Date.now();

  // 1. Baseline engineer nodes from the roster.
  for (const name of pod?.members ?? []) {
    upsertNode(b, 'engineer', name, { label: name });
  }

  // 2. Vision (observations): who is active and on which file, with confidence.
  for (const o of observations) {
    if (!o.engineerId) continue;
    const recent = o.observedAt && now - new Date(o.observedAt).getTime() < ACTIVE_WINDOW_MS;
    const eng = upsertNode(b, 'engineer', o.engineerId, {
      label: o.engineerId,
      status: recent ? 'active' : undefined,
    });
    if (o.currentFile) {
      const file = normalizeFile(o.currentFile);
      const f = upsertNode(b, 'file', file, { label: file });
      upsertEdge(b, eng, f, 'editing', o.activity ?? 'edits', Math.max(0.4, o.confidence ?? 0.5));
    }
  }

  // 3. Collisions: the detected overlaps (fused git + vision).
  const collisionById = new Map<string, (typeof collisionDocs)[number]>();
  for (const col of collisionDocs) {
    collisionById.set(col.id, col);
    const cNode = upsertNode(b, 'collision', col.id, {
      label: col.symbol ? `${col.file}#${col.symbol}` : col.file,
      status: 'risk',
      weight: SEVERITY_WEIGHT[col.severity] ?? 0.7,
      summary: `${col.engineers.join(' + ')} on ${col.file}${
        (col as { memorySignature?: string }).memorySignature ? ' · seen before' : ''
      }`,
    });
    const file = normalizeFile(col.file);
    const fNode = upsertNode(b, 'file', file, { label: file, status: 'risk' });
    upsertEdge(b, fNode, cNode, 'touches', 'hot', 0.6);
    for (const name of col.engineers) {
      const eng = upsertNode(b, 'engineer', name, { label: name });
      upsertEdge(b, eng, cNode, 'collides', 'in', SEVERITY_WEIGHT[col.severity] ?? 0.7);
    }
  }

  // 4. Git truth (engineer_states): mark unpushed work and confirm editing on
  //    files vision/collisions already surfaced — not the whole repo diff.
  for (const [name, git] of gitStates) {
    const files = git.changedFiles.map(parseGitStatusPath).filter(Boolean);
    const eng = upsertNode(b, 'engineer', name, {
      label: name,
      status: files.length > 0 ? 'risk' : 'active',
      summary: files.length
        ? `${files.length} changed file(s) on ${git.branch ?? 'detached'}`
        : `on ${git.branch ?? 'detached'}`,
      weight: 0.7,
    });
    for (const file of files) {
      const fid = nodeKey('file', file);
      if (b.nodes.has(fid)) upsertEdge(b, eng, fid, 'editing', 'edits', 0.6);
    }
  }

  // 5. Interventions: what PodMan offered for each collision.
  const interventionById = new Map<string, (typeof interventionDocs)[number]>();
  for (const iv of interventionDocs) {
    interventionById.set(iv.id, iv);
    const ivNode = upsertNode(b, 'intervention', iv.id, {
      label:
        iv.suggestedAction?.kind === 'open_sync_pr'
          ? 'sync PR'
          : iv.suggestedAction?.kind === 'ping_teammate'
            ? 'ping'
            : 'watch',
      summary: iv.message,
    });
    if (b.nodes.has(nodeKey('collision', iv.collisionId))) {
      upsertEdge(b, nodeKey('collision', iv.collisionId), ivNode, 'warns', 'nudges', 0.85);
    }
  }

  // 6. Outcomes: the supervised learning signal -> learned_from edges + owns.
  for (const out of outcomeDocs) {
    if (!out.accepted || !out.wasRealCollision) continue;
    const iv = interventionById.get(out.interventionId);
    const col = iv ? collisionById.get(iv.collisionId) : collisionById.get(out.collisionId);
    if (!col) continue;
    const file = normalizeFile(col.file);
    const owner =
      (out as { learnedOwner?: string }).learnedOwner ?? ownership[file] ?? col.engineers[0];
    if (!owner) continue;
    const engNode = upsertNode(b, 'engineer', owner, { label: owner, status: 'learned' });
    const fNode = upsertNode(b, 'file', file, { label: file });
    upsertEdge(b, engNode, fNode, 'owns', 'owns', 0.85);
    const ivKey = iv ? nodeKey('intervention', iv.id) : null;
    if (ivKey && b.nodes.has(ivKey)) {
      upsertNode(b, 'intervention', iv!.id, { status: 'learned' });
      upsertEdge(b, ivKey, engNode, 'learned_from', `learned: owns ${file}`, 0.6);
    }
  }

  const nodes = [...b.nodes.values()];
  // No real activity beyond the bare roster -> let the caller fall back to demo.
  const hasActivity = nodes.some((n) => n.kind !== 'engineer');
  if (!hasActivity) return null;

  layout(nodes);

  const acceptedReal = outcomeDocs.filter((o) => o.accepted && o.wasRealCollision).length;
  const totalOutcomes = outcomeDocs.length;
  const riskPaths = collisionDocs.filter((col) => new Set(col.engineers).size >= 2).length;
  const metrics: PodGraphMetric[] = [
    {
      label: 'Learned owners',
      value: String(acceptedReal),
      detail: 'Ownership retained from accepted interventions.',
    },
    {
      label: 'Open risk paths',
      value: String(riskPaths),
      detail: 'Files with two or more converging editors.',
    },
    {
      label: 'Accept rate',
      value: totalOutcomes ? `${Math.round((acceptedReal / totalOutcomes) * 100)}%` : '—',
      detail: 'Interventions accepted this session.',
    },
  ];

  return {
    podId,
    generatedAt: new Date().toISOString(),
    nodes,
    edges: [...b.edges.values()],
    metrics,
  };
}
