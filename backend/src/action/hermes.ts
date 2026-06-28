import type { Room } from '@livekit/rtc-node';
import type { Collision, DataMessage, HermesMessage, Intervention } from '@podman/shared';
import { DATA_TOPIC } from '@podman/shared';

const encoder = new TextEncoder();

function teammateText(collision: Collision, intervention: Intervention): string {
  return `${collision.engineers.join(', ')}: ${intervention.message}`;
}

export function createHermesMessage(
  collision: Collision,
  intervention: Intervention,
): HermesMessage {
  return {
    id: `hermes_${Date.now()}`,
    podId: collision.podId,
    interventionId: intervention.id,
    recipients: collision.engineers,
    text: teammateText(collision, intervention),
    urgency: collision.severity === 'critical' ? 'urgent' : 'normal',
    createdAt: new Date().toISOString(),
  };
}

export async function publishHermesMessage(
  room: Room,
  collision: Collision,
  intervention: Intervention,
): Promise<void> {
  const data: DataMessage = {
    type: 'HERMES_MESSAGE',
    message: createHermesMessage(collision, intervention),
  };
  await room.localParticipant?.publishData(encoder.encode(JSON.stringify(data)), {
    reliable: true,
    topic: DATA_TOPIC,
  });
}
