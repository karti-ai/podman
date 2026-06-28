import { useEffect, useState } from 'react';
import type { Room } from 'livekit-client';
import type { Pod, PodInput } from '@podman/shared';
import { joinPod } from './lib/pod.js';
import * as api from './lib/api.js';
import { PodCard } from './components/PodCard.js';
import { CreatePodForm } from './components/CreatePodForm.js';
import { PodView } from './components/PodView.js';

const SESSION_KEY = 'podman.session';

const fmt = new Intl.NumberFormat('en', { notation: 'compact' });

export default function App() {
  const [pods, setPods] = useState<Pod[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [presence, setPresence] = useState<Record<string, string[]>>({});
  const [memory, setMemory] = useState<api.MemoryStats | null>(null);

  // join state — keep the id and derive the pod so it never goes stale
  const [joinedPodId, setJoinedPodId] = useState<string | null>(null);
  const [member, setMember] = useState('');
  const [devMode, setDevMode] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [restoring, setRestoring] = useState(false);

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

  // Connect to a pod's LiveKit room and persist the session for refresh-resume.
  async function connectToPod(podId: string, who: string) {
    // Stable identity per member so a refresh/rejoin replaces the existing
    // session instead of leaving a ghost participant behind.
    const identity = who;
    const result = await joinPod(podId, identity, who);
    setRoom(result.room);
    setDevMode(result.mode === 'dev');
    setMember(who);
    setJoinedPodId(podId);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ podId, member: who }));
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Poll live presence while browsing the pod list (not while joined — PodView
  // tracks the room live itself).
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

  // Resume a joined session across a page refresh (auto-reconnect, no re-prompt).
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

  // Add your name to the roster (if new) and join in one step.
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
    void refresh(); // re-sync the list (e.g. if the pod was deleted out from under us)
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

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-5 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-950 shadow-sm">
                PM
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Live team coordination</p>
                <h1 className="text-3xl font-semibold text-slate-950">PodMan</h1>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Active work, team memory, and coordination signals in one quiet workspace.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[520px]">
            <Metric label="Live now" value={fmt.format(liveTotal)} tone="green" />
            <Metric label="Live rooms" value={fmt.format(activeRooms)} tone="blue" />
            <Metric label="Roster" value={fmt.format(totalMembers)} tone="slate" />
            <Metric label="Memory" value={fmt.format(latestActivity)} tone="amber" />
          </div>
        </header>

        <div className="grid flex-1 gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-w-0">
            {joinedPod ? (
              <PodView
                team={joinedPod}
                me={member}
                room={room}
                devMode={devMode}
                onLeave={handleLeave}
              />
            ) : showReconnecting ? (
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-600">Reconnecting to your pod...</p>
                <button
                  className="mt-3 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                  onClick={handleLeave}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <main className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Team workspaces</h2>
                    <p className="text-sm text-slate-500">
                      Pods, presence, and intervention state.
                    </p>
                  </div>
                  <button
                    className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                    onClick={() => void refresh()}
                    disabled={loading}
                  >
                    <span>Refresh</span>
                  </button>
                </div>

                {error && (
                  <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}

                {loading ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <SkeletonCard />
                    <SkeletonCard />
                  </div>
                ) : (
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
                      />
                    ))}
                    <CreatePodForm busy={pending.has('new')} onCreate={handleCreate} />
                  </div>
                )}
              </main>
            )}
          </section>

          <aside className="flex flex-col gap-4">
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-500">Agent state</p>
                  <h2 className="mt-1 text-base font-semibold text-slate-950">PodMan signal</h2>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${
                    podManOnline
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                  }`}
                >
                  {podManOnline ? 'online' : 'standby'}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                <SignalRow
                  label="Screen/IDE stream"
                  state={podManOnline ? 'watching' : 'waiting'}
                />
                <SignalRow label="Local git truth" state="scheduled" />
                <SignalRow
                  label="Team memory"
                  state={memory && latestActivity > 0 ? 'learning' : 'ready'}
                />
                <SignalRow label="Urgency routing" state="card first" />
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Intervention model</p>
              <div className="mt-4 space-y-3">
                <TimelineItem
                  title="Observe"
                  text="Live room presence plus screen and git signals."
                />
                <TimelineItem
                  title="Compare"
                  text="Detect same-file, ownership, and stale path risk."
                />
                <TimelineItem
                  title="Route"
                  text="Small card first, Hermes/voice only when urgent."
                />
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Live roster</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {liveNames.length ? (
                  liveNames.map((name) => (
                    <span
                      key={name}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
                    >
                      {name}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-500">No live participants yet.</span>
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  const toneClass =
    tone === 'green'
      ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
      : tone === 'blue'
        ? 'text-blue-700 bg-blue-50 border-blue-200'
        : tone === 'amber'
          ? 'text-amber-700 bg-amber-50 border-amber-200'
          : 'text-slate-700 bg-white border-slate-200';
  return (
    <div className={`rounded-lg border px-3 py-2 shadow-sm ${toneClass}`}>
      <p className="text-[11px] font-medium opacity-70">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function SignalRow({ label, state }: { label: string; state: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-sm text-slate-700">{label}</span>
      <span className="text-xs font-medium text-blue-700">{state}</span>
    </div>
  );
}

function TimelineItem({ title, text }: { title: string; text: string }) {
  return (
    <div className="border-l border-blue-200 pl-3">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      <p className="mt-0.5 text-xs leading-5 text-slate-500">{text}</p>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="h-56 animate-pulse rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="h-5 w-1/2 rounded bg-slate-100" />
      <div className="mt-3 h-3 w-2/3 rounded bg-slate-100" />
      <div className="mt-8 h-24 rounded bg-slate-50" />
    </div>
  );
}
