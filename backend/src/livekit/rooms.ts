import { RoomServiceClient } from 'livekit-server-sdk';
import { env } from '../env.js';

function isConfigured(): boolean {
  return !!env.LIVEKIT_URL && !env.LIVEKIT_URL.includes('REPLACE_ME');
}

let client: RoomServiceClient | null = null;
function svc(): RoomServiceClient {
  if (!client) {
    const httpUrl = env.LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    client = new RoomServiceClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  }
  return client;
}

/**
 * Close a pod's LiveKit room, disconnecting everyone. Best-effort: a missing/
 * already-empty room is fine. Called when a pod is deleted.
 */
export async function closeRoom(podId: string): Promise<void> {
  if (!isConfigured()) return;
  try {
    await svc().deleteRoom(podId);
  } catch (e) {
    console.warn(`[livekit] closeRoom ${podId} failed: ${(e as Error).message}`);
  }
}

/**
 * Who is currently connected in each pod's LiveKit room, as display names,
 * keyed by pod id (= room name). Empty rooms are omitted. Returns {} if
 * LiveKit isn't configured or the API call fails (presence is best-effort).
 */
export async function getPresence(): Promise<Record<string, string[]>> {
  if (!isConfigured()) return {};
  const out: Record<string, string[]> = {};
  const rooms = await svc().listRooms();
  await Promise.all(
    rooms
      .filter((r) => r.numParticipants > 0)
      .map(async (r) => {
        try {
          const ps = await svc().listParticipants(r.name);
          out[r.name] = ps.map((p) => p.name || p.identity);
        } catch {
          out[r.name] = [];
        }
      }),
  );
  return out;
}
