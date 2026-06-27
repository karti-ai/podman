import { MongoClient, type Db, type Collection } from 'mongodb';
import type { EngineerContext, Collision, Intervention, InterventionOutcome } from '@podman/shared';
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
  observations: Collection<EngineerContext>;
  collisions: Collection<Collision>;
  interventions: Collection<Intervention>;
  outcomes: Collection<InterventionOutcome>;
}

export async function collections(): Promise<PodCollections> {
  const db = await getDb();
  return {
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
  await Promise.all([
    c.observations.createIndex({ podId: 1, observedAt: -1 }),
    c.observations.createIndex({ engineerId: 1 }),
    c.collisions.createIndex({ podId: 1, detectedAt: -1 }),
    c.interventions.createIndex({ collisionId: 1 }),
    c.outcomes.createIndex({ interventionId: 1 }),
  ]);
  console.log(`[memory] mongo connected -> ${db.databaseName}`);
}
