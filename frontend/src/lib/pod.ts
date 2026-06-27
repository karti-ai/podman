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
 * Join a pod. When LiveKit is configured we connect for real and publish
 * screen + mic. Otherwise we fall back to a dev mock join so the post-join UI
 * is developable without LiveKit creds / HTTPS.
 */
export async function joinPod(podId: string, identity: string, name: string): Promise<JoinResult> {
  const { token, url } = await fetchPodToken(podId, identity, name);

  if (!isLiveKitConfigured(url)) {
    console.warn('[podman] LiveKit not configured — dev mock join (no screen capture)');
    return { mode: 'dev', room: null };
  }

  const room = new Room({ adaptiveStream: true, dynacast: true });
  room.on(RoomEvent.Disconnected, () => console.log('[podman] disconnected'));
  await room.connect(url, token);

  // Screen capture needs a secure context (HTTPS or localhost). Guard so a
  // non-secure origin doesn't hard-crash the join.
  if (window.isSecureContext && navigator.mediaDevices?.getDisplayMedia) {
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
    for (const track of screen.getTracks()) {
      await room.localParticipant.publishTrack(track);
    }
    await room.localParticipant.setMicrophoneEnabled(true);
  } else {
    console.warn('[podman] insecure context — screen capture skipped (needs HTTPS)');
  }

  return { mode: 'live', room };
}
