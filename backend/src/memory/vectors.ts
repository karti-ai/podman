import type { Collision, Intervention, InterventionOutcome } from '@podman/shared';
import { env } from '../env.js';
import { getDb } from './db.js';

type StoredCollision = Collision & {
  memorySignature?: string;
  memoryText?: string;
  embedding?: number[];
  embeddingProvider?: string;
};

export type RecalledCollision = Collision & {
  priorIntervention?: Intervention;
  priorOutcome?: InterventionOutcome;
};

interface VoyageEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

interface GeminiEmbeddingResponse {
  embedding?: { values?: number[] };
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function signature(collision: Collision): string {
  return [
    normalize(collision.file),
    normalize(collision.symbol),
    [...collision.engineers].sort().map(normalize).join('+'),
    'collision',
  ]
    .filter(Boolean)
    .join('#');
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

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    aNorm += av * av;
    bNorm += bv * bv;
  }
  if (!aNorm || !bNorm) return -1;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

async function embed(text: string, inputType: 'document' | 'query'): Promise<number[] | null> {
  return (await embedWithVoyage(text, inputType)) ?? embedWithGemini(text, inputType);
}

export async function semanticSimilarity(a: string, b: string): Promise<number | null> {
  const [va, vb] = await Promise.all([embed(a, 'query'), embed(b, 'document')]);
  if (!va || !vb) return null;
  return cosine(va, vb);
}

async function embedWithVoyage(
  text: string,
  inputType: 'document' | 'query',
): Promise<number[] | null> {
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

async function embedWithGemini(
  text: string,
  inputType: 'document' | 'query',
): Promise<number[] | null> {
  try {
    const taskType = inputType === 'document' ? 'RETRIEVAL_DOCUMENT' : 'RETRIEVAL_QUERY';
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        env.GEMINI_EMBEDDING_MODEL,
      )}:embedContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: 768,
        }),
      },
    );
    if (!res.ok) {
      console.warn(`[memory] gemini embedding failed: ${res.status} ${await res.text()}`);
      return null;
    }
    const body = (await res.json()) as GeminiEmbeddingResponse;
    return body.embedding?.values ?? null;
  } catch (err) {
    console.warn(`[memory] gemini embedding failed: ${(err as Error).message}`);
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
    ...(embedding
      ? { embedding, embeddingProvider: env.VOYAGE_API_KEY ? 'voyage' : 'gemini' }
      : {}),
  };
}

async function attachOutcome(match: StoredCollision): Promise<RecalledCollision> {
  const db = await getDb();
  const intervention = await db
    .collection<Intervention>('interventions')
    .findOne({ collisionId: match.id }, { sort: { createdAt: -1 }, projection: { _id: 0 } });
  const outcome = intervention
    ? await db
        .collection<InterventionOutcome>('outcomes')
        .findOne(
          { interventionId: intervention.id },
          { sort: { recordedAt: -1 }, projection: { _id: 0 } },
        )
    : null;
  const {
    memorySignature: _memorySignature,
    memoryText: _memoryText,
    embedding: _embedding,
    embeddingProvider: _embeddingProvider,
    ...collision
  } = match;
  return {
    ...collision,
    ...(intervention ? { priorIntervention: intervention } : {}),
    ...(outcome ? { priorOutcome: outcome } : {}),
  };
}

async function recallByVector(collision: Collision): Promise<RecalledCollision | null> {
  const queryVector = await embed(memoryText(collision), 'query');
  if (!queryVector) return null;

  const db = await getDb();
  try {
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
    return match ? attachOutcome(match) : null;
  } catch (err) {
    console.warn(`[memory] atlas vector recall unavailable: ${(err as Error).message}`);
  }

  const candidates = await db
    .collection<StoredCollision>('collisions')
    .find(
      {
        podId: collision.podId,
        id: { $ne: collision.id },
        embedding: { $exists: true },
      },
      { projection: { _id: 0 }, limit: 100 },
    )
    .toArray();
  let best: { match: StoredCollision; score: number } | null = null;
  for (const candidate of candidates) {
    if (!candidate.embedding?.length) continue;
    const score = cosine(queryVector, candidate.embedding);
    if (!best || score > best.score) best = { match: candidate, score };
  }
  return best && best.score > 0.5 ? attachOutcome(best.match) : null;
}

async function recallBySignature(collision: Collision): Promise<RecalledCollision | null> {
  const db = await getDb();
  const sig = signature(collision);
  const matches = await db
    .collection<StoredCollision>('collisions')
    .find(
      {
        podId: collision.podId,
        id: { $ne: collision.id },
        $or: [{ memorySignature: sig }, { file: collision.file }],
      },
      { sort: { detectedAt: -1 }, projection: { _id: 0, embedding: 0 }, limit: 10 },
    )
    .toArray();

  let fallback: RecalledCollision | null = null;
  for (const match of matches) {
    const recalled = await attachOutcome(match);
    if (!fallback) fallback = recalled;
    if (recalled.priorOutcome?.accepted && recalled.priorOutcome.wasRealCollision) {
      return recalled;
    }
  }
  return fallback;
}

/**
 * Recall prior collision patterns. Atlas Vector Search is preferred when
 * available; standalone MongoDB falls back to app-side cosine search over
 * stored embeddings, then exact signature/file matching.
 */
export async function recallSimilar(collision: Collision): Promise<RecalledCollision | null> {
  return (await recallByVector(collision)) ?? recallBySignature(collision);
}
