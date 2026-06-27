import { MongoClient, type Db, type Collection } from 'mongodb';
import type {
  EngineerContext,
  Collision,
  Intervention,
  InterventionOutcome,
  Pod,
} from '@podman/shared';
import { env } from '../env.js';

let clientPromise: Promise<MongoClient> | null = null;

function getClient(): Promise<MongoClient> {
  if (!clientPromise) {
    const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    clientPromise = client.connect();
  }
  return clientPromise;
}

/** The PodMan database (name comes from the MONGODB_URI path, e.g. `podman`). */
export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db();
}

export interface PodCollections {
  pods: Collection<Pod>;
  observations: Collection<EngineerContext>;
  collisions: Collection<Collision>;
  interventions: Collection<Intervention>;
  outcomes: Collection<InterventionOutcome>;
}

export async function collections(): Promise<PodCollections> {
  const db = await getDb();
  return {
    pods: db.collection<Pod>('pods'),
    observations: db.collection<EngineerContext>('observations'),
    collisions: db.collection<Collision>('collisions'),
    interventions: db.collection<Intervention>('interventions'),
    outcomes: db.collection<InterventionOutcome>('outcomes'),
  };
}

/** Connect, verify reachability, and create helpful indexes. Call once on startup. */
export async function initMemory(): Promise<void> {
  const db = await getDb();
  await db.command({ ping: 1 });
  const c = await collections();
  // Create each index independently so one failure (e.g. the unique pods index
  // failing on pre-existing duplicate ids) doesn't abort the others or block
  // seeding. Failures are logged loudly rather than silently swallowed.
  const indexes: Array<[string, () => Promise<unknown>]> = [
    ['pods.id (unique)', () => c.pods.createIndex({ id: 1 }, { unique: true })],
    ['observations.podId', () => c.observations.createIndex({ podId: 1, observedAt: -1 })],
    ['observations.engineerId', () => c.observations.createIndex({ engineerId: 1 })],
    ['collisions.podId', () => c.collisions.createIndex({ podId: 1, detectedAt: -1 })],
    ['interventions.collisionId', () => c.interventions.createIndex({ collisionId: 1 })],
    ['outcomes.interventionId', () => c.outcomes.createIndex({ interventionId: 1 })],
  ];
  for (const [name, make] of indexes) {
    try {
      await make();
    } catch (err) {
      console.error(`[memory] index "${name}" failed: ${(err as Error).message}`);
    }
  }
  console.log(`[memory] mongo connected -> ${db.databaseName}`);
}
