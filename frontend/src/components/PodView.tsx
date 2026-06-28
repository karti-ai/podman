import { useEffect, useRef, useState } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleDotIcon,
  GitBranchIcon,
  ExternalLinkIcon,
  FileTextIcon,
  MessageSquareIcon,
  MonitorUpIcon,
  RadioTowerIcon,
  SparklesIcon,
  TriangleAlertIcon,
  Volume2Icon,
  XIcon,
} from 'lucide-react';
import type { Room, RemoteTrack, RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import type { Pod, PodActivityEvent, PodActivityKind } from '@podman/shared';
import { startBeat, type BeatHandle } from '../lib/beat.js';
import { useInterventions } from '../livekit/useInterventions.js';
import { usePodActivity } from '../hooks/use-pod-activity.js';
import LiveWaveform from '@/components/ruixen/live-waveform';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarBadge, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

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
  const { active, hermes, voiceCue, actionUrl, respond } = useInterventions(room);
  const activity = usePodActivity(team.id, me);

  const audioRef = useRef<HTMLDivElement>(null);
  const beatRef = useRef<BeatHandle | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

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
      setNote(`Audio test failed: ${(e as Error).message}`);
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
        setNote('Screen capture needs HTTPS.');
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
      setNote(`Screen share stopped: ${(e as Error).message}`);
    }
  }

  async function answerIntervention(status: 'accepted' | 'dismissed', accepted: boolean) {
    setNote(null);
    try {
      await respond(status, accepted);
    } catch (e) {
      setNote(`Action failed: ${(e as Error).message}`);
    }
  }

  const podmanPresent = participants.some((p) => p.name.toLowerCase() === 'podman');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <header className="sticky top-0 z-10 -mx-4 flex flex-col gap-3 border-b bg-background/86 px-4 pb-4 pt-2 backdrop-blur-xl sm:-mx-6 sm:px-6 md:flex-row md:items-center md:justify-between lg:-mx-8 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onLeave}>
                  <ArrowLeftIcon />
                  <span className="sr-only">Leave pod</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Leave pod</TooltipContent>
            </Tooltip>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight">{team.name}</h1>
                <Badge variant={room ? 'default' : 'secondary'} className="rounded-md">
                  {room ? 'live' : 'local'}
                </Badge>
              </div>
              <p className="truncate font-mono text-xs text-muted-foreground">{team.repo}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <Button variant="outline" onClick={toggleBeat} disabled={!room}>
              <Volume2Icon data-icon="inline-start" />
              {playingBeat ? 'Stop audio' : 'Test audio'}
            </Button>
            <Button onClick={toggleScreen} disabled={!room}>
              <MonitorUpIcon data-icon="inline-start" />
              {sharing ? 'Stop sharing' : 'Share screen'}
            </Button>
          </div>
        </header>

        {devMode && (
          <Alert>
            <RadioTowerIcon />
            <AlertTitle>Local mode</AlertTitle>
            <AlertDescription>LiveKit is not configured for this session.</AlertDescription>
          </Alert>
        )}

        {note && (
          <Alert>
            <CircleDotIcon />
            <AlertTitle>Room notice</AlertTitle>
            <AlertDescription>{note}</AlertDescription>
          </Alert>
        )}

        <main className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="flex min-w-0 flex-col gap-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Participants" value={participants.length || 1} />
              <Metric label="Screen" value={sharing ? 'sharing' : 'idle'} />
              <Metric label="PodMan" value={podmanPresent ? 'online' : 'waiting'} />
            </div>

            <Card className="flex-1">
              <CardHeader>
                <CardTitle>Room state</CardTitle>
                <CardDescription>People and media currently visible to PodMan.</CardDescription>
              </CardHeader>
              <CardContent>
                {participants.length === 0 ? (
                  <Empty className="min-h-80">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <RadioTowerIcon />
                      </EmptyMedia>
                      <EmptyTitle>Connecting</EmptyTitle>
                      <EmptyDescription>Waiting for LiveKit room state.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {participants.map((p) => (
                      <Participant key={p.id} participant={p} />
                    ))}
                  </div>
                )}
              </CardContent>
              <CardFooter>
                <p className="truncate text-sm text-muted-foreground">
                  Roster: {team.members.join(', ') || 'No saved members'}
                </p>
              </CardFooter>
            </Card>

            <section className="grid min-h-[420px] gap-5 xl:grid-cols-2">
              <ActivityStream
                title="My stream"
                description={`${me}'s live screen, git, intervention, and conflict log.`}
                events={activity.mine}
                connected={activity.connected}
                emptyTitle="No personal signal yet"
                emptyDescription="Start the local git watcher or share your IDE screen to populate this lane."
              />
              <ActivityStream
                title="Team stream"
                description="Everyone else in this pod, merged into one realtime feed."
                events={activity.team}
                connected={activity.connected}
                emptyTitle="No teammate signal yet"
                emptyDescription="Waiting for other members' screen, git, or collision events."
              />
            </section>
            {activity.error && <p className="text-xs text-muted-foreground">{activity.error}</p>}
          </section>

          <aside className="flex flex-col gap-5">
            <Card>
              <CardHeader>
                <CardTitle>Intervention</CardTitle>
                <CardDescription>Card first, voice only for urgent escalation.</CardDescription>
                <CardAction>
                  <Badge variant={active ? 'default' : 'secondary'} className="rounded-md">
                    {active ? 'active' : 'clear'}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                {active ? (
                  <div className="flex flex-col gap-4">
                    <div className="rounded-lg border bg-muted/35 p-3">
                      <p className="text-sm leading-6">{active.message}</p>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">Suggested action</span>
                      <Badge variant="outline">
                        {active.suggestedAction.kind.replaceAll('_', ' ')}
                      </Badge>
                    </div>
                    {hermes?.interventionId === active.id && (
                      <div className="rounded-lg border border-dashed p-3">
                        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <MessageSquareIcon className="size-3.5" />
                          Hermes message
                        </div>
                        <p className="text-sm leading-6">{hermes.text}</p>
                      </div>
                    )}
                    {voiceCue && (
                      <div className="rounded-lg border border-dashed p-3">
                        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <Volume2Icon className="size-3.5" />
                          Voice cue
                        </div>
                        <p className="text-sm leading-6">{voiceCue}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <Empty className="min-h-72 border-0 p-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <SparklesIcon />
                      </EmptyMedia>
                      <EmptyTitle>No collision detected</EmptyTitle>
                      <EmptyDescription>
                        Share your screen when ready. PodMan will stay quiet until there is a useful
                        signal.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
                {actionUrl && (
                  <a
                    href={actionUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm font-medium hover:bg-muted"
                  >
                    Sync PR artifact opened
                    <ExternalLinkIcon className="size-4" />
                  </a>
                )}
              </CardContent>
              {active && (
                <CardFooter className="justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void answerIntervention('dismissed', false)}
                  >
                    <XIcon data-icon="inline-start" />
                    Dismiss
                  </Button>
                  <Button onClick={() => void answerIntervention('accepted', true)}>
                    <CheckIcon data-icon="inline-start" />
                    Accept
                  </Button>
                </CardFooter>
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
                <CardDescription>Connection, media, and agent presence.</CardDescription>
              </CardHeader>
              <CardContent>
                <LiveWaveform
                  processing={!!room}
                  active={false}
                  height={32}
                  barWidth={2}
                  barGap={3}
                  className="mb-4 px-3 py-2 text-muted-foreground"
                />
                <div className="flex flex-col gap-3">
                  <StatusLine label="LiveKit" value={room ? 'connected' : 'offline'} />
                  <StatusLine label="Screen" value={sharing ? 'published' : 'not shared'} />
                  <StatusLine label="Audio" value={playingBeat ? 'publishing' : 'ready'} />
                  <StatusLine label="Agent" value={podmanPresent ? 'watching' : 'waiting'} />
                </div>
              </CardContent>
            </Card>
          </aside>
        </main>
        <div ref={audioRef} className="hidden" />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-medium">{value}</p>
      </CardContent>
    </Card>
  );
}

function Participant({ participant }: { participant: PInfo }) {
  return (
    <div
      className={cn(
        'flex min-h-16 items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 transition',
        participant.speaking && 'bg-muted',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Avatar>
          <AvatarFallback>{initials(participant.name)}</AvatarFallback>
          {participant.speaking && <AvatarBadge />}
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{participant.name}</p>
          <p className="text-xs text-muted-foreground">{participant.isLocal ? 'you' : 'remote'}</p>
        </div>
      </div>
      <Badge variant={participant.speaking ? 'default' : 'secondary'} className="rounded-md">
        {participant.speaking ? 'speaking' : 'connected'}
      </Badge>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-medium">{value}</span>
      </div>
      <Separator />
    </>
  );
}

function ActivityStream({
  title,
  description,
  events,
  connected,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  description: string;
  events: PodActivityEvent[];
  connected: boolean;
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <Card className="min-h-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Badge variant={connected ? 'default' : 'secondary'} className="rounded-md">
            {connected ? 'streaming' : 'syncing'}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {events.length ? (
          <div className="max-h-[460px] overflow-y-auto pr-1">
            <div className="flex flex-col gap-2">
              {events.map((event) => (
                <ActivityItem key={event.id} event={event} />
              ))}
            </div>
          </div>
        ) : (
          <Empty className="min-h-72 border-0 p-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RadioTowerIcon />
              </EmptyMedia>
              <EmptyTitle>{emptyTitle}</EmptyTitle>
              <EmptyDescription>{emptyDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityItem({ event }: { event: PodActivityEvent }) {
  const Icon = activityIcon(event.kind);
  return (
    <div
      className={cn(
        'grid min-h-20 grid-cols-[2.25rem_minmax(0,1fr)] gap-3 rounded-lg border bg-card px-3 py-3 shadow-sm',
        event.severity === 'critical' && 'border-destructive/45 bg-destructive/5',
        event.severity === 'warn' && 'border-chart-3/45 bg-chart-3/5',
      )}
    >
      <div
        className={cn(
          'flex size-9 items-center justify-center rounded-md border bg-muted text-muted-foreground',
          event.severity === 'critical' && 'border-destructive/35 text-destructive',
          event.severity === 'success' && 'border-chart-2/35 text-chart-2',
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-medium">{event.title}</p>
          <time className="shrink-0 text-xs text-muted-foreground">{timeLabel(event.at)}</time>
        </div>
        {event.detail && (
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {event.detail}
          </p>
        )}
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
          {event.actors?.length ? (
            event.actors.map((actor) => (
              <Badge
                key={actor}
                variant="secondary"
                className="rounded-md px-1.5 py-0 text-[0.68rem]"
              >
                {actor}
              </Badge>
            ))
          ) : event.actor ? (
            <Badge variant="secondary" className="rounded-md px-1.5 py-0 text-[0.68rem]">
              {event.actor}
            </Badge>
          ) : null}
          <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[0.68rem]">
            {event.source}
          </Badge>
          {event.file && (
            <Badge variant="outline" className="max-w-full rounded-md px-1.5 py-0 text-[0.68rem]">
              <span className="truncate">{event.file}</span>
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

function activityIcon(kind: PodActivityKind) {
  switch (kind) {
    case 'git':
      return GitBranchIcon;
    case 'collision':
      return TriangleAlertIcon;
    case 'intervention':
      return MessageSquareIcon;
    case 'outcome':
      return CheckIcon;
    case 'observation':
    default:
      return FileTextIcon;
  }
}

function timeLabel(value: string): string {
  const then = Date.parse(value);
  if (!Number.isFinite(then)) return '--';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 10) return 'now';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
