import type { Collision } from '@podman/shared';

/**
 * Vector-based recall of prior collision patterns (Loop A).
 * Stub: returns null until Voyage + Atlas Vector Search are wired.
 */
export async function recallSimilar(_collision: Collision): Promise<Collision | null> {
  // TODO(memory): embed collision.file via Voyage, query Atlas vector index
  return null;
}
