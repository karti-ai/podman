import { Room, RoomEvent } from 'livekit-client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787';

/** Token + LiveKit URL minted by the backend. */
export async function fetchPodToken(
  podId: string,
  identity: string,
  name: string,
): Promise<{ token: string; url: string }> {
  const res = await fetch(`${BACKEND_URL}/api/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ room: podId, identity, name }),
  });
  if (!res.ok) throw new Error(`token request failed: ${res.status}`);
  return res.json();
}

/** True once a real LiveKit server is configured (not the placeholder). */
export function isLiveKitConfigured(url: string | undefined): boolean {
  return !!url && !url.includes('REPLACE_ME');
}

export type JoinResult = { mode: 'live'; room: Room } | { mode: 'dev'; room: null };

/**
 * Join a pod = connect to the LiveKit room. Returns as soon as the room is
 * connected — screen sharing is a separate, deliberate action (see PodView) so
 * a denied/slow screen prompt never blocks or fails the join.
 */
export async function joinPod(podId: string, identity: string, name: string): Promise<JoinResult> {
  const { token, url } = await fetchPodToken(podId, identity, name);

  if (!isLiveKitConfigured(url)) {
    console.warn('[podman] LiveKit not configured — dev mock join');
    return { mode: 'dev', room: null };
  }

  const room = new Room({ adaptiveStream: true, dynacast: true });
  room.on(RoomEvent.Disconnected, () => console.log('[podman] disconnected'));
  await room.connect(url, token);
  // Allow remote audio to play (autoplay policy) — we're inside the join gesture.
  await room.startAudio().catch(() => {});
  return { mode: 'live', room };
}
