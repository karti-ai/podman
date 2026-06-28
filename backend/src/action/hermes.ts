import type { Room } from '@livekit/rtc-node';
import { Room as LiveKitRoom } from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import type { Collision, DataMessage, HermesMessage, Intervention } from '@podman/shared';
import { DATA_TOPIC } from '@podman/shared';
import { env } from '../env.js';
import { speak } from '../voice/live.js';

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

export async function publishHermesIntervention(
  room: Room,
  collision: Collision,
  intervention: Intervention,
  voiceLine?: string,
): Promise<void> {
  const data: DataMessage = { type: 'COLLISION', collision, intervention };
  await room.localParticipant?.publishData(encoder.encode(JSON.stringify(data)), {
    reliable: true,
    topic: DATA_TOPIC,
  });
  await publishHermesMessage(room, collision, intervention);
  if (voiceLine) await speak(room, voiceLine);
}

async function hermesToken(roomName: string): Promise<string> {
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: `podman-hermes-${Date.now()}`,
    name: 'PodMan Hermes',
    ttl: '10m',
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return at.toJwt();
}

export async function notifyHermesInterventionInRoom(
  roomName: string,
  collision: Collision,
  intervention: Intervention,
  voiceLine?: string,
): Promise<void> {
  const room = new LiveKitRoom();
  try {
    await room.connect(env.LIVEKIT_URL, await hermesToken(roomName), {
      autoSubscribe: false,
      dynacast: false,
    });
    await publishHermesIntervention(room, collision, intervention, voiceLine);
  } finally {
    await room.disconnect().catch(() => {});
  }
}
