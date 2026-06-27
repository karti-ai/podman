import type { Collision, SuggestedActionKind } from '@podman/shared';

/**
 * Policy gate: decides whether PodMan should intervene.
 * Stub: always intervene on warn/critical.
 */
export function shouldIntervene(
  collision: Collision,
  _prior: unknown,
): boolean {
  return collision.severity !== 'info';
}

/**
 * Preferred action selection based on collision + prior history.
 * Stub: open sync PR for critical, ping teammate otherwise.
 */
export function preferredAction(
  collision: Collision,
  _prior: unknown,
): SuggestedActionKind {
  return collision.severity === 'critical' ? 'open_sync_pr' : 'ping_teammate';
}
