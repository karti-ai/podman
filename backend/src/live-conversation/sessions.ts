import { randomUUID } from 'node:crypto';
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';
import { Room as LiveKitRoom } from '@livekit/rtc-node';
import type { Collision, DataMessage, Intervention, LiveConversationEvent } from '@podman/shared';
import { DATA_TOPIC } from '@podman/shared';
import { env } from '../env.js';
import { closeRoom } from '../livekit/rooms.js';
import { speakInRoom } from '../voice/live.js';

const encoder = new TextEncoder();
const DEFAULT_AGENT = 'podman-live-conversation';

export interface LiveConversationSession {
  sessionId: string;
  podId: string;
  identity: string;
  displayName: string;
  room: string;
  url: string;
  startedAt: string;
  lastEventAt?: string;
  endedAt?: string;
}

const sessions = new Map<string, LiveConversationSession>();

function sessionKey(podId: string, identity: string): string {
  return `${podId}:${identity.toLowerCase()}`;
}

function cleanPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function agentName(): string {
  return env.LIVEKIT_CONVERSATION_AGENT_NAME || DEFAULT_AGENT;
}

function tokenFor(room: string, identity: string, name: string, metadata: object): Promise<string> {
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity,
    name,
    ttl: '4h',
    metadata: JSON.stringify(metadata),
  });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
  return at.toJwt();
}

export async function startLiveConversation(input: {
  podId: string;
  identity: string;
  displayName?: string;
}): Promise<LiveConversationSession & { token: string }> {
  const identity = input.identity.trim();
  if (!identity) throw new Error('identity is required');

  const existing = activeLiveConversation(input.podId, identity);
  if (existing) {
    return {
      ...existing,
      token: await tokenFor(existing.room, identity, existing.displayName, {
        podId: input.podId,
        identity,
        sessionId: existing.sessionId,
        mode: 'podman-live-conversation',
      }),
    };
  }

  const sessionId = randomUUID();
  const room = `podman-live:${cleanPart(input.podId)}:${cleanPart(identity)}:${sessionId.slice(0, 8)}`;
  const displayName = input.displayName?.trim() || identity;
  const metadata = { podId: input.podId, identity, sessionId, mode: 'podman-live-conversation' };
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity,
    name: displayName,
    ttl: '4h',
    metadata: JSON.stringify(metadata),
  });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
  at.roomConfig = new RoomConfiguration({
    name: room,
    emptyTimeout: 60,
    departureTimeout: 15,
    agents: [
      new RoomAgentDispatch({
        agentName: agentName(),
        metadata: JSON.stringify(metadata),
      }),
    ],
  });

  const session: LiveConversationSession = {
    sessionId,
    podId: input.podId,
    identity,
    displayName,
    room,
    url: env.LIVEKIT_URL,
    startedAt: new Date().toISOString(),
  };
  sessions.set(sessionKey(input.podId, identity), session);
  return { ...session, token: await at.toJwt() };
}

export function activeLiveConversation(
  podId: string,
  identity: string,
): LiveConversationSession | null {
  const session = sessions.get(sessionKey(podId, identity));
  return session && !session.endedAt ? session : null;
}

export function listActiveLiveConversations(podId: string): LiveConversationSession[] {
  return [...sessions.values()].filter((session) => session.podId === podId && !session.endedAt);
}

export async function stopLiveConversation(
  podId: string,
  sessionId: string,
): Promise<LiveConversationSession | null> {
  const session = [...sessions.values()].find(
    (candidate) => candidate.podId === podId && candidate.sessionId === sessionId,
  );
  if (!session) return null;
  session.endedAt = new Date().toISOString();
  await closeRoom(session.room);
  return session;
}

async function publishPrivateConversationEvent(
  roomName: string,
  event: LiveConversationEvent,
): Promise<void> {
  const room = new LiveKitRoom();
  try {
    const token = await tokenFor(roomName, `podman-live-router-${Date.now()}`, 'PodMan live router', {
      mode: 'podman-live-router',
    });
    await room.connect(env.LIVEKIT_URL, token, { autoSubscribe: false, dynacast: false });
    const data: DataMessage = { type: 'LIVE_CONVERSATION_EVENT', event };
    await room.localParticipant?.publishData(encoder.encode(JSON.stringify(data)), {
      reliable: true,
      topic: DATA_TOPIC,
    });
  } finally {
    await room.disconnect().catch(() => {});
  }
}

export async function notifyCriticalLiveConversations(
  collision: Collision,
  intervention: Intervention,
  voiceLine?: string,
): Promise<void> {
  if (collision.severity !== 'critical') return;
  const recipients = new Set(collision.engineers.map((name) => name.toLowerCase()));
  const active = listActiveLiveConversations(collision.podId).filter((session) =>
    recipients.has(session.identity.toLowerCase()),
  );
  if (active.length === 0) return;

  await Promise.allSettled(
    active.map(async (session) => {
      const createdAt = new Date().toISOString();
      session.lastEventAt = createdAt;
      const summary =
        voiceLine ||
        `Critical collision in ${collision.file}. ${collision.engineers.join(
          ' and ',
        )} should sync before pushing.`;
      await publishPrivateConversationEvent(session.room, {
        id: `live_evt_${Date.now()}_${session.sessionId.slice(0, 8)}`,
        podId: collision.podId,
        sessionId: session.sessionId,
        kind: 'critical_collision',
        severity: 'critical',
        summary,
        interrupt: true,
        createdAt,
        collisionId: collision.id,
        interventionId: intervention.id,
      });
      await speakInRoom(session.room, summary, { priority: 'critical' });
    }),
  );
}
