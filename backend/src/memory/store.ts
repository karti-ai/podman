import type { EngineerContext, Collision, Intervention } from '@podman/shared';
import type { InterventionOutcome } from '@podman/shared';

/**
 * Continual-learning memory: persist observations + intervention outcomes to
 * MongoDB Atlas and embed file/feature notes into Voyage vectors so later
 * sessions are sharper ("more useful the more you use it").
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

// Standalone helpers used by the PodMan orchestrator and HTTP server.
const _observations: EngineerContext[] = [];
const _collisions: Collision[] = [];
const _interventions: Intervention[] = [];
const _outcomes: InterventionOutcome[] = [];

export async function recordObservation(ctx: EngineerContext): Promise<void> {
  _observations.push(ctx);
}

export async function recordCollision(collision: Collision): Promise<void> {
  _collisions.push(collision);
}

export async function recordIntervention(intervention: Intervention): Promise<void> {
  _interventions.push(intervention);
}

export async function recordOutcome(outcome: InterventionOutcome): Promise<void> {
  _outcomes.push(outcome);
}
