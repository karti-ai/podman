import { useCallback, useRef, useState } from 'react';
import { Room, Track, createLocalScreenTracks, VideoPresets } from 'livekit-client';
import { fetchToken } from '../lib/api';

export function useScreenPublish() {
  const roomRef = useRef<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [sharing, setSharing] = useState(false);

  const join = useCallback(async (pod: string, identity: string, name: string, githubLogin?: string) => {
    const { token, url } = await fetchToken({ room: pod, identity, name, githubLogin });
    const room = new Room({ adaptiveStream: true, dynacast: true });
    await room.connect(url, token);
    roomRef.current = room;
    setConnected(true);
    return room;
  }, []);

  const startSharing = useCallback(async () => {
    const room = roomRef.current;
    if (!room) throw new Error('join the pod first');
    const tracks = await createLocalScreenTracks({
      audio: true,
      resolution: VideoPresets.h1080.resolution,
    });
    for (const t of tracks) {
      await room.localParticipant.publishTrack(t.mediaStreamTrack, {
        source:
          t.kind === Track.Kind.Audio ? Track.Source.ScreenShareAudio : Track.Source.ScreenShare,
      });
    }
    await room.localParticipant.setMicrophoneEnabled(true);
    await room.localParticipant.setCameraEnabled(true);
    setSharing(true);
  }, []);

  return { join, startSharing, connected, sharing, room: roomRef };
}
