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
  if (priorOutcome && !priorOutcome.accepted && !priorOutcome.wasRealCollision) return false;

  const cooldown = cooldownMs();
  const last = lastNudgeByPod.get(collision.podId) ?? 0;
  if (cooldown > 0 && Date.now() - last < cooldown && collision.severity !== 'critical') {
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
