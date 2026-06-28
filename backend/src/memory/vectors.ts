import type { Collision } from '@podman/shared';
import { env } from '../env.js';
import { getDb } from './db.js';

type StoredCollision = Collision & {
  memorySignature?: string;
  memoryText?: string;
  embedding?: number[];
};

interface VoyageEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function signature(collision: Collision): string {
  return [normalize(collision.file), normalize(collision.symbol)].filter(Boolean).join('#');
}

function memoryText(collision: Collision): string {
  return [
    `file: ${collision.file}`,
    collision.symbol ? `symbol: ${collision.symbol}` : undefined,
    `engineers: ${collision.engineers.join(', ')}`,
    `severity: ${collision.severity}`,
    collision.githubState?.unpushed ? 'unpushed local changes present' : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

async function embed(text: string, inputType: 'document' | 'query'): Promise<number[] | null> {
  if (!env.VOYAGE_API_KEY) return null;
  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: text,
        model: env.VOYAGE_EMBEDDING_MODEL,
        input_type: inputType,
      }),
    });
    if (!res.ok) {
      console.warn(`[memory] voyage embedding failed: ${res.status} ${await res.text()}`);
      return null;
    }
    const body = (await res.json()) as VoyageEmbeddingResponse;
    return body.data?.[0]?.embedding ?? null;
  } catch (err) {
    console.warn(`[memory] voyage embedding failed: ${(err as Error).message}`);
    return null;
  }
}

export async function enrichCollisionMemory(collision: Collision): Promise<StoredCollision> {
  const text = memoryText(collision);
  const embedding = await embed(text, 'document');
  return {
    ...collision,
    memorySignature: signature(collision),
    memoryText: text,
    ...(embedding ? { embedding } : {}),
  };
}

async function recallByVector(collision: Collision): Promise<Collision | null> {
  const queryVector = await embed(memoryText(collision), 'query');
  if (!queryVector) return null;

  try {
    const db = await getDb();
    const [match] = await db
      .collection<StoredCollision>('collisions')
      .aggregate<StoredCollision>([
        {
          $vectorSearch: {
            index: 'collision_embedding',
            path: 'embedding',
            queryVector,
            numCandidates: 50,
            limit: 5,
            filter: { podId: collision.podId },
          },
        },
        { $match: { id: { $ne: collision.id } } },
        { $project: { _id: 0, embedding: 0 } },
      ])
      .toArray();
    return match ?? null;
  } catch (err) {
    console.warn(`[memory] vector recall unavailable: ${(err as Error).message}`);
    return null;
  }
}

async function recallBySignature(collision: Collision): Promise<Collision | null> {
  const db = await getDb();
  const sig = signature(collision);
  const match = await db.collection<StoredCollision>('collisions').findOne(
    {
      podId: collision.podId,
      id: { $ne: collision.id },
      $or: [{ memorySignature: sig }, { file: collision.file }],
    },
    { sort: { detectedAt: -1 }, projection: { _id: 0, embedding: 0 } },
  );
  return match ?? null;
}

/**
 * Recall prior collision patterns. Exact Mongo recall is always available;
 * Voyage + Atlas Vector Search is used first when configured.
 */
export async function recallSimilar(collision: Collision): Promise<Collision | null> {
  return (await recallByVector(collision)) ?? recallBySignature(collision);
}
