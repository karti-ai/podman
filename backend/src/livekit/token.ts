import { AccessToken } from 'livekit-server-sdk';
import { env } from '../env.js';

/**
 * Mint a LiveKit access token so an engineer's browser can join a pod room
 * and publish screen + mic + cam tracks.
 */
export async function createPodToken(
  podId: string,
  identity: string,
  name?: string,
): Promise<string> {
  const at = new AccessToken(env.livekit.apiKey, env.livekit.apiSecret, {
    identity,
    name,
  });
  at.addGrant({
    room: podId,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return at.toJwt();
}
