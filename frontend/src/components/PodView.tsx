import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { Room as LiveKitRoom, RoomEvent, Track } from 'livekit-client';
import {
  ArrowLeftIcon,
  BarChart3Icon,
  BrainIcon,
  CheckIcon,
  CircleDotIcon,
  EyeIcon,
  GitBranchIcon,
  ExternalLinkIcon,
  InfoIcon,
  MessageSquareIcon,
  MicIcon,
  MicOffIcon,
  MonitorUpIcon,
  Music2Icon,
  PhoneCallIcon,
  PhoneOffIcon,
  PanelLeftIcon,
  PanelRightIcon,
  RadioTowerIcon,
  ShieldIcon,
  SparklesIcon,
  TriangleAlertIcon,
  Volume2Icon,
  VolumeXIcon,
  WorkflowIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react';
import type { Room, RemoteTrack, RemoteTrackPublication } from 'livekit-client';
import type {
  HermesJob,
  HermesJobEvent,
  MemberWorkHistory,
  MemberWorkHistoryEvent,
  MemberWorkHistoryFile,
  MemberWorkHistoryRoi,
  Pod,
  PodActivityEvent,
  PodActivityKind,
  PodActivitySource,
} from '@podman/shared';
import { useBeat } from '../livekit/useBeat.js';
import {
  abortLiveConversationHermesJob,
  getLiveConversationHermesJob,
  getMemberWorkHistory,
  podMusicUrl,
  startLiveConversation,
  stopLiveConversation,
  testPodVoice,
  type LiveConversationSession,
} from '../lib/api.js';
import { useInterventions, primeSpeech } from '../livekit/useInterventions.js';
import { usePodActivity } from '../hooks/use-pod-activity.js';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  const [, setRemoteAudioTracks] = useState(0);
  const [micOn, setMicOn] = useState(false);
  const [historyMember, setHistoryMember] = useState<string | null>(null);
  const [history, setHistory] = useState<MemberWorkHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [conversationRoom, setConversationRoom] = useState<Room | null>(null);
  const [conversationSession, setConversationSession] = useState<LiveConversationSession | null>(
    null,
  );
  const [conversationState, setConversationState] = useState<
    'idle' | 'connecting' | 'listening' | 'speaking' | 'interrupted' | 'error'
  >('idle');
  const [conversationNote, setConversationNote] = useState<string | null>(null);
  const [hermesJob, setHermesJob] = useState<HermesJob | null>(null);
  const [hermesJobEvents, setHermesJobEvents] = useState<HermesJobEvent[]>([]);
  const [leftStreamOpen, setLeftStreamOpen] = useState(() =>
    readStoredBool('podman.myStreamOpen', true),
  );
  const [rightStreamOpen, setRightStreamOpen] = useState(() =>
    readStoredBool('podman.teamStreamOpen', true),
  );
  const { active, hermes, voiceCue, actionUrl, respond } = useInterventions(room);
  const { beat, toggleBeat: runBeat } = useBeat(room, podMusicUrl(team.id));
  const activity = usePodActivity(team.id, me);

  const audioRef = useRef<HTMLDivElement>(null);
  const audioElementsRef = useRef(new Map<string, HTMLElement>());
  const conversationAudioElementsRef = useRef(new Map<string, HTMLElement>());
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  // Warm the pod's background-music cache so the first click plays instantly.
  useEffect(() => {
    void fetch(podMusicUrl(team.id)).catch(() => {});
  }, [team.id]);

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
      setRemoteAudioTracks(audioElementsRef.current.size);
    };
    const removeAudio = (track: RemoteTrack, pub?: RemoteTrackPublication) => {
      const key = pub?.trackSid || track.sid || track.mediaStreamTrack.id;
      const attached = audioElementsRef.current.get(key);
      if (attached) {
        attached.remove();
        audioElementsRef.current.delete(key);
        setRemoteAudioTracks(audioElementsRef.current.size);
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
    const onAudioGone = (track: RemoteTrack, pub: RemoteTrackPublication) =>
      removeAudio(track, pub);
    const onDisconnected = () => onLeaveRef.current();
    // Browsers block autoplay of incoming audio until a user gesture unlocks it.
    // Surface a button whenever the room can't play sound so PodMan's voice cues
    // are actually heard.
    const onPlaybackChanged = () => setAudioBlocked(!room.canPlaybackAudio);
    const unlockAudioFromGesture = () => {
      void room.startAudio().finally(() => setAudioBlocked(!room.canPlaybackAudio));
    };
    onPlaybackChanged();
    setMicOn(room.localParticipant.isMicrophoneEnabled);
    window.addEventListener('pointerdown', unlockAudioFromGesture, {
      once: true,
      capture: true,
    });
    window.addEventListener('keydown', unlockAudioFromGesture, { once: true, capture: true });

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
      window.removeEventListener('pointerdown', unlockAudioFromGesture, { capture: true });
      window.removeEventListener('keydown', unlockAudioFromGesture, { capture: true });
      audioElementsRef.current.forEach((el) => el.remove());
      audioElementsRef.current.clear();
      setRemoteAudioTracks(0);
    };
  }, [room, me]);

  useEffect(() => {
    if (!conversationRoom) return;
    const attachAudio = (track: RemoteTrack, pub: RemoteTrackPublication) => {
      if (track.kind !== Track.Kind.Audio || !audioRef.current) return;
      const key = `conversation:${pub.trackSid || track.sid || track.mediaStreamTrack.id}`;
      if (conversationAudioElementsRef.current.has(key)) return;
      const element = track.attach();
      element.autoplay = true;
      conversationAudioElementsRef.current.set(key, element);
      audioRef.current.appendChild(element);
      setRemoteAudioTracks(
        audioElementsRef.current.size + conversationAudioElementsRef.current.size,
      );
    };
    const removeAudio = (track: RemoteTrack, pub?: RemoteTrackPublication) => {
      const key = `conversation:${pub?.trackSid || track.sid || track.mediaStreamTrack.id}`;
      const attached = conversationAudioElementsRef.current.get(key);
      if (attached) {
        attached.remove();
        conversationAudioElementsRef.current.delete(key);
        setRemoteAudioTracks(
          audioElementsRef.current.size + conversationAudioElementsRef.current.size,
        );
      }
      track.detach().forEach((el) => el.remove());
    };
    const refreshState = () => {
      const agentSpeaking = Array.from(conversationRoom.remoteParticipants.values()).some(
        (participant) => participant.isSpeaking,
      );
      setConversationState((current) =>
        current === 'connecting' || current === 'error'
          ? current
          : agentSpeaking
            ? 'speaking'
            : 'listening',
      );
    };
    const onData = (payload: Uint8Array) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as {
          type?: string;
          event?: { interrupt?: boolean; summary?: string };
        };
        if (msg.type === 'LIVE_CONVERSATION_EVENT') {
          setConversationState(msg.event?.interrupt ? 'interrupted' : 'listening');
          if (msg.event?.summary) setConversationNote(msg.event.summary);
        }
        if (msg.type === 'HERMES_JOB_EVENT') {
          const event = msg.event as HermesJobEvent;
          setHermesJobEvents((events) =>
            [...events.filter((item) => item.id !== event.id), event].slice(-12),
          );
          setConversationNote(event.message);
        }
      } catch {
        // Ignore non-PodMan private-room data.
      }
    };

    conversationRoom
      .on(RoomEvent.TrackSubscribed, attachAudio)
      .on(RoomEvent.TrackUnsubscribed, removeAudio)
      .on(RoomEvent.ActiveSpeakersChanged, refreshState)
      .on(RoomEvent.DataReceived, onData)
      .on(RoomEvent.Disconnected, () => setConversationState('idle'));
    refreshState();

    return () => {
      conversationRoom
        .off(RoomEvent.TrackSubscribed, attachAudio)
        .off(RoomEvent.TrackUnsubscribed, removeAudio)
        .off(RoomEvent.ActiveSpeakersChanged, refreshState)
        .off(RoomEvent.DataReceived, onData);
      conversationAudioElementsRef.current.forEach((el) => el.remove());
      conversationAudioElementsRef.current.clear();
      setRemoteAudioTracks(audioElementsRef.current.size);
    };
  }, [conversationRoom]);

  useEffect(() => {
    if (!conversationSession) {
      setHermesJob(null);
      setHermesJobEvents([]);
      return;
    }
    let alive = true;
    const refresh = async () => {
      try {
        const next = await getLiveConversationHermesJob(team.id, conversationSession.sessionId);
        if (!alive) return;
        setHermesJob(next.job);
        setHermesJobEvents(next.events);
      } catch {
        // Keep voice conversation usable even if the status panel cannot refresh.
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 2500);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [team.id, conversationSession]);

  useEffect(() => {
    if (!historyMember) {
      setHistory(null);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    let alive = true;
    setHistory(null);
    setHistoryError(null);
    setHistoryLoading(true);
    getMemberWorkHistory(team.id, historyMember)
      .then((next) => {
        if (alive) setHistory(next);
      })
      .catch((e) => {
        if (alive) setHistoryError((e as Error).message);
      })
      .finally(() => {
        if (alive) setHistoryLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [team.id, historyMember]);

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

  // Publish/unpublish the local mic. Enabling triggers the browser permission
  // prompt, so the button doubles as a "is my mic set up right?" check.
  async function toggleMic() {
    if (!room) return;
    setNote(null);
    try {
      const next = !micOn;
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
    } catch (e) {
      setNote(`Could not toggle mic: ${(e as Error).message}`);
    }
  }

  useEffect(() => {
    return () => {
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      void conversationRoom?.disconnect();
    };
  }, [conversationRoom]);

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

  async function toggleLiveConversation() {
    setNote(null);
    setConversationNote(null);
    if (conversationRoom && conversationSession) {
      const endingRoom = conversationRoom;
      const endingSession = conversationSession;
      setConversationRoom(null);
      setConversationSession(null);
      setConversationState('idle');
      setHermesJob(null);
      setHermesJobEvents([]);
      try {
        await endingRoom.localParticipant.setMicrophoneEnabled(false).catch(() => {});
        await endingRoom.disconnect();
        await stopLiveConversation(team.id, endingSession.sessionId).catch(() => {});
      } catch (e) {
        setNote(`Could not stop live conversation: ${(e as Error).message}`);
      }
      return;
    }

    setConversationState('connecting');
    try {
      primeSpeech();
      await room?.startAudio().catch(() => {});
      const session = await startLiveConversation(team.id, { identity: me, displayName: me });
      const privateRoom = new LiveKitRoom({ adaptiveStream: true, dynacast: true });
      privateRoom.on(RoomEvent.Disconnected, () => {
        setConversationRoom(null);
        setConversationSession(null);
        setConversationState('idle');
      });
      await privateRoom.connect(session.url, session.token);
      await privateRoom.startAudio().catch(() => {});
      await privateRoom.localParticipant.setMicrophoneEnabled(true);
      setConversationSession(session);
      setConversationRoom(privateRoom);
      setConversationState('listening');
    } catch (e) {
      setConversationState('error');
      setConversationRoom(null);
      setConversationSession(null);
      setHermesJob(null);
      setHermesJobEvents([]);
      setNote(`Live conversation failed: ${(e as Error).message}`);
    }
  }

  async function stopHermesJob() {
    if (!conversationSession || !hermesJob) return;
    setNote(null);
    try {
      const next = await abortLiveConversationHermesJob(team.id, conversationSession.sessionId);
      setHermesJob(next.job);
      setConversationNote('Hermes is aborting the current job.');
    } catch (e) {
      setNote(`Could not stop Hermes job: ${(e as Error).message}`);
    }
  }

  async function toggleScreen() {
    primeSpeech(); // unlock browser voice from this gesture too
    if (!room) return;
    setNote(null);
    try {
      await room.startAudio().catch(() => {});
      setAudioBlocked(!room.canPlaybackAudio);
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
        description={`${me}'s activity feed.`}
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

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-0.5 rounded-xl border bg-card/80 p-1 shadow-sm backdrop-blur-sm">
                    <PodControlButton
                      label={audioBlocked ? 'Enable audio' : 'Audio on'}
                      icon={audioBlocked ? VolumeXIcon : Volume2Icon}
                      onClick={() => void enableSound()}
                      disabled={!room}
                      active={!audioBlocked}
                      attention={audioBlocked}
                    />
                    <PodControlButton
                      label={micOn ? 'Mic on' : 'Enable mic'}
                      icon={micOn ? MicIcon : MicOffIcon}
                      onClick={() => void toggleMic()}
                      disabled={!room}
                      active={micOn}
                    />
                    <PodControlButton
                      label={
                        beat.on
                          ? beat.mine
                            ? 'Stop background music'
                            : `Stop music (${beat.by})`
                          : 'Background music'
                      }
                      icon={Music2Icon}
                      onClick={onToggleBeat}
                      disabled={!room}
                      active={beat.on}
                    />
                    <PodControlButton
                      label={testingVoice ? 'Sending voice…' : 'Test PodMan voice'}
                      icon={RadioTowerIcon}
                      onClick={() => void playPodManVoiceTest()}
                      disabled={!room || testingVoice}
                      active={testingVoice}
                      busy={testingVoice}
                    />
                  </div>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={toggleScreen}
                        disabled={!room}
                        variant={sharing ? 'destructive' : 'default'}
                      >
                        <MonitorUpIcon data-icon="inline-start" />
                        {sharing ? 'Stop sharing' : 'Share screen'}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {sharing ? 'Stop sharing your screen' : 'Share your screen with PodMan'}
                    </TooltipContent>
                  </Tooltip>
                </div>
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
                          <Participant
                            key={p.id}
                            participant={p}
                            onOpenHistory={setHistoryMember}
                          />
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
                    <CardTitle>Live Conversation</CardTitle>
                    <CardDescription>Private voice channel with PodMan context.</CardDescription>
                    <CardAction>
                      <Badge
                        variant={conversationRoom ? 'default' : 'secondary'}
                        className="rounded-md"
                      >
                        {conversationRoom ? 'live' : 'off'}
                      </Badge>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <Button
                      onClick={() => void toggleLiveConversation()}
                      disabled={!room || conversationState === 'connecting'}
                      variant={conversationRoom ? 'outline' : 'default'}
                      data-testid="live-conversation-toggle"
                    >
                      {conversationRoom ? (
                        <PhoneOffIcon data-icon="inline-start" />
                      ) : (
                        <PhoneCallIcon data-icon="inline-start" />
                      )}
                      {conversationState === 'connecting'
                        ? 'Connecting'
                        : conversationRoom
                          ? 'Stop Live Conversation'
                          : 'Start Live Conversation'}
                    </Button>
                    <div className="grid gap-2 text-sm">
                      <StatusLine
                        label="Mode"
                        value={conversationRoom ? 'private 1:1 room' : 'not started'}
                      />
                      <StatusLine
                        label="State"
                        value={conversationState === 'idle' ? 'ready' : conversationState}
                      />
                      <StatusLine
                        label="Context"
                        value={conversationRoom ? 'synced on demand' : 'waiting'}
                      />
                      <StatusLine
                        label="Hermes"
                        value={hermesJob ? hermesJob.status.replaceAll('_', ' ') : 'idle'}
                      />
                    </div>
                    {hermesJob &&
                      ['queued', 'running', 'waiting_for_confirmation', 'aborting'].includes(
                        hermesJob.status,
                      ) && (
                        <Button
                          variant="outline"
                          onClick={() => void stopHermesJob()}
                          data-testid="hermes-job-stop"
                        >
                          <XIcon data-icon="inline-start" />
                          Stop Hermes Job
                        </Button>
                      )}
                    {hermesJobEvents.length > 0 && (
                      <div className="rounded-lg border border-dashed p-3">
                        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <WorkflowIcon className="size-3.5" />
                          Hermes progress
                        </div>
                        <div className="flex flex-col gap-2">
                          {hermesJobEvents.slice(-3).map((event) => (
                            <div key={event.id} className="text-sm leading-5">
                              <span className="font-medium">{event.type.replaceAll('_', ' ')}</span>
                              <span className="text-muted-foreground"> - {event.message}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {conversationNote && (
                      <div className="rounded-lg border border-dashed p-3">
                        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <TriangleAlertIcon className="size-3.5" />
                          Live interruption
                        </div>
                        <p className="text-sm leading-6">{conversationNote}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

              </aside>
            </main>
            <div
              ref={audioRef}
              data-testid="livekit-audio-sink"
              className="pointer-events-none fixed size-px overflow-hidden opacity-0"
            />
            <WorkHistoryDialog
              member={historyMember}
              history={history}
              loading={historyLoading}
              error={historyError}
              onOpenChange={(open) => {
                if (!open) setHistoryMember(null);
              }}
            />
          </div>
        </SidebarInset>
        <ActivitySidebar
          side="right"
          title="Team stream"
          collapsedLabel="Team"
          testId="team-stream-sidebar"
          description="Team activity feed."
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

function Participant({
  participant,
  onOpenHistory,
}: {
  participant: PInfo;
  onOpenHistory: (member: string) => void;
}) {
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
      <div className="flex shrink-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onOpenHistory(participant.name)}
              aria-label={`${participant.name} work history`}
            >
              <BarChart3Icon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Work history</TooltipContent>
        </Tooltip>
        <Badge variant={participant.speaking ? 'default' : 'secondary'} className="rounded-md">
          {participant.speaking ? 'speaking' : 'connected'}
        </Badge>
      </div>
    </div>
  );
}

function WorkHistoryDialog({
  member,
  history,
  loading,
  error,
  onOpenChange,
}: {
  member: string | null;
  history: MemberWorkHistory | null;
  loading: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>{member ? `${member}'s recent work` : 'Recent work'}</DialogTitle>
          <DialogDescription>
            Last {history?.windowHours ?? 24} hours from MongoDB observations and git state.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="grid min-h-72 place-items-center rounded-lg border bg-muted/20">
            <div className="text-sm text-muted-foreground">Loading history</div>
          </div>
        )}

        {error && !loading && (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>History unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {history && !loading && !error && (
          <div className="flex flex-col gap-5">
            <RoiBand roi={history.roi} />
            <div className="grid gap-2 sm:grid-cols-3">
              <HistoryStat label="Files" value={history.totals.files} />
              <HistoryStat label="Screen logs" value={history.totals.observations} />
              <HistoryStat label="Git changes" value={history.totals.gitChanges} />
            </div>

            {history.files.length ? (
              <>
                <section className="rounded-lg border bg-muted/15 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">Recent files</h3>
                    <Badge variant="secondary" className="rounded-md">
                      {history.files.length}
                    </Badge>
                  </div>
                  <div className="flex flex-col gap-3">
                    {history.files.map((file) => (
                      <FileHistoryRow
                        key={file.file}
                        file={file}
                        max={maxFileScore(history.files)}
                      />
                    ))}
                  </div>
                </section>

                <section className="rounded-lg border bg-muted/15 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">Timeline</h3>
                    <Badge variant="outline" className="rounded-md">
                      {history.timeline.length}
                    </Badge>
                  </div>
                  <HistoryTimeline events={history.timeline} />
                </section>
              </>
            ) : (
              <Empty className="min-h-72 border-0 p-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <BarChart3Icon />
                  </EmptyMedia>
                  <EmptyTitle>No recent work history</EmptyTitle>
                  <EmptyDescription>
                    MongoDB has no recent screen observations or git changes for this member.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatSaved(minutes: number): string {
  if (minutes < 60) return `~${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `~${h}h ${m}m` : `~${h}h`;
}

function RoiTooltip({ roi }: { roi: MemberWorkHistoryRoi }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="How rework saved is estimated"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <InfoIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        <div className="flex flex-col gap-1">
          <p className="font-medium">Estimated rework saved</p>
          {roi.breakdown.length ? (
            roi.breakdown.map((row) => (
              <p key={row.label} className="font-mono text-[0.7rem]">
                {row.count} × {row.minutesEach}m · {row.label}
              </p>
            ))
          ) : (
            <p className="text-[0.7rem]">No eligible clashes.</p>
          )}
          <p className="text-[0.68rem] text-muted-foreground">
            credit split across engineers · est. only
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function RoiBand({ roi }: { roi?: MemberWorkHistoryRoi }) {
  if (!roi || roi.clashesCaught === 0) return null;
  const conflictFree = roi.totalFiles
    ? Math.round((roi.conflictFreeFiles / roi.totalFiles) * 100)
    : 100;
  return (
    <section className="rounded-lg border bg-primary/5 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="font-mono text-2xl font-semibold">{formatSaved(roi.savedMinutes)}</p>
            <span className="text-sm text-muted-foreground">rework saved</span>
            <RoiTooltip roi={roi} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            estimated · clashes caught pre-commit
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-medium">{roi.clashesCaught}</p>
          <p className="text-xs text-muted-foreground">clashes caught early</p>
        </div>
      </div>
      {roi.totalFiles > 0 && (
        <>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${conflictFree}%` }}
              aria-label={`${roi.conflictFreeFiles} of ${roi.totalFiles} files conflict-free`}
            />
          </div>
          <p className="mt-1.5 text-[0.68rem] text-muted-foreground">
            conflict-free: {roi.conflictFreeFiles} of {roi.totalFiles} files ·{' '}
            {roi.filesDeconflicted} auto-deconflicted
          </p>
        </>
      )}
    </section>
  );
}

function HistoryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg font-medium">{value}</p>
    </div>
  );
}

function maxFileScore(files: MemberWorkHistoryFile[]): number {
  return Math.max(1, ...files.map((file) => file.observations + file.gitChanges));
}

function FileHistoryRow({ file, max }: { file: MemberWorkHistoryFile; max: number }) {
  const score = file.observations + file.gitChanges;
  const width = `${Math.max(8, Math.round((score / max) * 100))}%`;
  return (
    <div className="grid gap-2">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium">{file.file}</p>
          <p className="truncate text-xs text-muted-foreground">
            {file.activities[0] ?? `${timeLabel(file.lastSeenAt)} ago`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {file.current && (
            <Badge variant="default" className="rounded-md px-1.5 py-0 text-[0.68rem]">
              current
            </Badge>
          )}
          <Badge variant="secondary" className="rounded-md px-1.5 py-0 text-[0.68rem]">
            {score}
          </Badge>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width }}
          aria-label={`${score} recent work signals`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[0.68rem] text-muted-foreground">
        <span>{file.observations} screen</span>
        <span>{file.gitChanges} git</span>
        {file.confidenceAvg !== null && <span>{Math.round(file.confidenceAvg * 100)}% conf</span>}
      </div>
    </div>
  );
}

function HistoryTimeline({ events }: { events: MemberWorkHistoryEvent[] }) {
  if (!events.length) {
    return <p className="text-sm text-muted-foreground">No timeline entries.</p>;
  }
  return (
    <div className="relative flex flex-col gap-3 pl-4 before:absolute before:left-[0.31rem] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-border">
      {events.slice(0, 18).map((event) => {
        const Icon = event.source === 'git' ? GitBranchIcon : MonitorUpIcon;
        return (
          <div key={event.id} className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
            <span className="absolute -left-4 top-2 size-2 rounded-full bg-primary" />
            <div className="mt-0.5 flex size-6 items-center justify-center rounded-md border bg-background text-muted-foreground">
              <Icon className="size-3.5" />
            </div>
            <div className="min-w-0 rounded-md border bg-background px-3 py-2">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <p className="line-clamp-1 min-w-0 break-words text-sm font-medium">
                  {event.title}
                </p>
                <time className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                  {timeLabel(event.at)}
                </time>
              </div>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{event.file}</p>
              {event.detail && (
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{event.detail}</p>
              )}
            </div>
          </div>
        );
      })}
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
    hint: 'Recent screen and git activity.',
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

/**
 * Compact, icon-only control for the pod toolbar. The label is hidden by
 * default and surfaced on hover/focus via tooltip, so the row stays tight and
 * responsive. `active` fills the button (engaged state), `attention` promotes
 * it to the primary colour (needs a user action, e.g. audio is blocked).
 */
function PodControlButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  active = false,
  attention = false,
  busy = false,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  attention?: boolean;
  busy?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant={attention ? 'default' : active ? 'secondary' : 'ghost'}
          aria-pressed={active}
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          <Icon className={cn(busy && 'animate-pulse')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
