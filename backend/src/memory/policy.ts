import type { Collision, SuggestedActionKind } from '@podman/shared';
import type { RecalledCollision } from './vectors.js';

/**
 * Policy gate — suppression fully disabled for the demo.
 *
 * Every real collision surfaces an intervention. Accept/Dismiss are still
 * recorded as outcomes but carry NO gating meaning: dismissing one collision
 * never silences future ones, and there is no per-pod cooldown throttling
 * consecutive conflicts. The only filter is severity: `info` collisions are
 * informational, not actionable, so they don't nudge. The same-collision
 * single-shot dedupe lives in `PodmanAgent.handle` (activeConflicts), so
 * removing the cooldown does not cause repeat spam of an unresolved collision.
 *
 * (Prior dismissal-based suppression over-generalized: one README discard
 * permanently muted all README clashes via loose file/vector recall.)
 */
export function shouldIntervene(collision: Collision, _prior: RecalledCollision | null): boolean {
  return collision.severity !== 'info';
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
