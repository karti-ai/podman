import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent, type Room } from 'livekit-client';
import { DATA_TOPIC, type DataMessage } from '@podman/shared';
import { startBeat, startMusic, type BeatHandle } from '../lib/beat.js';

/** Name of the test-audio track; its presence in the room IS the shared state. */
export const BEAT_TRACK = 'podman-beat';

export interface BeatState {
  /** Is the test audio playing anywhere in the pod? */
  on: boolean;
  /** Display name of the participant who started it (the owner). */
  by: string | null;
  /** Do I own the beat track (so I can stop it directly)? */
  mine: boolean;
}

const OFF: BeatState = { on: false, by: null, mine: false };

/**
 * Shared, pod-wide test audio. One participant publishes the `podman-beat`
 * track; everyone hears it and sees the same on/off state, derived directly
 * from the track's presence (self-syncing across joins/leaves). Any participant
 * can stop it: non-owners send BEAT_STOP and the owner unpublishes.
 */
export function useBeat(room: Room | null, musicUrl?: string) {
  const [beat, setBeat] = useState<BeatState>(OFF);
  const beatRef = useRef<BeatHandle | null>(null);

  const stopLocal = useCallback(async () => {
    const handle = beatRef.current;
    if (!handle) return;
    beatRef.current = null;
    try {
      await room?.localParticipant.unpublishTrack(handle.track);
    } finally {
      handle.stop();
    }
  }, [room]);

  // Derive the shared state from the podman-beat track across all participants.
  useEffect(() => {
    if (!room) {
      setBeat(OFF);
      return;
    }
    const recompute = () => {
      const lp = room.localParticipant;
      const localPub = [...lp.trackPublications.values()].find((p) => p.trackName === BEAT_TRACK);
      if (localPub) {
        setBeat({ on: true, by: lp.name || lp.identity, mine: true });
        return;
      }
      for (const p of room.remoteParticipants.values()) {
        const pub = [...p.trackPublications.values()].find((tp) => tp.trackName === BEAT_TRACK);
        if (pub) {
          setBeat({ on: true, by: p.name || p.identity, mine: false });
          return;
        }
      }
      setBeat(OFF);
    };

    recompute();
    const events = [
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
    ] as const;
    events.forEach((e) => room.on(e, recompute));
    return () => {
      events.forEach((e) => room.off(e, recompute));
    };
  }, [room]);

  // The owner honors stop requests from any participant.
  useEffect(() => {
    if (!room) return;
    const onData = (payload: Uint8Array, _p: unknown, _k: unknown, topic?: string) => {
      if (topic !== DATA_TOPIC) return;
      let msg: DataMessage;
      try {
        msg = JSON.parse(new TextDecoder().decode(payload)) as DataMessage;
      } catch {
        return;
      }
      if (msg.type === 'BEAT_STOP') void stopLocal();
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, stopLocal]);

  // Tear down my own track on unmount (e.g. leaving the pod).
  const stopLocalRef = useRef(stopLocal);
  stopLocalRef.current = stopLocal;
  const startingRef = useRef(false);
  const unmountedRef = useRef(false);
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      void stopLocalRef.current();
    };
  }, []);

  const toggleBeat = useCallback(async () => {
    if (!room) return;
    // `beatRef` is the synchronous source of truth for "do I own it" — `beat.mine`
    // lags behind the LiveKit track events that recompute it, so gate on the ref.
    if (beatRef.current) {
      await stopLocal();
      return;
    }
    if (beat.on) {
      // Someone else owns it — can't unpublish their track, so ask them to stop.
      await room.startAudio().catch(() => {});
      await room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ type: 'BEAT_STOP' } satisfies DataMessage)),
        { reliable: true, topic: DATA_TOPIC },
      );
      return;
    }
    // Start it. Guard against rapid double-clicks publishing two tracks before the
    // LocalTrackPublished event has had a chance to update state.
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      await room.startAudio().catch(() => {}); // unlock playback from this gesture
      if (unmountedRef.current) return;
      const handle = musicUrl ? await startMusic(musicUrl) : startBeat();
      beatRef.current = handle;
      await room.localParticipant.publishTrack(handle.track, { name: BEAT_TRACK });
      if (unmountedRef.current) await stopLocal(); // left mid-publish — clean up
    } catch (e) {
      beatRef.current?.stop();
      beatRef.current = null;
      throw e;
    } finally {
      startingRef.current = false;
    }
  }, [room, beat, stopLocal, musicUrl]);

  return { beat, toggleBeat };
}
