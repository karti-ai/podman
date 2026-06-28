import type {
  EngineerContext,
  Collision,
  Intervention,
  InterventionOutcome,
  InterventionStatus,
} from '@podman/shared';
import { collections } from './db.js';
import { enrichCollisionMemory } from './vectors.js';

function comparableFile(raw?: string): string {
  return (raw ?? '')
    .trim()
    .replace(/^(\?\?|[MADRCU!]{1,2})\s+/, '')
    .split(/[\\/]/)
    .pop()
    ?.toLowerCase() ?? '';
}

/**
 * Continual-learning memory: persist observations, collisions, interventions,
 * and outcomes to MongoDB so later sessions get sharper. MongoDB is mandatory —
 * a failed write is surfaced loudly and rethrown, never silently swallowed, so
 * a broken memory layer can never masquerade as a working one.
 */
async function persist(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[memory] ${name} persist FAILED: ${(err as Error).message}`);
    throw err;
  }
}

export async function recordObservation(ctx: EngineerContext): Promise<void> {
  await persist('observation', async () =>
    (await collections()).observations.insertOne({ ...ctx }),
  );
}

export async function recordCollision(collision: Collision): Promise<void> {
  await persist('collision', async () =>
    (await collections()).collisions.insertOne(await enrichCollisionMemory(collision)),
  );
}

export async function recordIntervention(intervention: Intervention): Promise<void> {
  await persist('intervention', async () =>
    (await collections()).interventions.insertOne({ ...intervention }),
  );
}

export async function hasRecentInterventionForCollision(
  collision: Collision,
  windowMs = Number(process.env.NUDGE_COOLDOWN_MS ?? '180000'),
): Promise<boolean> {
  if (windowMs <= 0) return false;
  const c = await collections();
  const since = new Date(Date.now() - windowMs).toISOString();
  const recent = await c.collisions
    .find({ podId: collision.podId, detectedAt: { $gte: since } })
    .sort({ detectedAt: -1 })
    .limit(100)
    .toArray();

  const targetFile = comparableFile(collision.file);
  for (const match of recent) {
    if (match.id === collision.id || comparableFile(match.file) !== targetFile) continue;
    const existing = await c.interventions.findOne({
      collisionId: match.id,
      createdAt: { $gte: since },
    });
    if (existing) return true;
  }
  return false;
}

export async function updateInterventionStatus(
  interventionId: string,
  status: InterventionStatus,
): Promise<void> {
  await persist('intervention ack', async () =>
    (await collections()).interventions.updateOne({ id: interventionId }, { $set: { status } }),
  );
}

export async function recordOutcome(outcome: InterventionOutcome): Promise<void> {
  await persist('outcome', async () => {
    const c = await collections();
    await c.outcomes.insertOne({ ...outcome });
    await c.interventions.updateOne(
      { id: outcome.interventionId },
      { $set: { status: outcome.accepted ? 'accepted' : 'dismissed' } },
    );
  });
}

/** Document counts per collection — used by the /api/memory/stats endpoint. */
export async function memoryStats(): Promise<Record<string, number>> {
  const c = await collections();
  const [observations, collisions, interventions, outcomes] = await Promise.all([
    c.observations.estimatedDocumentCount(),
    c.collisions.estimatedDocumentCount(),
    c.interventions.estimatedDocumentCount(),
    c.outcomes.estimatedDocumentCount(),
  ]);
  return { observations, collisions, interventions, outcomes };
}
