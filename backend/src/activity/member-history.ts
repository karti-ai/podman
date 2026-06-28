import type {
  Collision,
  EngineerContext,
  MemberWorkHistory,
  MemberWorkHistoryFile,
  MemberWorkHistoryRoi,
} from '@podman/shared';
import { getDb } from '../memory/db.js';
import { parseGitStatusPath } from '../graph/live.js';

interface EngineerStateDoc {
  _id: string;
  podId: string;
  name: string;
  changedFiles?: string[];
  branch?: string | null;
  recentCommit?: string | null;
  gitUpdatedAt?: Date | string;
  updatedAt?: Date | string;
}

interface FileAccumulator {
  file: string;
  observations: number;
  gitChanges: number;
  firstSeenAt: number;
  lastSeenAt: number;
  confidenceSum: number;
  confidenceCount: number;
  activities: Set<string>;
  current: boolean;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function dateMs(value: string | Date | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function clean(value: string | undefined): string {
  return value?.trim() ?? '';
}

function sameMember(a: string | undefined, b: string): boolean {
  return clean(a).toLowerCase() === b.trim().toLowerCase();
}

function addFile(files: Map<string, FileAccumulator>, file: string, at: number): FileAccumulator {
  const existing = files.get(file);
  if (existing) {
    if (at > 0) {
      existing.firstSeenAt = Math.min(existing.firstSeenAt || at, at);
      existing.lastSeenAt = Math.max(existing.lastSeenAt, at);
    }
    return existing;
  }
  const acc: FileAccumulator = {
    file,
    observations: 0,
    gitChanges: 0,
    firstSeenAt: at,
    lastSeenAt: at,
    confidenceSum: 0,
    confidenceCount: 0,
    activities: new Set<string>(),
    current: false,
  };
  files.set(file, acc);
  return acc;
}

export async function getMemberWorkHistory(
  podId: string,
  member: string,
  options: { hours?: number; limit?: number } = {},
): Promise<MemberWorkHistory> {
  const db = await getDb();
  const windowHours = Math.min(Math.max(options.hours ?? 24, 1), 168);
  const limit = Math.min(Math.max(options.limit ?? 80, 10), 200);
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  const [observations, gitState, collisions, interventions] = await Promise.all([
    db
      .collection<EngineerContext>('observations')
      .find({ podId, observedAt: { $gte: since } }, { projection: { _id: 0 } })
      .sort({ observedAt: -1 })
      .limit(500)
      .toArray(),
    db.collection<EngineerStateDoc>('engineer_states').findOne({
      podId,
      name: { $regex: `^${member.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    }),
    db
      .collection<Collision>('collisions')
      .find({ podId, detectedAt: { $gte: since } }, { projection: { _id: 0 } })
      .sort({ detectedAt: -1 })
      .limit(200)
      .toArray(),
    db
      .collection<{ collisionId: string }>('interventions')
      .find({ podId }, { projection: { collisionId: 1, _id: 0 } })
      .toArray(),
  ]);

  const files = new Map<string, FileAccumulator>();
  const timeline: MemberWorkHistory['timeline'] = [];
  const memberObservations = observations.filter((doc) => sameMember(doc.engineerId, member));

  for (const doc of memberObservations) {
    const file = clean(doc.currentFile);
    if (!file) continue;
    const at = dateMs(doc.observedAt);
    const acc = addFile(files, file, at);
    acc.observations += 1;
    acc.current ||= timeline.length === 0;
    if (typeof doc.confidence === 'number') {
      acc.confidenceSum += doc.confidence;
      acc.confidenceCount += 1;
    }
    const activity = clean(doc.activity);
    if (activity) acc.activities.add(activity);
    timeline.push({
      id: `vision:${doc.engineerId}:${doc.observedAt}:${file}`,
      at: doc.observedAt,
      source: 'vision',
      file,
      title: activity || `Worked in ${file}`,
      detail: clean(doc.currentSymbol) ? `symbol ${doc.currentSymbol}` : undefined,
      confidence: doc.confidence,
    });
  }

  const gitAt = dateMs(gitState?.gitUpdatedAt ?? gitState?.updatedAt);
  for (const raw of gitState?.changedFiles ?? []) {
    const file = parseGitStatusPath(raw);
    if (!file) continue;
    const acc = addFile(files, file, gitAt || Date.now());
    acc.gitChanges += 1;
    acc.current = true;
    timeline.push({
      id: `git:${gitState?._id}:${gitAt}:${file}`,
      at: toIso(gitAt || Date.now()),
      source: 'git',
      file,
      title: `Local change in ${file}`,
      detail: [gitState?.branch ? `branch ${gitState.branch}` : undefined, gitState?.recentCommit]
        .filter(Boolean)
        .join(' · '),
    });
  }

  const fileRows: MemberWorkHistoryFile[] = [...files.values()]
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt || b.observations - a.observations)
    .slice(0, 12)
    .map((file) => ({
      file: file.file,
      observations: file.observations,
      gitChanges: file.gitChanges,
      firstSeenAt: toIso(file.firstSeenAt || file.lastSeenAt || Date.now()),
      lastSeenAt: toIso(file.lastSeenAt || file.firstSeenAt || Date.now()),
      confidenceAvg: file.confidenceCount
        ? Math.round((file.confidenceSum / file.confidenceCount) * 100) / 100
        : null,
      activities: [...file.activities].slice(0, 3),
      current: file.current,
    }));

  timeline.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const interventionIds = new Set(interventions.map((i) => i.collisionId));
  const roi = computeRoi(member, collisions, interventionIds, gitState?.changedFiles?.length ?? 0);

  return {
    podId,
    member,
    generatedAt: new Date().toISOString(),
    windowHours,
    totals: {
      files: fileRows.length,
      observations: memberObservations.length,
      gitChanges: gitState?.changedFiles?.length ?? 0,
    },
    files: fileRows,
    timeline: timeline.slice(0, limit),
    roi,
  };
}

function computeRoi(
  member: string,
  collisions: Collision[],
  interventionCollisionIds: Set<string>,
  changedFileCount: number,
): MemberWorkHistoryRoi {
  const involved = (c: Collision) =>
    c.engineers?.some((e) => sameMember(e, member)) ||
    sameMember(c.researcher, member) ||
    sameMember(c.editor, member);

  const eligible = collisions.filter(
    (c) =>
      involved(c) &&
      interventionCollisionIds.has(c.id) &&
      (c.gitOverlap === true || c.severity === 'critical'),
  );

  const weightOf = (c: Collision): { label: string; minutes: number } => {
    if (c.overlapKind === 'research') return { label: 'research overlap', minutes: 10 };
    if (c.severity === 'critical') return { label: 'critical same-file', minutes: 45 };
    if (c.severity === 'warn') return { label: 'warn same-file', minutes: 20 };
    return { label: 'info same-file', minutes: 10 };
  };

  let savedMinutes = 0;
  const groups = new Map<string, { count: number; minutesEach: number }>();
  for (const c of eligible) {
    const { label, minutes } = weightOf(c);
    savedMinutes += minutes / Math.max(1, c.engineers?.length ?? 1);
    const g = groups.get(label) ?? { count: 0, minutesEach: minutes };
    g.count += 1;
    groups.set(label, g);
  }

  const filesDeconflicted = new Set(eligible.map((c) => c.file)).size;
  return {
    savedMinutes: Math.round(savedMinutes),
    clashesCaught: eligible.length,
    filesDeconflicted,
    conflictFreeFiles: Math.max(0, changedFileCount - filesDeconflicted),
    totalFiles: changedFileCount,
    breakdown: [...groups.entries()].map(([label, g]) => ({
      label,
      count: g.count,
      minutesEach: g.minutesEach,
    })),
  };
}
