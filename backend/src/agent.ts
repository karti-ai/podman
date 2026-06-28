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
const SCREEN_THUMBNAIL_WIDTH = 360;
const SHUTDOWN_GRACE_MS = 5000;

async function agentToken(room: string): Promise<string> {
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: HERMES_IDENTITY,
    name: 'PodMan',
    ttl: '4h',
  });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
  return at.toJwt();
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  const inFlight = new Set<string>();
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
    if (inFlight.has(engineerId)) return;
    lastSent.set(engineerId, now);
    inFlight.add(engineerId);

    try {
      const rgba = event.frame.convert(VideoBufferType.RGBA);
      const pixels = Buffer.from(rgba.data);
      const raw = { width: rgba.width, height: rgba.height, channels: 4 } as const;
      const [jpeg, thumbnail] = await Promise.all([
        sharp(pixels, { raw })
          .resize({ width: 1280, withoutEnlargement: true })
          .jpeg({ quality: 70 })
          .toBuffer(),
        sharp(pixels, { raw })
          .resize({ width: SCREEN_THUMBNAIL_WIDTH, withoutEnlargement: true })
          .jpeg({ quality: 42 })
          .toBuffer(),
      ]);
      await podman.onScreenFrame(
        engineerId,
        jpeg,
        `data:image/jpeg;base64,${thumbnail.toString('base64')}`,
      );
    } finally {
      inFlight.delete(engineerId);
    }
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
            void processFrame(id, value).catch((err) =>
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

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await withTimeout(
      Promise.all([...activeStreams.keys()].map(stopStream)).then(() => room.disconnect()),
      SHUTDOWN_GRACE_MS,
    );
    await withTimeout(dispose(), SHUTDOWN_GRACE_MS);
    process.exit(0);
  };
  room.on(RoomEvent.Disconnected, () => {
    if (!shuttingDown) {
      console.error('[agent] LiveKit disconnected; exiting so systemd restarts the worker');
      process.exit(1);
    }
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[agent] fatal', e);
  process.exit(1);
});
