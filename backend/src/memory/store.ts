import type { EngineerContext, Intervention } from '@podman/shared';

/**
 * Continual-learning memory: persist observations + intervention outcomes to
 * MongoDB Atlas and embed file/feature notes into Voyage vectors so later
 * sessions are sharper ("more useful the more you use it").
 *
 * TODO(memory): connect Atlas, store observations, record outcomes, embed via
 * Voyage, and expose retrieval for the PodMan brain.
 */
export interface PodMemory {
  recordObservation(ctx: EngineerContext): Promise<void>;
  recordOutcome(intervention: Intervention, accepted: boolean): Promise<void>;
}

/** In-memory stub so the rest of the pipeline can run before Atlas is wired. */
export function createInMemoryStore(): PodMemory {
  const observations: EngineerContext[] = [];
  return {
    async recordObservation(ctx) {
      observations.push(ctx);
    },
    async recordOutcome() {
      /* no-op until Atlas is wired */
    },
  };
}
