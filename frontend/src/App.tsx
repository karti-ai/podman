import { useEffect, useState } from 'react';
import type { Room } from 'livekit-client';
import {
  AlertCircleIcon,
  BrainCircuitIcon,
  CircleDotIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  SparklesIcon,
  UsersIcon,
  WifiIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import type { Pod, PodInput } from '@podman/shared';
import { joinPod } from './lib/pod.js';
import * as api from './lib/api.js';
import { PodCard } from './components/PodCard.js';
import { CreatePodForm } from './components/CreatePodForm.js';
import { PodView } from './components/PodView.js';
import { GraphView } from './components/GraphView.js';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';

const SESSION_KEY = 'podman.session';
const fmt = new Intl.NumberFormat('en', { notation: 'compact' });

export default function App() {
  const [pods, setPods] = useState<Pod[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [presence, setPresence] = useState<Record<string, string[]>>({});
  const [memory, setMemory] = useState<api.MemoryStats | null>(null);
  const [joinedPodId, setJoinedPodId] = useState<string | null>(null);
  const [member, setMember] = useState('');
  const [devMode, setDevMode] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [graphPodId, setGraphPodId] = useState<string | null>(null);

  const joinedPod = joinedPodId ? (pods.find((p) => p.id === joinedPodId) ?? null) : null;

  async function refresh() {
    setLoading(true);
    try {
      const [nextPods, nextPresence, nextMemory] = await Promise.all([
        api.listPods(),
        api.getPresence().catch(() => presence),
        api.getMemoryStats().catch(() => memory),
      ]);
      setPods(nextPods);
      setPresence(nextPresence);
      setMemory(nextMemory);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const startPending = (key: string) => setPending((s) => new Set(s).add(key));
  const endPending = (key: string) =>
    setPending((s) => {
      const n = new Set(s);
      n.delete(key);
      return n;
    });

  async function connectToPod(podId: string, who: string) {
    const result = await joinPod(podId, who, who);
    setRoom(result.room);
    setDevMode(result.mode === 'dev');
    setMember(who);
    setJoinedPodId(podId);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ podId, member: who }));
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (joinedPodId) return;
    let alive = true;
    const tick = async () => {
      try {
        const [p, m] = await Promise.all([
          api.getPresence(),
          api.getMemoryStats().catch(() => memory),
        ]);
        if (alive) {
          setPresence(p);
          setMemory(m);
        }
      } catch {
        /* presence is best-effort */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [joinedPodId]);

  useEffect(() => {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    let saved: { podId: string; member: string };
    try {
      saved = JSON.parse(raw);
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    setRestoring(true);
    void (async () => {
      try {
        await connectToPod(saved.podId, saved.member);
      } catch {
        sessionStorage.removeItem(SESSION_KEY);
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  async function run(key: string, fn: () => Promise<void>) {
    startPending(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      endPending(key);
    }
  }

  const upsert = (p: Pod) => setPods((cur) => cur.map((x) => (x.id === p.id ? p : x)));

  async function handleCreate(input: PodInput): Promise<void> {
    startPending('new');
    setError(null);
    try {
      const created = await api.createPod(input);
      setPods((cur) => [...cur, created]);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      endPending('new');
    }
  }

  const handleUpdate = (id: string, patch: PodInput) =>
    run(id, async () => upsert(await api.updatePod(id, patch)));
  const handleDelete = (id: string) =>
    run(id, async () => {
      await api.deletePod(id);
      setPods((cur) => cur.filter((x) => x.id !== id));
    });
  const handleAddMember = (id: string, name: string) =>
    run(id, async () => upsert(await api.addMember(id, name)));
  const handleRemoveMember = (id: string, name: string) =>
    run(id, async () => upsert(await api.removeMember(id, name)));

  async function handleJoin(pod: Pod, who: string) {
    startPending(pod.id);
    setError(null);
    try {
      await connectToPod(pod.id, who);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      endPending(pod.id);
    }
  }

  async function handleAddAndJoin(pod: Pod, name: string) {
    startPending(pod.id);
    setError(null);
    try {
      upsert(await api.addMember(pod.id, name));
      await connectToPod(pod.id, name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      endPending(pod.id);
    }
  }

  function handleLeave() {
    room?.disconnect();
    setRoom(null);
    setJoinedPodId(null);
    sessionStorage.removeItem(SESSION_KEY);
    void refresh();
  }

  const showReconnecting = restoring || (joinedPodId !== null && joinedPod === null);
  const liveNames = Array.from(new Set(Object.values(presence).flat()));
  const liveTotal = liveNames.length;
  const totalMembers = pods.reduce((sum, p) => sum + p.members.length, 0);
  const activeRooms = Object.values(presence).filter((names) => names.length > 0).length;
  const podManOnline = liveNames.some((name) => name.toLowerCase() === 'podman');
  const latestActivity = memory
    ? memory.observations + memory.collisions + memory.interventions + memory.outcomes
    : 0;

  if (joinedPod) {
    return (
      <PodView team={joinedPod} me={member} room={room} devMode={devMode} onLeave={handleLeave} />
    );
  }

  if (graphPodId) {
    return <GraphView podId={graphPodId} onClose={() => setGraphPodId(null)} />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8">
        <header className="sticky top-0 z-10 -mx-4 flex flex-col gap-5 border-b bg-background/86 px-4 pb-5 pt-2 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-10 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm">
                PM
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-[1.95rem] font-semibold leading-none tracking-tight">
                    PodMan
                  </h1>
                  <Badge variant={podManOnline ? 'default' : 'secondary'}>
                    <CircleDotIcon data-icon="inline-start" />
                    {podManOnline ? 'online' : 'standby'}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Live engineering rooms, team memory, and intervention routing.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className="h-8 rounded-lg px-3">
                <ShieldCheckIcon data-icon="inline-start" />
                Privacy-limited
              </Badge>
              <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
                <RefreshCwIcon data-icon="inline-start" />
                Refresh
              </Button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatPill icon={WifiIcon} label="Live" value={fmt.format(liveTotal)} />
            <StatPill icon={RadioTowerIcon} label="Rooms" value={fmt.format(activeRooms)} />
            <StatPill icon={UsersIcon} label="Roster" value={fmt.format(totalMembers)} />
            <StatPill icon={BrainCircuitIcon} label="Memory" value={fmt.format(latestActivity)} />
          </div>
        </header>

        {error && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>PodMan could not complete that action</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {showReconnecting ? (
          <Card>
            <CardHeader>
              <CardTitle>Reconnecting to your pod</CardTitle>
              <CardDescription>Restoring the saved LiveKit session.</CardDescription>
              <CardAction>
                <Button variant="outline" size="sm" onClick={handleLeave}>
                  Cancel
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-2 w-full" />
            </CardContent>
          </Card>
        ) : (
          <main className="grid min-w-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Workspaces</p>
                  <h2 className="text-xl font-semibold tracking-tight">Active pods</h2>
                </div>
                <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                  Join the room that matches your current workstream.
                </p>
              </div>

              {loading ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  <PodSkeleton />
                  <PodSkeleton />
                </div>
              ) : pods.length ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  {pods.map((pod) => (
                    <PodCard
                      key={pod.id}
                      pod={pod}
                      busy={pending.has(pod.id)}
                      presence={presence[pod.id] ?? []}
                      onJoin={handleJoin}
                      onAddAndJoin={handleAddAndJoin}
                      onAddMember={handleAddMember}
                      onRemoveMember={handleRemoveMember}
                      onUpdate={handleUpdate}
                      onDelete={handleDelete}
                      onOpenGraph={setGraphPodId}
                    />
                  ))}
                </div>
              ) : (
                <Empty className="min-h-[360px] rounded-lg border bg-card">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <SparklesIcon />
                    </EmptyMedia>
                    <EmptyTitle>No pods yet</EmptyTitle>
                    <EmptyDescription>Create the first room for this team.</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <CreatePodForm busy={pending.has('new')} onCreate={handleCreate} compact />
                  </EmptyContent>
                </Empty>
              )}
            </section>

            <aside className="flex flex-col gap-4">
              <CreatePodForm busy={pending.has('new')} onCreate={handleCreate} />
              <Card>
                <CardHeader>
                  <CardTitle>Operating brief</CardTitle>
                  <CardDescription>Current coordination signals.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <BriefLine label="Notification default" value="Card" />
                  <BriefLine label="Escalation" value="Hermes voice only when urgent" />
                  <BriefLine label="Memory events" value={fmt.format(latestActivity)} />
                  <BriefLine
                    label="Live people"
                    value={liveNames.length ? liveNames.join(', ') : 'None'}
                  />
                </CardContent>
              </Card>
            </aside>
          </main>
        )}
      </div>
    </div>
  );
}

function StatPill({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-h-16 items-center gap-3 rounded-lg border bg-card/90 px-3 py-2 shadow-sm">
      <div className="grid size-8 place-items-center rounded-md bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
        <p className="text-base font-medium">{value}</p>
      </div>
    </div>
  );
}

function BriefLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md bg-muted/45 px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="max-w-44 text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function PodSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}
