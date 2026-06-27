import {
  Room,
  RoomEvent,
  TrackKind,
  TrackSource,
  VideoStream,
  VideoBufferType,
  dispose,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from '@livekit/rtc-node';
import sharp from 'sharp';
import { AccessToken } from 'livekit-server-sdk';
import { env } from './env.js';
import { PodMan } from './agent/podman.js';

const POD_ROOM = process.env.POD_ROOM ?? 'demo-pod';
const SAMPLE_INTERVAL_MS = 1000; // ~1 fps to the vision model

async function agentToken(room: string): Promise<string> {
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: 'podman-agent',
    name: 'PodMan',
    ttl: '4h',
  });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
  return at.toJwt();
}

async function main() {
  const room = new Room();
  const podman = new PodMan(room, POD_ROOM);
  await room.connect(env.LIVEKIT_URL, await agentToken(POD_ROOM), {
    autoSubscribe: true,
    dynacast: true,
  });
  await podman.start();
  console.log(`[agent] PodMan joined room ${POD_ROOM}`);

  const lastSent = new Map<string, number>();

  room.on(
    RoomEvent.TrackSubscribed,
    (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind !== TrackKind.KIND_VIDEO || pub.source !== TrackSource.SOURCE_SCREENSHARE) return;
      const id = participant.identity;
      const stream = new VideoStream(track);
      void (async () => {
        for await (const event of stream) {
          const now = Date.now();
          if (now - (lastSent.get(id) ?? 0) < SAMPLE_INTERVAL_MS) continue; // THROTTLE
          lastSent.set(id, now);
          const rgba = event.frame.convert(VideoBufferType.RGBA);
          const jpeg = await sharp(Buffer.from(rgba.data), {
            raw: { width: rgba.width, height: rgba.height, channels: 4 },
          })
            .resize({ width: 1280, withoutEnlargement: true })
            .jpeg({ quality: 70 })
            .toBuffer();
          await podman.onScreenFrame(id, jpeg);
        }
      })();
    },
  );

  const shutdown = async () => {
    await room.disconnect();
    await dispose();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[agent] fatal', e);
  process.exit(1);
});
