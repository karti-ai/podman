import type { EngineerContext } from '@podman/shared';

/**
 * Turn a sampled screen frame into a structured EngineerContext using Gemini
 * vision. This is the headline capability: it produces the pre-push signal
 * (which file/symbol an engineer is editing) that GitHub cannot see.
 *
 * TODO(vision): wire @google/genai, downscale frames, sample ~1fps/on-change.
 */
export async function frameToContext(
  _frame: Uint8Array,
  meta: { engineerId: string; podId: string },
): Promise<EngineerContext> {
  return {
    engineerId: meta.engineerId,
    podId: meta.podId,
    confidence: 0,
    observedAt: new Date().toISOString(),
  };
}
