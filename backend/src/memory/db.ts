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

export async function closeMemory(): Promise<void> {
  if (!clientPromise) return;
  const client = await clientPromise;
  clientPromise = null;
  await client.close();
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

export interface GitState {
  changedFiles: string[];
  branch: string | null;
  recentCommit: string | null;
  gitUpdatedAt: Date | null;
}

const GIT_STATE_TTL_MS = Number(process.env.GIT_STATE_TTL_MS ?? '120000');

/** Fetch latest git state per engineer for a pod from the engineer_states collection.
 *  Returns a map keyed by engineer name (matches --name arg used in podman-agent.mjs). */
export async function getGitStates(podId: string): Promise<Map<string, GitState>> {
  const db = await getDb();
  const col = db.collection<{
    _id: string;
    name: string;
    changedFiles?: string[];
    branch?: string | null;
    recentCommit?: string | null;
    gitUpdatedAt?: Date;
  }>('engineer_states');
  const docs = await col.find({ podId }).toArray();
  const map = new Map<string, GitState>();
  const now = Date.now();
  for (const doc of docs) {
    const updatedAt = doc.gitUpdatedAt ? new Date(doc.gitUpdatedAt) : null;
    if (
      updatedAt &&
      !Number.isNaN(updatedAt.getTime()) &&
      GIT_STATE_TTL_MS > 0 &&
      now - updatedAt.getTime() > GIT_STATE_TTL_MS
    ) {
      continue;
    }
    map.set(doc.name, {
      changedFiles: doc.changedFiles ?? [],
      branch: doc.branch ?? null,
      recentCommit: doc.recentCommit ?? null,
      gitUpdatedAt: doc.gitUpdatedAt ?? null,
    });
  }
  return map;
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
    [
      'collisions.memorySignature',
      () => c.collisions.createIndex({ podId: 1, memorySignature: 1 }),
    ],
    ['collisions.file', () => c.collisions.createIndex({ podId: 1, file: 1, detectedAt: -1 })],
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
