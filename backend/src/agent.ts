import {
  Room,
  RoomEvent,
  TrackKind,
  TrackSource,
  VideoStream,
  VideoBufferType,
  dispose,
  type VideoFrameEvent,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from '@livekit/rtc-node';
import sharp from 'sharp';
import { AccessToken } from 'livekit-server-sdk';
import { env } from './env.js';
import { PodMan } from './agent/podman.js';
import { initMemory } from './memory/db.js';

const POD_ROOM = process.env.POD_ROOM ?? 'demo-pod';
const HERMES_IDENTITY = 'podman-hermes';
const SAMPLE_INTERVAL_MS = 1000; // ~1 fps to the vision model

async function agentToken(room: string): Promise<string> {
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: HERMES_IDENTITY,
    name: 'PodMan',
    ttl: '4h',
  });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
  return at.toJwt();
}

async function main() {
  // MongoDB is mandatory. Verify the connection before joining the room so bad
  // creds / unreachable Atlas fail loudly at boot, not silently mid-demo.
  await initMemory();

  const room = new Room();
  const podman = new PodMan(room, POD_ROOM);
  await room.connect(env.LIVEKIT_URL, await agentToken(POD_ROOM), {
    autoSubscribe: true,
    dynacast: true,
  });
  await podman.start();
  console.log(`[agent] ${HERMES_IDENTITY} joined room ${POD_ROOM}`);

  const lastSent = new Map<string, number>();
  const activeStreams = new Map<string, ReadableStreamDefaultReader<VideoFrameEvent>>();

  const streamKey = (
    track: RemoteTrack,
    pub: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => `${participant.identity}:${pub.sid ?? track.sid ?? 'screen'}`;

  const stopStream = async (key: string) => {
    const reader = activeStreams.get(key);
    if (!reader) return;
    activeStreams.delete(key);
    await reader.cancel().catch(() => {});
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  };

  const processFrame = async (engineerId: string, event: VideoFrameEvent) => {
    const now = Date.now();
    if (now - (lastSent.get(engineerId) ?? 0) < SAMPLE_INTERVAL_MS) return;
    lastSent.set(engineerId, now);

    const rgba = event.frame.convert(VideoBufferType.RGBA);
    const jpeg = await sharp(Buffer.from(rgba.data), {
      raw: { width: rgba.width, height: rgba.height, channels: 4 },
    })
      .resize({ width: 1280, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    await podman.onScreenFrame(engineerId, jpeg);
  };

  room.on(
    RoomEvent.TrackSubscribed,
    (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind !== TrackKind.KIND_VIDEO || pub.source !== TrackSource.SOURCE_SCREENSHARE)
        return;
      const id = participant.identity;
      const key = streamKey(track, pub, participant);
      const stream = new VideoStream(track);
      void stopStream(key);
      const reader = stream.getReader();
      activeStreams.set(key, reader);
      void (async () => {
        try {
          while (activeStreams.get(key) === reader) {
            const { done, value } = await reader.read();
            if (done) break;
            await processFrame(id, value).catch((err) =>
              console.error(`[agent] frame sample failed for ${id}: ${(err as Error).message}`),
            );
          }
        } catch (err) {
          console.error(`[agent] screen stream failed for ${id}: ${(err as Error).message}`);
        } finally {
          if (activeStreams.get(key) === reader) activeStreams.delete(key);
          await reader.cancel().catch(() => {});
          try {
            reader.releaseLock();
          } catch {
            /* already released */
          }
        }
      })();
    },
  );

  room.on(
    RoomEvent.TrackUnsubscribed,
    (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      void stopStream(streamKey(track, pub, participant));
    },
  );

  room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
    for (const key of [...activeStreams.keys()]) {
      if (key.startsWith(`${participant.identity}:`)) void stopStream(key);
    }
  });

  const shutdown = async () => {
    await Promise.all([...activeStreams.keys()].map(stopStream));
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
