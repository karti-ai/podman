import { useMemo, useState } from 'react';
import type { Room } from 'livekit-client';
import { joinPod } from './lib/pod.js';
import { TEAMS } from './lib/teams.js';

export default function App() {
  const [teamId, setTeamId] = useState(TEAMS[0]!.id);
  const team = useMemo(() => TEAMS.find((t) => t.id === teamId) ?? TEAMS[0]!, [teamId]);
  const [member, setMember] = useState(team.members[0]!);
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  function handleTeamChange(id: string) {
    setTeamId(id);
    const next = TEAMS.find((t) => t.id === id);
    if (next) setMember(next.members[0]!);
  }

  async function handleJoin() {
    setError(null);
    setConnecting(true);
    try {
      const identity = `${member}-${Math.random().toString(36).slice(2, 7)}`;
      setRoom(await joinPod(team.id, identity, member));
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
          <p className="font-medium text-emerald-400">
            {member} connected to “{team.name}”.
          </p>
          <p className="mt-1 text-sm text-slate-400">Sharing screen + mic. PodMan is watching.</p>
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-slate-400">
            Team
            <select
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-100"
              value={teamId}
              onChange={(e) => handleTeamChange(e.target.value)}
            >
              {TEAMS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.repo}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-400">
            You
            <select
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-100"
              value={member}
              onChange={(e) => setMember(e.target.value)}
            >
              {team.members.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <button
            className="rounded-md bg-emerald-600 px-3 py-2 font-medium hover:bg-emerald-500 disabled:opacity-50"
            onClick={handleJoin}
            disabled={connecting}
          >
            {connecting ? 'Joining…' : `Join ${team.name} as ${member}`}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </section>
      )}
    </main>
  );
}
