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
    .replace(/^[ACDMRTU?!]{1,2}\s+/, '')
    .replace(/^\.\//, '');
}

const MAX_COLLISIONS = 8;

/** Reject "file" values that aren't real source paths — vision/git noise such as
 *  URLs, env vars, browser/app names, and scratch/test artifacts. */
const FILE_NOISE =
  /(:\/\/|^[#~]|\s|\.env\b|\btett\b|test-change|demo-scratch|podman-test|scratch|sslip)/i;
export function isFilePath(f: string): boolean {
  if (!f || FILE_NOISE.test(f)) return false;
  return /\.[a-z0-9]{1,6}$/i.test(f); // must end in a real file extension
}

/** Engineer names that are test/verification artifacts, not real teammates. */
const ENGINEER_NOISE = /(^verify\b|^.$|testrepo|-?check\b|\d{4,})/i;

const MAX_FILES = 9;

/** Short, readable node label — last two path segments (full path goes in summary). */
function shortLabel(file: string): string {
  const parts = file.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || file;
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
    const file = o.currentFile ? normalizeFile(o.currentFile) : '';
    if (isFilePath(file)) {
      const f = upsertNode(b, 'file', file, { label: shortLabel(file), summary: file });
      upsertEdge(b, eng, f, 'editing', o.activity ?? 'edits', Math.max(0.4, o.confidence ?? 0.5));
    }
  }

  // Collisions referenced by accepted outcomes are the "learned" money path — they
  // always survive the cap so the learned_from beat is never dropped.
  const priorityCol = new Set<string>();
  for (const out of outcomeDocs) {
    if (!out.accepted || !out.wasRealCollision) continue;
    if (out.collisionId) priorityCol.add(out.collisionId);
    const iv = interventionDocs.find((i) => i.id === out.interventionId);
    if (iv?.collisionId) priorityCol.add(iv.collisionId);
  }

  // 3. Collisions: collapse repeats by signature, keep the most recent, cap to
  //    MAX_COLLISIONS, skip junk-file collisions. `collisionById` keeps every doc
  //    (for the outcome join); `colNodeFor` maps each collisionId to its surviving
  //    collision node (or null when collapsed / capped / filtered out).
  const collisionById = new Map<string, (typeof collisionDocs)[number]>();
  const colNodeFor = new Map<string, string | null>();
  const sigToNode = new Map<string, string>();
  let distinctCollisions = 0;
  for (const col of collisionDocs) {
    collisionById.set(col.id, col);
    const file = normalizeFile(col.file);
    const sig =
      (col as { memorySignature?: string }).memorySignature ?? `${file}#${col.symbol ?? ''}`;
    const existing = sigToNode.get(sig);
    if (existing) {
      colNodeFor.set(col.id, existing);
      continue;
    }
    if (!isFilePath(file)) {
      colNodeFor.set(col.id, null);
      continue;
    }
    const isPriority = priorityCol.has(col.id);
    if (!isPriority && distinctCollisions >= MAX_COLLISIONS) {
      colNodeFor.set(col.id, null);
      continue;
    }
    const cNode = upsertNode(b, 'collision', col.id, {
      label: shortLabel(file),
      status: 'risk',
      weight: SEVERITY_WEIGHT[col.severity] ?? 0.7,
      summary: `${col.engineers.join(' + ')} on ${file}${
        (col as { memorySignature?: string }).memorySignature ? ' · seen before' : ''
      }`,
    });
    const fNode = upsertNode(b, 'file', file, {
      label: shortLabel(file),
      summary: file,
      status: 'risk',
    });
    upsertEdge(b, fNode, cNode, 'touches', 'hot', 0.6);
    for (const name of col.engineers) {
      const eng = upsertNode(b, 'engineer', name, { label: name });
      upsertEdge(b, eng, cNode, 'collides', 'in', SEVERITY_WEIGHT[col.severity] ?? 0.7);
    }
    sigToNode.set(sig, cNode);
    colNodeFor.set(col.id, cNode);
    if (!isPriority) distinctCollisions++;
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

  // 5. Interventions: collapse to one (most recent) per surviving collision.
  const interventionById = new Map<string, (typeof interventionDocs)[number]>();
  const ivNodeForCol = new Map<string, string>();
  const sortedIvs = [...interventionDocs].sort((a, b) =>
    String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
  );
  for (const iv of sortedIvs) {
    interventionById.set(iv.id, iv);
    const colNode = colNodeFor.get(iv.collisionId);
    if (!colNode || ivNodeForCol.has(colNode)) continue;
    const ivNode = upsertNode(b, 'intervention', iv.id, {
      label:
        iv.suggestedAction?.kind === 'open_sync_pr'
          ? 'sync PR'
          : iv.suggestedAction?.kind === 'ping_teammate'
            ? 'ping'
            : 'watch',
      summary: iv.message,
    });
    upsertEdge(b, colNode, ivNode, 'warns', 'nudges', 0.85);
    ivNodeForCol.set(colNode, ivNode);
  }

  // 6. Outcomes: the supervised learning signal -> learned_from edges + owns.
  for (const out of outcomeDocs) {
    if (!out.accepted || !out.wasRealCollision) continue;
    const iv = interventionById.get(out.interventionId);
    const col = iv ? collisionById.get(iv.collisionId) : collisionById.get(out.collisionId);
    if (!col) continue;
    const file = normalizeFile(col.file);
    if (!isFilePath(file)) continue;
    const owner =
      (out as { learnedOwner?: string }).learnedOwner ?? ownership[file] ?? col.engineers[0];
    if (!owner) continue;
    const engNode = upsertNode(b, 'engineer', owner, { label: owner, status: 'learned' });
    const fNode = upsertNode(b, 'file', file, { label: file });
    upsertEdge(b, engNode, fNode, 'owns', 'owns', 0.85);
    const cNode = colNodeFor.get(col.id);
    const ivNode = cNode ? ivNodeForCol.get(cNode) : undefined;
    if (ivNode) {
      const ivObj = b.nodes.get(ivNode);
      if (ivObj) ivObj.status = 'learned';
      upsertEdge(b, ivNode, engNode, 'learned_from', `learned: owns ${file}`, 0.6);
    }
  }

  // Prune test-artifact engineers, then anything left orphaned by that.
  const dropNode = (id: string) => {
    b.nodes.delete(id);
    for (const [eid, e] of [...b.edges])
      if (e.source === id || e.target === id) b.edges.delete(eid);
  };
  for (const [id, n] of [...b.nodes]) {
    if (n.kind === 'engineer' && ENGINEER_NOISE.test(n.label)) dropNode(id);
  }
  // Collisions with no remaining engineer = test/orphan -> drop.
  for (const [id, n] of [...b.nodes]) {
    if (n.kind !== 'collision') continue;
    if (![...b.edges.values()].some((e) => e.kind === 'collides' && e.target === id)) dropNode(id);
  }
  // Cap file nodes to the most-connected (collision files first).
  const fileNodes = [...b.nodes.values()].filter((n) => n.kind === 'file');
  if (fileNodes.length > MAX_FILES) {
    const inCollision = (id: string) =>
      [...b.edges.values()].some((e) => e.kind === 'touches' && e.source === id);
    const degree = (id: string) =>
      [...b.edges.values()].filter((e) => e.source === id || e.target === id).length;
    fileNodes.sort(
      (a, z) =>
        Number(inCollision(z.id)) - Number(inCollision(a.id)) || degree(z.id) - degree(a.id),
    );
    for (const n of fileNodes.slice(MAX_FILES)) dropNode(n.id);
  }

  // Files / interventions left with no edges -> drop.
  for (const [id, n] of [...b.nodes]) {
    if (n.kind === 'file' || n.kind === 'intervention') {
      if (![...b.edges.values()].some((e) => e.source === id || e.target === id))
        b.nodes.delete(id);
    }
  }

  const nodes = [...b.nodes.values()];
  // No real activity beyond the bare roster -> let the caller fall back to demo.
  const hasActivity = nodes.some((n) => n.kind !== 'engineer');
  if (!hasActivity) return null;

  layout(nodes);

  const acceptedReal = outcomeDocs.filter((o) => o.accepted && o.wasRealCollision).length;
  const totalOutcomes = outcomeDocs.length;
  const riskPaths = new Set(
    collisionDocs.map(
      (col) =>
        (col as { memorySignature?: string }).memorySignature ??
        `${normalizeFile(col.file)}#${col.symbol ?? ''}`,
    ),
  ).size;
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
