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
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

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
    // Room closed out from under us (e.g. the pod was deleted) → back to the list.
    const onDisconnected = () => onLeaveRef.current();

    room
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.TrackSubscribed, onAudio)
      .on(RoomEvent.TrackUnsubscribed, onAudioGone)
      .on(RoomEvent.Disconnected, onDisconnected);

    return () => {
      room
        .off(RoomEvent.ParticipantConnected, refresh)
        .off(RoomEvent.ParticipantDisconnected, refresh)
        .off(RoomEvent.ActiveSpeakersChanged, refresh)
        .off(RoomEvent.TrackSubscribed, onAudio)
        .off(RoomEvent.TrackUnsubscribed, onAudioGone)
        .off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room, me]);

  // Stop the beat and any active screen capture on leave/unmount.
  useEffect(() => {
    return () => {
      beatRef.current?.stop();
      beatRef.current = null;
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
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
  const podmanPresent = participants.some((p) => p.name.toLowerCase() === 'podman');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold text-slate-950">{team.name}</h2>
            <span
              className={`rounded-full px-2 py-1 text-xs font-medium ${
                room
                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                  : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
              }`}
            >
              {room ? 'live room' : 'local'}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{team.repo}</p>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            Presence, media controls, and intervention state for this pod.
          </p>
        </div>
        <button
          onClick={onLeave}
          className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Leave
        </button>
      </header>

      {devMode && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Dev mode: LiveKit is not configured, so this is a local-only mock.
        </p>
      )}

      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <p className="text-xs font-medium text-slate-500">Broadcast controls</p>
          <p className="mt-1 text-sm text-slate-600">Audio, screen, and room signal.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={toggleBeat}
            disabled={!room}
            className={`rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
              playingBeat
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-emerald-600 text-white hover:bg-emerald-500'
            }`}
          >
            {playingBeat ? 'Stop beat' : 'Play beat'}
          </button>
          <button
            onClick={toggleScreen}
            disabled={!room}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {sharing ? 'Stop sharing' : 'Share screen'}
          </button>
        </div>
      </section>
      {note && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {note}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <RoomMetric label="Participants" value={liveCount} />
        <RoomMetric label="Screen share" value={sharing ? 'on' : 'off'} />
        <RoomMetric label="Audio test" value={playingBeat ? 'on' : 'idle'} />
        <RoomMetric label="PodMan" value={podmanPresent ? 'online' : 'waiting'} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-950">Room presence</h3>
              <p className="text-sm text-slate-500">Live participants and speaking state.</p>
            </div>
            <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200">
              {liveCount} connected
            </span>
          </div>
          {liveCount === 0 ? (
            <p className="text-sm text-slate-500">Connecting...</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {participants.map((p) => (
                <div
                  key={p.id}
                  className={`flex min-h-20 items-center gap-3 rounded-lg border p-3 transition ${
                    p.speaking
                      ? 'border-emerald-200 bg-emerald-50 ring-1 ring-emerald-100'
                      : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <Avatar name={p.name} size={38} ring={p.isLocal} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-950">{p.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {p.isLocal ? 'you' : 'connected'}
                      {p.speaking ? ' - speaking' : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-4 text-xs leading-5 text-slate-600">
            Pod roster: {team.members.join(', ') || '-'}
          </p>
        </section>

        <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-500">Intervention rail</p>
              <h3 className="mt-1 text-base font-semibold text-slate-950">PodMan</h3>
            </div>
            <span
              className={`rounded-full px-2 py-1 text-xs font-medium ${
                podmanPresent
                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                  : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'
              }`}
            >
              {podmanPresent ? 'watching' : 'waiting'}
            </span>
          </div>

          <div className="mt-5 space-y-3">
            <InterventionCard
              state="ready"
              title="Live inference"
              text={
                sharing ? 'Screen frames available to the agent.' : 'Waiting for screen signal.'
              }
            />
            <InterventionCard
              state="quiet"
              title="Collision detector"
              text="No same-file collision has been detected in this room."
            />
            <InterventionCard
              state="quiet"
              title="Escalation policy"
              text="Cards first; voice only when urgency crosses the threshold."
            />
          </div>
        </aside>
      </div>

      <div ref={audioRef} className="hidden" />
    </div>
  );
}

function RoomMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function InterventionCard({
  state,
  title,
  text,
}: {
  state: 'ready' | 'quiet';
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-950">{title}</p>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${
            state === 'ready'
              ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
              : 'bg-white text-slate-500 ring-1 ring-slate-200'
          }`}
        >
          {state}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{text}</p>
    </div>
  );
}
