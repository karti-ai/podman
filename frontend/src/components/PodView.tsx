import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import {
  ArrowLeftIcon,
  BrainIcon,
  CheckIcon,
  CircleDotIcon,
  EyeIcon,
  GitBranchIcon,
  ExternalLinkIcon,
  MessageSquareIcon,
  MonitorUpIcon,
  PanelLeftIcon,
  PanelRightIcon,
  RadioTowerIcon,
  ShieldIcon,
  SparklesIcon,
  TriangleAlertIcon,
  Volume2Icon,
  WorkflowIcon,
  XIcon,
} from 'lucide-react';
import type { Room, RemoteTrack, RemoteTrackPublication } from 'livekit-client';
import type { Pod, PodActivityEvent, PodActivityKind, PodActivitySource } from '@podman/shared';
import { useBeat } from '../livekit/useBeat.js';
import { testPodVoice } from '../lib/api.js';
import { useInterventions, primeSpeech } from '../livekit/useInterventions.js';
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
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const STREAM_SIDEBAR_WIDTH = 'clamp(20rem, 22vw, 23rem)';
const STREAM_RAIL_WIDTH = '4rem';

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

function readStoredBool(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
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
  const [testingVoice, setTestingVoice] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [leftStreamOpen, setLeftStreamOpen] = useState(() =>
    readStoredBool('podman.myStreamOpen', true),
  );
  const [rightStreamOpen, setRightStreamOpen] = useState(() =>
    readStoredBool('podman.teamStreamOpen', true),
  );
  const { active, hermes, voiceCue, actionUrl, respond } = useInterventions(room);
  const { beat, toggleBeat: runBeat } = useBeat(room);
  const activity = usePodActivity(team.id, me);

  const audioRef = useRef<HTMLDivElement>(null);
  const audioElementsRef = useRef(new Map<string, HTMLElement>());
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  useEffect(() => {
    if (!room) return;
    const refresh = () => setParticipants(snapshot(room, me));
    refresh();

    const attachAudio = (track: RemoteTrack, pub: RemoteTrackPublication) => {
      if (track.kind !== Track.Kind.Audio || !audioRef.current) return;
      const key = pub.trackSid || track.sid || track.mediaStreamTrack.id;
      if (audioElementsRef.current.has(key)) return;
      const element = track.attach();
      element.autoplay = true;
      audioElementsRef.current.set(key, element);
      audioRef.current.appendChild(element);
    };
    const removeAudio = (track: RemoteTrack, pub?: RemoteTrackPublication) => {
      const key = pub?.trackSid || track.sid || track.mediaStreamTrack.id;
      const attached = audioElementsRef.current.get(key);
      if (attached) {
        attached.remove();
        audioElementsRef.current.delete(key);
      }
      track.detach().forEach((el) => el.remove());
    };
    const attachExistingAudio = () => {
      room.remoteParticipants.forEach((participant) => {
        participant.audioTrackPublications.forEach((publication) => {
          const track = publication.track;
          if (track) attachAudio(track, publication);
        });
      });
    };
    const onAudio = (track: RemoteTrack, pub: RemoteTrackPublication) => attachAudio(track, pub);
    const onAudioGone = (track: RemoteTrack, pub: RemoteTrackPublication) => removeAudio(track, pub);
    const onDisconnected = () => onLeaveRef.current();
    // Browsers block autoplay of incoming audio until a user gesture unlocks it.
    // Surface a button whenever the room can't play sound so PodMan's voice cues
    // are actually heard.
    const onPlaybackChanged = () => setAudioBlocked(!room.canPlaybackAudio);
    onPlaybackChanged();

    room
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.TrackSubscribed, onAudio)
      .on(RoomEvent.TrackUnsubscribed, onAudioGone)
      .on(RoomEvent.AudioPlaybackStatusChanged, onPlaybackChanged)
      .on(RoomEvent.Disconnected, onDisconnected);
    attachExistingAudio();

    return () => {
      room
        .off(RoomEvent.ParticipantConnected, refresh)
        .off(RoomEvent.ParticipantDisconnected, refresh)
        .off(RoomEvent.ActiveSpeakersChanged, refresh)
        .off(RoomEvent.TrackSubscribed, onAudio)
        .off(RoomEvent.TrackUnsubscribed, onAudioGone)
        .off(RoomEvent.AudioPlaybackStatusChanged, onPlaybackChanged)
        .off(RoomEvent.Disconnected, onDisconnected);
      audioElementsRef.current.forEach((el) => el.remove());
      audioElementsRef.current.clear();
    };
  }, [room, me]);

  async function enableSound() {
    primeSpeech(); // unlock browser voice from this gesture
    if (!room) return;
    try {
      await room.startAudio();
      setAudioBlocked(!room.canPlaybackAudio);
    } catch (e) {
      setNote(`Could not enable sound: ${(e as Error).message}`);
    }
  }

  useEffect(() => {
    return () => {
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('podman.myStreamOpen', String(leftStreamOpen));
  }, [leftStreamOpen]);

  useEffect(() => {
    localStorage.setItem('podman.teamStreamOpen', String(rightStreamOpen));
  }, [rightStreamOpen]);

  async function onToggleBeat() {
    setNote(null);
    try {
      await runBeat();
    } catch (e) {
      setNote(`Audio test failed: ${(e as Error).message}`);
    }
  }

  async function playPodManVoiceTest() {
    if (!room) return;
    setNote(null);
    setTestingVoice(true);
    try {
      await room.startAudio().catch(() => {});
      setAudioBlocked(!room.canPlaybackAudio);
      await testPodVoice(team.id);
      setNote('PodMan voice test sent.');
    } catch (e) {
      setNote(`PodMan voice test failed: ${(e as Error).message}`);
    } finally {
      setTestingVoice(false);
    }
  }

  async function toggleScreen() {
    primeSpeech(); // unlock browser voice from this gesture too
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
    <SidebarProvider
      open={leftStreamOpen}
      onOpenChange={setLeftStreamOpen}
      style={
        {
          '--sidebar-width': STREAM_SIDEBAR_WIDTH,
          '--sidebar-width-icon': STREAM_RAIL_WIDTH,
        } as CSSProperties
      }
      className="min-h-screen bg-background text-foreground"
    >
      <ActivitySidebar
        side="left"
        title="My stream"
        collapsedLabel="Mine"
        testId="my-stream-sidebar"
        description={`${me}'s live screen, git, intervention, and conflict log.`}
        events={activity.mine}
        connected={activity.connected}
        open={leftStreamOpen}
        onToggle={() => setLeftStreamOpen((open) => !open)}
        emptyTitle="No personal signal yet"
        emptyDescription="Start the local git watcher or share your IDE screen to populate this lane."
      />
      <SidebarProvider
        open={rightStreamOpen}
        onOpenChange={setRightStreamOpen}
        style={
          {
            '--sidebar-width': STREAM_SIDEBAR_WIDTH,
            '--sidebar-width-icon': STREAM_RAIL_WIDTH,
          } as CSSProperties
        }
        className="flex-1"
      >
        <SidebarInset
          data-testid="pod-main-workspace"
          className="min-h-screen min-w-0 bg-background"
        >
          <div className="mx-auto flex min-h-screen w-full max-w-[1120px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
            <section data-testid="pod-body-summary" className="flex flex-col gap-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
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
                  <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm">
                    {initials(team.name) || 'PM'}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-[1.75rem] font-semibold leading-none tracking-tight">
                        {team.name}
                      </h1>
                      <Badge variant={room ? 'default' : 'secondary'} className="rounded-md">
                        {room ? 'live' : 'local'}
                      </Badge>
                    </div>
                    <p className="truncate font-mono text-xs text-muted-foreground">{team.repo}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                  <Button variant="outline" onClick={onToggleBeat} disabled={!room}>
                    <Volume2Icon data-icon="inline-start" />
                    {beat.on ? (beat.mine ? 'Stop audio' : `Stop (${beat.by})`) : 'Test audio'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void playPodManVoiceTest()}
                    disabled={!room || testingVoice}
                  >
                    <RadioTowerIcon data-icon="inline-start" />
                    {testingVoice ? 'Sending voice' : 'Test PodMan voice'}
                  </Button>
                  <Button onClick={toggleScreen} disabled={!room}>
                    <MonitorUpIcon data-icon="inline-start" />
                    {sharing ? 'Stop sharing' : 'Share screen'}
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="Participants" value={participants.length || 1} />
                <Metric label="Screen" value={sharing ? 'sharing' : 'idle'} />
                <Metric label="PodMan" value={podmanPresent ? 'online' : 'waiting'} />
              </div>
            </section>

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

            {room && audioBlocked && (
              <Alert className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Volume2Icon />
                  <div>
                    <AlertTitle>Sound is off</AlertTitle>
                    <AlertDescription>Click to hear PodMan&apos;s voice alerts.</AlertDescription>
                  </div>
                </div>
                <Button size="sm" onClick={() => void enableSound()}>
                  Enable sound
                </Button>
              </Alert>
            )}

            <main className="grid flex-1 gap-5 min-[1800px]:grid-cols-[minmax(0,1fr)_340px]">
              <section className="flex min-w-0 flex-col gap-5">
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

                {activity.error && (
                  <p className="text-xs text-muted-foreground">{activity.error}</p>
                )}
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
                            Share your screen when ready. PodMan will stay quiet until there is a
                            useful signal.
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
                      active={beat.on}
                      height={32}
                      barWidth={2}
                      barGap={3}
                      className="mb-4 px-3 py-2 text-muted-foreground"
                    />
                    <div className="flex flex-col gap-3">
                      <StatusLine label="LiveKit" value={room ? 'connected' : 'offline'} />
                      <StatusLine label="Screen" value={sharing ? 'published' : 'not shared'} />
                      <StatusLine
                        label="Audio"
                        value={
                          beat.on ? (beat.mine ? 'publishing' : `${beat.by} playing`) : 'ready'
                        }
                      />
                      <StatusLine label="Agent" value={podmanPresent ? 'watching' : 'waiting'} />
                    </div>
                  </CardContent>
                </Card>
              </aside>
            </main>
            <div
              ref={audioRef}
              data-testid="livekit-audio-sink"
              className="pointer-events-none fixed size-px overflow-hidden opacity-0"
            />
          </div>
        </SidebarInset>
        <ActivitySidebar
          side="right"
          title="Team stream"
          collapsedLabel="Team"
          testId="team-stream-sidebar"
          description="Everyone else in this pod, merged into one realtime feed."
          events={activity.team}
          connected={activity.connected}
          open={rightStreamOpen}
          onToggle={() => setRightStreamOpen((open) => !open)}
          emptyTitle="No teammate signal yet"
          emptyDescription="Waiting for other members' screen, git, or collision events."
        />
      </SidebarProvider>
    </SidebarProvider>
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

function ActivitySidebar({
  side,
  title,
  collapsedLabel,
  testId,
  description,
  events,
  connected,
  open,
  onToggle,
  emptyTitle,
  emptyDescription,
}: {
  side: 'left' | 'right';
  title: string;
  collapsedLabel: string;
  testId: string;
  description: string;
  events: PodActivityEvent[];
  connected: boolean;
  open: boolean;
  onToggle: () => void;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const ToggleIcon = side === 'left' ? PanelLeftIcon : PanelRightIcon;
  const critical = events.filter((event) => event.severity === 'critical').length;
  const toggleTestId = testId.replace('-sidebar', '-toggle');

  return (
    <Sidebar
      side={side}
      collapsible="icon"
      className="border-border/80 bg-sidebar"
      data-testid={testId}
    >
      <SidebarHeader className="border-b px-3 py-3">
        <div className="flex min-w-0 items-start justify-between gap-2 group-data-[collapsible=icon]:hidden">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold">{title}</h2>
              <Badge variant={connected ? 'default' : 'secondary'} className="rounded-md">
                {connected ? 'streaming' : 'syncing'}
              </Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <StreamStat label="Events" value={events.length} />
              <StreamStat label="Critical" value={critical} />
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onToggle} data-testid={toggleTestId}>
                <ToggleIcon />
                <span className="sr-only">{open ? `Collapse ${title}` : `Expand ${title}`}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{open ? `Collapse ${title}` : `Expand ${title}`}</TooltipContent>
          </Tooltip>
        </div>

        <button
          type="button"
          onClick={onToggle}
          data-testid={toggleTestId}
          className="hidden min-h-32 w-full flex-col items-center justify-center gap-2 rounded-md border bg-background text-muted-foreground transition hover:bg-muted group-data-[collapsible=icon]:flex"
          aria-label={`Expand ${title}`}
        >
          <ToggleIcon className="size-4" />
          <span
            className={cn(
              'size-2 rounded-full',
              connected ? 'bg-chart-2' : 'bg-muted-foreground/35',
            )}
          />
          <span className="text-[0.68rem] font-medium [writing-mode:vertical-rl]">
            {collapsedLabel}
          </span>
          <Badge
            variant={critical ? 'destructive' : 'secondary'}
            className="rounded-md px-1.5 py-0"
          >
            {events.length}
          </Badge>
          {critical > 0 && (
            <Badge variant="destructive" className="rounded-md px-1.5 py-0">
              {critical}
            </Badge>
          )}
        </button>
      </SidebarHeader>
      <SidebarContent className="px-3 py-3">
        <div className="group-data-[collapsible=icon]:hidden">
          {events.length ? (
            <div className="flex max-h-[calc(100svh-9rem)] flex-col gap-4 overflow-y-auto pr-1">
              {ACTIVITY_CATEGORIES.map((category) => {
                const items = events.filter((event) => CATEGORY_OF[event.kind] === category.id);
                if (!items.length) return null;
                const CategoryIcon = category.icon;
                return (
                  <section key={category.id} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 px-0.5">
                      <CategoryIcon className="size-3.5 text-muted-foreground" />
                      <h3 className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                        {category.label}
                      </h3>
                      <Badge variant="secondary" className="rounded-md px-1.5 py-0 text-[0.65rem]">
                        {items.length}
                      </Badge>
                    </div>
                    <p className="-mt-1 px-0.5 text-[0.65rem] leading-4 text-muted-foreground/70">
                      {category.hint}
                    </p>
                    <div className="flex flex-col gap-3">
                      {items.map((event) => (
                        <ActivityItem key={event.id} event={event} />
                      ))}
                    </div>
                  </section>
                );
              })}
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
        </div>

        <div className="hidden flex-col items-center gap-2 group-data-[collapsible=icon]:flex">
          {events.slice(0, 8).map((event) => {
            const Icon = activityIcon(event.kind);
            return (
              <Tooltip key={event.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onToggle}
                    className={cn(
                      'flex size-9 items-center justify-center rounded-md border bg-background text-muted-foreground transition hover:bg-muted',
                      event.severity === 'critical' && 'border-destructive/35 text-destructive',
                      event.severity === 'success' && 'border-chart-2/35 text-chart-2',
                    )}
                  >
                    <Icon className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side={side === 'left' ? 'right' : 'left'}>
                  {event.title}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

function StreamStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background px-2 py-1.5">
      <p className="text-[0.65rem] font-medium uppercase text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-medium">{value}</p>
    </div>
  );
}

function ActivityItem({ event }: { event: PodActivityEvent }) {
  const Icon = activityIcon(event.kind);
  const metadata = activityMetadata(event);
  const title = activityTitle(event);
  return (
    <div
      className={cn(
        'grid min-h-20 shrink-0 grid-cols-[2.25rem_minmax(0,1fr)] gap-3 overflow-hidden rounded-lg border bg-card px-3.5 py-3.5 shadow-sm',
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
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <p className="line-clamp-2 min-w-0 break-words text-sm font-medium leading-5">{title}</p>
          <time className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
            {timeLabel(event.at)}
          </time>
        </div>
        {event.detail && (
          <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-muted-foreground">
            {event.detail}
          </p>
        )}
        {event.imageUrl && (
          <div className="mt-2 overflow-hidden rounded-md border bg-muted">
            <img
              src={event.imageUrl}
              alt={activityImageAlt(event)}
              loading="lazy"
              className="aspect-video w-full object-cover"
            />
          </div>
        )}
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
          <SourceChip source={event.source} />
          <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[0.68rem] leading-4">
            {KIND_LABEL[event.kind]}
          </Badge>
          {metadata.map((item, index) => (
            <ActivityBadge
              key={`${item.variant}-${item.label}-${index}`}
              variant={item.variant}
              title={item.title}
            >
              {item.label}
            </ActivityBadge>
          ))}
        </div>
      </div>
    </div>
  );
}

function activityMetadata(event: PodActivityEvent): {
  label: string;
  title?: string;
  variant: 'secondary' | 'outline';
}[] {
  const actors = event.actors?.length ? event.actors : event.actor ? [event.actor] : [];
  const visibleActors = actors.slice(0, 2).map((actor) => ({
    label: actor,
    variant: 'secondary' as const,
  }));
  const hiddenActors = actors.length - visibleActors.length;
  return [
    ...visibleActors,
    ...(hiddenActors > 0
      ? [
          {
            label: `+${hiddenActors}`,
            title: actors.slice(2).join(', '),
            variant: 'secondary' as const,
          },
        ]
      : []),
    ...(event.file ? [{ label: event.file, variant: 'outline' as const }] : []),
  ];
}

function ActivityBadge({
  variant,
  children,
  title,
}: {
  variant: 'secondary' | 'outline';
  children: string;
  title?: string;
}) {
  return (
    <Badge
      variant={variant}
      title={title ?? children}
      className="min-w-0 max-w-[9rem] rounded-md px-1.5 py-0 text-[0.68rem] leading-4"
    >
      <span className="truncate">{children}</span>
    </Badge>
  );
}

type ActivityCategoryId = 'signal' | 'decision';

const CATEGORY_OF: Record<PodActivityKind, ActivityCategoryId> = {
  observation: 'signal',
  git: 'signal',
  collision: 'decision',
  intervention: 'decision',
  outcome: 'decision',
};

const ACTIVITY_CATEGORIES: {
  id: ActivityCategoryId;
  label: string;
  hint: string;
  icon: typeof RadioTowerIcon;
}[] = [
  {
    id: 'signal',
    label: 'Signals',
    hint: 'Screen logs and local git activity routed to this stream.',
    icon: RadioTowerIcon,
  },
  {
    id: 'decision',
    label: 'Reasoning & decisions',
    hint: 'What Hermes concluded and acted on — conflicts, interventions, outcomes.',
    icon: WorkflowIcon,
  },
];

const KIND_LABEL: Record<PodActivityKind, string> = {
  observation: 'Screen log',
  git: 'Git',
  collision: 'Conflict',
  intervention: 'Intervention',
  outcome: 'Outcome',
};

const SOURCE_META: Record<
  PodActivitySource,
  { label: string; icon: typeof RadioTowerIcon; className: string }
> = {
  vision: {
    label: 'Screen',
    icon: EyeIcon,
    className: 'border-chart-1/40 bg-chart-1/10 text-chart-1',
  },
  git: {
    label: 'Git',
    icon: GitBranchIcon,
    className: 'border-chart-2/40 bg-chart-2/10 text-chart-2',
  },
  memory: {
    label: 'Memory',
    icon: BrainIcon,
    className: 'border-chart-4/40 bg-chart-4/10 text-chart-4',
  },
  hermes: {
    label: 'Hermes',
    icon: SparklesIcon,
    className: 'border-primary/40 bg-primary/10 text-primary',
  },
  policy: {
    label: 'Policy',
    icon: ShieldIcon,
    className: 'border-chart-3/40 bg-chart-3/10 text-chart-3',
  },
};

function SourceChip({ source }: { source: PodActivitySource }) {
  const meta = SOURCE_META[source];
  const Icon = meta.icon;
  return (
    <Badge
      variant="outline"
      title={`Source: ${meta.label}`}
      className={cn(
        'gap-1 rounded-md border px-1.5 py-0 text-[0.68rem] font-medium leading-4',
        meta.className,
      )}
    >
      <Icon className="size-3" />
      {meta.label}
    </Badge>
  );
}

function activityTitle(event: PodActivityEvent): string {
  if (event.kind !== 'observation') return event.title;
  return event.title.startsWith('Screen') ? event.title : `Screen log: ${event.title}`;
}

function activityImageAlt(event: PodActivityEvent): string {
  const actor = event.actor ?? event.actors?.[0] ?? 'teammate';
  return `${actor} screen thumbnail`;
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
      return MonitorUpIcon;
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
