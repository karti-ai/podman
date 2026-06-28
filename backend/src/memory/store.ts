import type {
  EngineerContext,
  Collision,
  Intervention,
  InterventionOutcome,
  InterventionStatus,
} from '@podman/shared';
import { collections, getDb, getGitStates, type UserPodContextDoc } from './db.js';
import { enrichCollisionMemory } from './vectors.js';
import { buildUserLearningProfile } from './user-learning.js';

function comparableFile(raw?: string): string {
  return (
    (raw ?? '')
      .trim()
      .replace(/^(\?\?|[MADRCU!]{1,2})\s+/, '')
      .split(/[\\/]/)
      .pop()
      ?.toLowerCase() ?? ''
  );
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

export async function recordUserPodContext(input: {
  clerkUserId: string;
  podId: string;
  memberName?: string;
  action: string;
  metadata?: UserPodContextDoc['metadata'];
}): Promise<void> {
  await persist('user pod context', async () =>
    (await getDb()).collection<UserPodContextDoc>('user_pod_context').insertOne({
      id: `upc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      clerkUserId: input.clerkUserId,
      podId: input.podId,
      memberName: input.memberName,
      action: input.action,
      source: 'clerk',
      observedAt: new Date().toISOString(),
      metadata: input.metadata,
    }),
  );
  void buildUserLearningProfile(input.clerkUserId).catch((err) =>
    console.warn(`[memory] user learning refresh failed: ${(err as Error).message}`),
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

/**
 * Feature A — record that PodMan stayed quiet on a recurring collision because
 * its signature was previously dismissed. Timestamped at the repeat (now), so
 * the negative-feedback beat surfaces as recent `suppressed` activity rather
 * than being re-synthesized from the old dismissal row.
 */
export async function recordSuppression(
  collision: Collision,
  priorInterventionId?: string,
  priorDismissedAt?: string,
): Promise<void> {
  await persist('suppression', async () =>
    (await collections()).suppressions.insertOne({
      id: `supp_${Date.now()}`,
      podId: collision.podId,
      collisionId: collision.id,
      file: collision.file,
      engineers: collision.engineers,
      priorInterventionId,
      priorDismissedAt,
      suppressedAt: new Date().toISOString(),
    }),
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

/**
 * Step 3 — derive whether a flagged collision was REAL from git ground truth,
 * instead of trusting the client (which historically hardcoded `true`). A
 * collision counts as real only if BOTH named engineers currently have the
 * collided file in their git `changedFiles`. Conservative: returns false when
 * the collision is orphaned/missing or git state is stale/unavailable.
 * Verifier supervision per docs/continual-learning/spec.md:98-108, policy.md:35-42.
 */
export async function deriveWasRealCollision(outcome: InterventionOutcome): Promise<boolean> {
  try {
    const c = await collections();
    const collision = await c.collisions.findOne({ id: outcome.collisionId });
    if (!collision) return false;
    // Prefer the overlap evidence captured at detection time (fresh git state):
    // immune to late clicks, stale sidecars, and the engineer_states TTL.
    if (typeof collision.gitOverlap === 'boolean') return collision.gitOverlap;
    // Fallback for collisions detected before gitOverlap was captured: re-derive
    // from latest git state, matching engineers on case/whitespace-canonical names.
    if (!Array.isArray(collision.engineers) || collision.engineers.length < 2) return false;
    const target = comparableFile(collision.file);
    if (!target) return false;
    const byCanon = new Map<string, string[]>();
    for (const [name, st] of await getGitStates(outcome.podId)) {
      byCanon.set(name.trim().toLowerCase(), st.changedFiles);
    }
    return collision.engineers.every((e) =>
      (byCanon.get(e.trim().toLowerCase()) ?? []).some((f) => comparableFile(f) === target),
    );
  } catch (err) {
    console.error(`[memory] wasRealCollision verifier failed: ${(err as Error).message}`);
    return false;
  }
}

export async function recordOutcome(outcome: InterventionOutcome): Promise<void> {
  // Backend is authoritative for wasRealCollision: derive it from git overlap
  // rather than trusting the client-supplied value. (RSI Step 3)
  const verified: InterventionOutcome = {
    ...outcome,
    wasRealCollision: await deriveWasRealCollision(outcome),
  };
  await persist('outcome', async () => {
    const c = await collections();
    await c.outcomes.insertOne({ ...verified });
    await c.interventions.updateOne(
      { id: verified.interventionId },
      { $set: { status: verified.accepted ? 'accepted' : 'dismissed' } },
    );
  });
}

/** Document counts per collection — used by the /api/memory/stats endpoint. */
export async function memoryStats(): Promise<Record<string, number>> {
  const c = await collections();
  const db = await getDb();
  const [
    observations,
    collisions,
    interventions,
    outcomes,
    suppressions,
    userPodContext,
    userLearningProfiles,
  ] = await Promise.all([
    c.observations.estimatedDocumentCount(),
    c.collisions.estimatedDocumentCount(),
    c.interventions.estimatedDocumentCount(),
    c.outcomes.estimatedDocumentCount(),
    c.suppressions.estimatedDocumentCount(),
    db.collection<UserPodContextDoc>('user_pod_context').estimatedDocumentCount(),
    db.collection('user_learning_profiles').estimatedDocumentCount(),
  ]);
  return {
    observations,
    collisions,
    interventions,
    outcomes,
    suppressions,
    userPodContext,
    userLearningProfiles,
  };
}
