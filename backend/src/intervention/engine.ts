import type { Collision, Intervention } from '@podman/shared';

/**
 * Compose PodMan's intervention for a collision — the message it speaks and the
 * action it offers (e.g. "open a sync PR"). Severity drives voice vs card.
 *
 * TODO(brain): use Gemini to phrase the message naturally from the team model;
 * tune thresholds from outcomes (the continual-learning policy).
 */
export function composeIntervention(
  collision: Collision,
  now: string = new Date().toISOString(),
): Intervention {
  const kind = collision.severity === 'critical' ? 'voice' : 'card';
  return {
    id: `intervention:${collision.id}`,
    collisionId: collision.id,
    podId: collision.podId,
    kind,
    message: `Heads up — ${collision.engineers.join(' and ')} are both in ${collision.file}.`,
    suggestedAction: {
      kind: collision.severity === 'critical' ? 'open_sync_pr' : 'ping_teammate',
    },
    status: 'pending',
    createdAt: now,
  };
}
