import { Room, RoomEvent } from 'livekit-client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787';

/** Ask the backend for a LiveKit token to join a pod. */
export async function fetchPodToken(
  podId: string,
  identity: string,
  name: string,
): Promise<{ token: string; url: string }> {
  const res = await fetch(`${BACKEND_URL}/pods/${encodeURIComponent(podId)}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity, name }),
  });
  if (!res.ok) throw new Error(`token request failed: ${res.status}`);
  return res.json();
}

/**
 * Join a pod: connect to the LiveKit room and publish screen + mic so PodMan
 * can watch. Returns the connected Room.
 */
export async function joinPod(podId: string, identity: string, name: string): Promise<Room> {
  const { token, url } = await fetchPodToken(podId, identity, name);
  const room = new Room({ adaptiveStream: true, dynacast: true });
  room.on(RoomEvent.Disconnected, () => console.log('[podman] disconnected'));

  await room.connect(url, token);

  const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
  for (const track of screen.getTracks()) {
    await room.localParticipant.publishTrack(track);
  }
  await room.localParticipant.setMicrophoneEnabled(true);

  return room;
}
