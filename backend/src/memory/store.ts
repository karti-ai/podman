import type { EngineerContext, Collision, Intervention, InterventionOutcome } from '@podman/shared';
import { collections } from './db.js';

/**
 * Continual-learning memory: persist observations, collisions, interventions,
 * and outcomes to MongoDB so later sessions get sharper. Writes are best-effort
 * — a Mongo hiccup logs a warning rather than crashing the agent/server.
 */
async function persist(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.warn(`[memory] ${name} persist failed: ${(err as Error).message}`);
  }
}

export async function recordObservation(ctx: EngineerContext): Promise<void> {
  await persist('observation', async () =>
    (await collections()).observations.insertOne({ ...ctx }),
  );
}

export async function recordCollision(collision: Collision): Promise<void> {
  await persist('collision', async () =>
    (await collections()).collisions.insertOne({ ...collision }),
  );
}

export async function recordIntervention(intervention: Intervention): Promise<void> {
  await persist('intervention', async () =>
    (await collections()).interventions.insertOne({ ...intervention }),
  );
}

export async function recordOutcome(outcome: InterventionOutcome): Promise<void> {
  await persist('outcome', async () => (await collections()).outcomes.insertOne({ ...outcome }));
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
