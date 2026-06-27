import { useEffect, useState } from 'react';
import type { Room } from 'livekit-client';
import type { Pod, PodInput } from '@podman/shared';
import { joinPod } from './lib/pod.js';
import * as api from './lib/api.js';
import { PodCard } from './components/PodCard.js';
import { CreatePodForm } from './components/CreatePodForm.js';
import { PodView } from './components/PodView.js';

export default function App() {
  const [pods, setPods] = useState<Pod[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // join state
  const [joinedPod, setJoinedPod] = useState<Pod | null>(null);
  const [member, setMember] = useState('');
  const [devMode, setDevMode] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);

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

  useEffect(() => {
    void refresh();
  }, []);

  /** Run a mutation, reflect the result in local state, surface errors. */
  async function mutate(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const upsert = (p: Pod) => setPods((cur) => cur.map((x) => (x.id === p.id ? p : x)));

  const handleCreate = (input: PodInput) =>
    mutate(async () => {
      const created = await api.createPod(input);
      setPods((cur) => [...cur, created]);
    });
  const handleUpdate = (id: string, patch: PodInput) =>
    mutate(async () => upsert(await api.updatePod(id, patch)));
  const handleDelete = (id: string) =>
    mutate(async () => {
      await api.deletePod(id);
      setPods((cur) => cur.filter((x) => x.id !== id));
    });
  const handleAddMember = (id: string, name: string) =>
    mutate(async () => upsert(await api.addMember(id, name)));
  const handleRemoveMember = (id: string, name: string) =>
    mutate(async () => upsert(await api.removeMember(id, name)));

  async function handleJoin(pod: Pod, who: string) {
    setBusy(true);
    setError(null);
    try {
      const identity = `${who}-${Math.random().toString(36).slice(2, 7)}`;
      const result = await joinPod(pod.id, identity, who);
      setRoom(result.room);
      setDevMode(result.mode === 'dev');
      setMember(who);
      setJoinedPod(pod);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleLeave() {
    room?.disconnect();
    setRoom(null);
    setJoinedPod(null);
  }

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
        <PodView team={joinedPod} me={member} devMode={devMode} onLeave={handleLeave} />
      ) : (
        <main className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-400">
              Pods {loading ? '…' : `(${pods.length})`}
            </h2>
            <button
              className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
              onClick={() => void refresh()}
              disabled={loading}
            >
              ↻ Refresh
            </button>
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
                  busy={busy}
                  onJoin={handleJoin}
                  onAddMember={handleAddMember}
                  onRemoveMember={handleRemoveMember}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                />
              ))}
              <CreatePodForm busy={busy} onCreate={handleCreate} />
            </div>
          )}
        </main>
      )}
    </div>
  );
}
