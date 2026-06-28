import { useEffect, useState } from 'react';
import type { Room } from 'livekit-client';
import type { Pod, PodInput } from '@podman/shared';
import { joinPod } from './lib/pod.js';
import * as api from './lib/api.js';
import { PodCard } from './components/PodCard.js';
import { CreatePodForm } from './components/CreatePodForm.js';
import { PodView } from './components/PodView.js';
import { GraphView } from './components/GraphView.js';

const SESSION_KEY = 'podman.session';

export default function App() {
  const [pods, setPods] = useState<Pod[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [presence, setPresence] = useState<Record<string, string[]>>({});

  // join state — keep the id and derive the pod so it never goes stale
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
      setPods(await api.listPods());
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
    const identity = `${who}-${Math.random().toString(36).slice(2, 7)}`;
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
        const p = await api.getPresence();
        if (alive) setPresence(p);
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
  }

  const showReconnecting = restoring || (joinedPodId !== null && joinedPod === null);

  return (
    <div className="mx-auto min-h-screen w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex items-center gap-3">
        <span className="text-3xl">🛰️</span>
        <div>
          <h1 className="text-2xl font-bold text-slate-100">PodMan</h1>
          <p className="text-sm text-slate-400">
            The teammate that sees what git can&apos;t — collisions caught before you push.
          </p>
        </div>
      </header>

      {joinedPod ? (
        <PodView
          team={joinedPod}
          me={member}
          room={room}
          devMode={devMode}
          onLeave={handleLeave}
        />
      ) : showReconnecting ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-slate-400">Reconnecting to your pod…</p>
          <button
            className="text-xs text-slate-500 hover:text-slate-300"
            onClick={handleLeave}
          >
            Cancel
          </button>
        </div>
      ) : graphPodId ? (
        <GraphView podId={graphPodId} onClose={() => setGraphPodId(null)} />
      ) : (
        <main className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-400">
              Pods {loading ? '…' : `(${pods.length})`}
            </h2>
            <div className="flex items-center gap-3">
              <button
                className="text-xs text-slate-400 hover:text-slate-200"
                onClick={() => setGraphPodId(pods[0]?.id ?? 'demo-pod')}
              >
                ◇ Team memory
              </button>
              <button
                className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
                onClick={() => void refresh()}
                disabled={loading}
              >
                ↻ Refresh
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          {loading ? (
            <p className="text-sm text-slate-500">Loading pods…</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
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
    </div>
  );
}
