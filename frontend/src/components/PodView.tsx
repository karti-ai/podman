import { useEffect, useRef, useState } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import type { Room, RemoteTrack, RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import type { Pod } from '@podman/shared';
import { Avatar } from './Avatar.js';
import { startBeat, type BeatHandle } from '../lib/beat.js';

interface PInfo {
  id: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
}

function snapshot(room: Room, fallbackName: string): PInfo[] {
  const lp = room.localParticipant;
  const local: PInfo = {
    id: lp.identity,
    name: lp.name || fallbackName,
    isLocal: true,
    speaking: lp.isSpeaking,
  };
  const remotes = Array.from(room.remoteParticipants.values()).map((p) => ({
    id: p.identity,
    name: p.name || p.identity,
    isLocal: false,
    speaking: p.isSpeaking,
  }));
  return [local, ...remotes];
}

export function PodView({
  team,
  me,
  room,
  devMode,
  onLeave,
}: {
  team: Pod;
  me: string;
  room: Room | null;
  devMode: boolean;
  onLeave: () => void;
}) {
  const [participants, setParticipants] = useState<PInfo[]>([]);
  const [sharing, setSharing] = useState(false);
  const [playingBeat, setPlayingBeat] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const audioRef = useRef<HTMLDivElement>(null);
  const beatRef = useRef<BeatHandle | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);

  // Subscribe to live room state: participants, active speakers, remote audio.
  useEffect(() => {
    if (!room) return;
    const refresh = () => setParticipants(snapshot(room, me));
    refresh();

    const onAudio = (track: RemoteTrack, _pub: RemoteTrackPublication, _p: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio && audioRef.current) {
        audioRef.current.appendChild(track.attach());
      }
    };
    const onAudioGone = (track: RemoteTrack) => track.detach().forEach((el) => el.remove());

    room
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.TrackSubscribed, onAudio)
      .on(RoomEvent.TrackUnsubscribed, onAudioGone);

    return () => {
      room
        .off(RoomEvent.ParticipantConnected, refresh)
        .off(RoomEvent.ParticipantDisconnected, refresh)
        .off(RoomEvent.ActiveSpeakersChanged, refresh)
        .off(RoomEvent.TrackSubscribed, onAudio)
        .off(RoomEvent.TrackUnsubscribed, onAudioGone);
    };
  }, [room, me]);

  // Stop the beat if we leave/unmount.
  useEffect(() => {
    return () => {
      beatRef.current?.stop();
      beatRef.current = null;
    };
  }, []);

  async function toggleBeat() {
    if (!room) return;
    setNote(null);
    try {
      if (playingBeat) {
        if (beatRef.current) await room.localParticipant.unpublishTrack(beatRef.current.track);
        beatRef.current?.stop();
        beatRef.current = null;
        setPlayingBeat(false);
      } else {
        await room.startAudio().catch(() => {});
        const handle = startBeat();
        beatRef.current = handle;
        await room.localParticipant.publishTrack(handle.track, { name: 'podman-beat' });
        setPlayingBeat(true);
      }
    } catch (e) {
      setNote(`beat failed: ${(e as Error).message}`);
    }
  }

  async function toggleScreen() {
    if (!room) return;
    setNote(null);
    try {
      if (sharing) {
        if (screenTrackRef.current)
          await room.localParticipant.unpublishTrack(screenTrackRef.current);
        screenTrackRef.current?.stop();
        screenTrackRef.current = null;
        setSharing(false);
        return;
      }
      if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
        setNote('screen capture needs HTTPS (secure context)');
        return;
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      track.onended = () => {
        screenTrackRef.current = null;
        setSharing(false);
      };
      await room.localParticipant.publishTrack(track, { source: Track.Source.ScreenShare });
      screenTrackRef.current = track;
      setSharing(true);
    } catch (e) {
      setNote(`screen share cancelled: ${(e as Error).message}`);
    }
  }

  const liveCount = participants.length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100">{team.name}</h2>
          <p className="text-xs text-slate-500">{team.repo}</p>
        </div>
        <button
          onClick={onLeave}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Leave
        </button>
      </header>

      {devMode && (
        <p className="rounded-md border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
          DEV MODE — LiveKit not configured, so this is a local-only mock (no real room).
        </p>
      )}

      {/* Connectivity test controls */}
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <button
          onClick={toggleBeat}
          disabled={!room}
          className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${
            playingBeat ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'
          }`}
        >
          {playingBeat ? '⏹ Stop beat' : '▶ Play beat'}
        </button>
        <button
          onClick={toggleScreen}
          disabled={!room}
          className="rounded-md border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
        >
          {sharing ? '🛑 Stop sharing' : '📺 Share my screen'}
        </button>
        <span className="ml-auto text-xs text-slate-400">
          {playingBeat
            ? '🔊 broadcasting beat to the pod'
            : 'press “Play beat” — everyone should hear it'}
        </span>
      </section>
      {note && <p className="text-sm text-amber-400">{note}</p>}

      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        {/* Live participants */}
        <section>
          <h3 className="mb-3 text-sm font-medium text-slate-400">In the room now ({liveCount})</h3>
          {liveCount === 0 ? (
            <p className="text-sm text-slate-500">Connecting…</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {participants.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 rounded-lg border p-3 transition ${
                    p.speaking
                      ? 'border-emerald-400 bg-emerald-950/30 ring-1 ring-emerald-400/50'
                      : 'border-slate-800 bg-slate-900/40'
                  }`}
                >
                  <Avatar name={p.name} size={36} ring={p.isLocal} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-200">{p.name}</p>
                    <p className="text-xs text-slate-500">
                      {p.isLocal ? 'you' : 'connected'}
                      {p.speaking ? ' · 🔊' : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-slate-600">
            Pod roster: {team.members.join(', ') || '—'}
          </p>
        </section>

        {/* PodMan panel */}
        <aside className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">🛰️</span>
            <h3 className="font-semibold text-slate-100">PodMan</h3>
            <span className="ml-auto flex items-center gap-1 text-xs text-emerald-400">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" /> watching
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {liveCount} participant{liveCount === 1 ? '' : 's'} connected. Watching for collisions
            before push.
          </p>
          <div className="mt-4 border-t border-slate-800 pt-4">
            <h4 className="mb-2 text-xs font-medium text-slate-400">Interventions</h4>
            <div className="rounded-lg border border-dashed border-slate-800 px-3 py-6 text-center text-xs text-slate-600">
              No collisions detected.
            </div>
          </div>
        </aside>
      </div>

      {/* hidden sink for remote audio elements */}
      <div ref={audioRef} className="hidden" />
    </div>
  );
}
