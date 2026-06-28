import type { Collision, SuggestedActionKind } from '@podman/shared';
import type { RecalledCollision } from './vectors.js';

const lastNudgeByPod = new Map<string, number>();

function cooldownMs(): number {
  return Number(process.env.NUDGE_COOLDOWN_MS ?? '180000');
}

/** Policy gate: combines severity, exact recall outcomes, and per-pod cooldown. */
export function shouldIntervene(collision: Collision, prior: RecalledCollision | null): boolean {
  if (collision.severity === 'info') return false;

  const priorOutcome = prior?.priorOutcome;
  // Suppress when the identical prior was dismissed (accepted === false). The
  // former `&& !priorOutcome.wasRealCollision` term was dead code: outcomes are
  // recorded with wasRealCollision hardcoded true, so the gate never fired and
  // the 85 real dismissals in Atlas were ignored. Dismissals are the negative
  // signal per continual-learning/policy.md:41 + spec.md:163. (RSI Step 1)
  if (priorOutcome && !priorOutcome.accepted) return false;

  const cooldown = cooldownMs();
  const last = lastNudgeByPod.get(collision.podId) ?? 0;
  if (cooldown > 0 && Date.now() - last < cooldown) {
    return false;
  }

  lastNudgeByPod.set(collision.podId, Date.now());
  return true;
}

/** Preferred action selection based on collision severity and prior accepted actions. */
export function preferredAction(
  collision: Collision,
  prior: RecalledCollision | null,
): SuggestedActionKind {
  const acceptedKind = prior?.priorOutcome?.accepted
    ? prior.priorIntervention?.suggestedAction.kind
    : undefined;
  if (acceptedKind && acceptedKind !== 'none') return acceptedKind;
  return collision.severity === 'critical' ? 'open_sync_pr' : 'ping_teammate';
}
