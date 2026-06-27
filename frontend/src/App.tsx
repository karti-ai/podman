import { useState } from 'react';
import type { Room } from 'livekit-client';
import { joinPod } from './lib/pod.js';

export default function App() {
  const [podId, setPodId] = useState('demo-pod');
  const [name, setName] = useState('');
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function handleJoin() {
    setError(null);
    setConnecting(true);
    try {
      const identity = `${name || 'engineer'}-${Math.random().toString(36).slice(2, 7)}`;
      setRoom(await joinPod(podId, identity, name || identity));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="text-3xl font-bold">🛰️ PodMan</h1>
        <p className="text-sm text-slate-400">
          Join a pod and share your screen — PodMan watches for collisions before you push.
        </p>
      </header>

      {room ? (
        <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
          <p className="font-medium text-emerald-400">Connected to “{podId}”.</p>
          <p className="mt-1 text-sm text-slate-400">Sharing screen + mic. PodMan is watching.</p>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <input
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2"
            placeholder="Pod id"
            value={podId}
            onChange={(e) => setPodId(e.target.value)}
          />
          <button
            className="rounded-md bg-emerald-600 px-3 py-2 font-medium hover:bg-emerald-500 disabled:opacity-50"
            onClick={handleJoin}
            disabled={connecting || !podId}
          >
            {connecting ? 'Joining…' : 'Join pod'}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </section>
      )}
    </main>
  );
}
