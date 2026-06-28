import type {
  Collision,
  EngineerContext,
  Intervention,
  InterventionOutcome,
  PodActivityEvent,
} from '@podman/shared';
import { getDb } from '../memory/db.js';

interface EngineerStateDoc {
  _id: string;
  podId: string;
  name: string;
  changedFiles?: string[];
  diffStat?: string | null;
  recentCommit?: string | null;
  branch?: string | null;
  gitUpdatedAt?: Date | string;
  updatedAt?: Date | string;
}

function toIso(value: Date | string | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (value) return new Date(value).toISOString();
  return new Date(0).toISOString();
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function shortFiles(files: string[] | undefined): string {
  if (!files?.length) return 'clean working tree';
  const sample = files.slice(0, 3).join(', ');
  return files.length > 3 ? `${sample}, +${files.length - 3} more` : sample;
}

function observationEvent(doc: EngineerContext): PodActivityEvent {
  const file = clean(doc.currentFile);
  const symbol = clean(doc.currentSymbol);
  return {
    id: `observation:${doc.engineerId}:${doc.observedAt}`,
    podId: doc.podId,
    kind: 'observation',
    source: 'vision',
    actor: doc.engineerId,
    actors: [doc.engineerId],
    file,
    imageUrl: doc.screenshotDataUrl,
    title: file ? `Working in ${file}` : 'Screen context updated',
    detail: [
      symbol ? `symbol ${symbol}` : undefined,
      clean(doc.activity),
      doc.hasUnpushedChanges ? 'unpushed changes visible' : undefined,
      `confidence ${Math.round(doc.confidence * 100)}%`,
    ]
      .filter(Boolean)
      .join(' · '),
    severity: doc.hasUnpushedChanges ? 'warn' : 'info',
    at: doc.observedAt,
  };
}

function gitEvent(doc: EngineerStateDoc): PodActivityEvent {
  const changedFiles = doc.changedFiles ?? [];
  return {
    id: `git:${doc._id}:${toIso(doc.gitUpdatedAt ?? doc.updatedAt)}`,
    podId: doc.podId,
    kind: 'git',
    source: 'git',
    actor: doc.name,
    actors: [doc.name],
    title: changedFiles.length ? `${changedFiles.length} local file changes` : 'Git state is clean',
    detail: [
      doc.branch ? `branch ${doc.branch}` : undefined,
      shortFiles(changedFiles),
      doc.recentCommit ? `head ${doc.recentCommit}` : undefined,
    ]
      .filter(Boolean)
      .join(' · '),
    severity: changedFiles.length ? 'warn' : 'info',
    at: toIso(doc.gitUpdatedAt ?? doc.updatedAt),
  };
}

function collisionEvent(doc: Collision): PodActivityEvent {
  return {
    id: `collision:${doc.id}`,
    podId: doc.podId,
    kind: 'collision',
    source: 'memory',
    actor: doc.engineers[0],
    actors: doc.engineers,
    file: doc.file,
    title: `${doc.engineers.join(' + ')} conflict on ${doc.file}`,
    detail: [
      doc.symbol ? `symbol ${doc.symbol}` : undefined,
      doc.githubState?.unpushed ? 'unpushed local changes involved' : undefined,
      doc.githubState?.openPrs?.length
        ? `open PRs ${doc.githubState.openPrs.join(', ')}`
        : undefined,
    ]
      .filter(Boolean)
      .join(' · '),
    severity: doc.severity,
    at: doc.detectedAt,
  };
}

function interventionEvent(doc: Intervention): PodActivityEvent {
  return {
    id: `intervention:${doc.id}`,
    podId: doc.podId,
    kind: 'intervention',
    source: 'hermes',
    title: `Hermes ${doc.status} ${doc.suggestedAction.kind.replaceAll('_', ' ')}`,
    detail: doc.message,
    severity: doc.status === 'accepted' ? 'success' : doc.status === 'dismissed' ? 'info' : 'warn',
    at: doc.createdAt,
  };
}

function outcomeEvent(doc: InterventionOutcome): PodActivityEvent {
  return {
    id: `outcome:${doc.interventionId}:${doc.recordedAt}`,
    podId: doc.podId,
    kind: 'outcome',
    source: 'policy',
    title: doc.accepted ? 'Intervention accepted' : 'Intervention dismissed',
    detail: doc.wasRealCollision ? 'confirmed real collision' : 'marked as false positive',
    severity: doc.accepted ? 'success' : 'info',
    at: doc.recordedAt,
  };
}

export async function listPodActivity(podId: string, limit = 80): Promise<PodActivityEvent[]> {
  const db = await getDb();
  const [observations, gitStates, collisions, interventions, outcomes] = await Promise.all([
    db
      .collection<EngineerContext>('observations')
      .find({ podId }, { projection: { _id: 0 } })
      .sort({ observedAt: -1 })
      .limit(limit)
      .toArray(),
    db
      .collection<EngineerStateDoc>('engineer_states')
      .find(
        { podId },
        {
          projection: {
            _id: 1,
            podId: 1,
            name: 1,
            changedFiles: 1,
            diffStat: 1,
            recentCommit: 1,
            branch: 1,
            gitUpdatedAt: 1,
            updatedAt: 1,
          },
        },
      )
      .sort({ gitUpdatedAt: -1 })
      .limit(limit)
      .toArray(),
    db
      .collection<Collision>('collisions')
      .find({ podId }, { projection: { _id: 0 } })
      .sort({ detectedAt: -1 })
      .limit(limit)
      .toArray(),
    db
      .collection<Intervention>('interventions')
      .find({ podId }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray(),
    db
      .collection<InterventionOutcome>('outcomes')
      .find({ podId }, { projection: { _id: 0 } })
      .sort({ recordedAt: -1 })
      .limit(limit)
      .toArray(),
  ]);

  return [
    ...observations.map(observationEvent),
    ...gitStates.map(gitEvent),
    ...collisions.map(collisionEvent),
    ...interventions.map(interventionEvent),
    ...outcomes.map(outcomeEvent),
  ]
    .filter((event) => event.at !== new Date(0).toISOString())
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
}
