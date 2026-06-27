import { useMemo, useState } from 'react';
import type { Room } from 'livekit-client';
import { joinPod } from './lib/pod.js';
import { TEAMS, teamById } from './lib/teams.js';
import { TeamCard } from './components/TeamCard.js';
import { PodView } from './components/PodView.js';

export default function App() {
  const [teamId, setTeamId] = useState(TEAMS[0]!.id);
  const team = useMemo(() => teamById(teamId), [teamId]);
  const [member, setMember] = useState(team.members[0]!);
  const [room, setRoom] = useState<Room | null>(null);
  const [joined, setJoined] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  function handleTeamChange(id: string) {
    setTeamId(id);
    const next = teamById(id);
    if (!next.members.includes(member)) setMember(next.members[0]!);
  }

  async function handleJoin() {
    setError(null);
    setConnecting(true);
    try {
      const identity = `${member}-${Math.random().toString(36).slice(2, 7)}`;
      const result = await joinPod(team.id, identity, member);
      setRoom(result.room);
      setDevMode(result.mode === 'dev');
      setJoined(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  function handleLeave() {
    room?.disconnect();
    setRoom(null);
    setJoined(false);
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex items-center gap-3">
        <span className="text-3xl">🛰️</span>
        <div>
          <h1 className="text-2xl font-bold text-slate-100">PodMan</h1>
          <p className="text-sm text-slate-400">
            The teammate that sees what git can&apos;t — collisions caught before you push.
          </p>
        </div>
      </header>

      {joined ? (
        <PodView team={team} me={member} devMode={devMode} onLeave={handleLeave} />
      ) : (
        <main className="flex flex-col gap-6">
          <section>
            <h2 className="mb-3 text-sm font-medium text-slate-400">Pick a team</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {TEAMS.map((t) => (
                <TeamCard
                  key={t.id}
                  team={t}
                  selected={t.id === teamId}
                  onSelect={handleTeamChange}
                />
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-sm text-slate-400">
              Join “{team.name}” as
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
              className="rounded-md bg-emerald-600 px-5 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              onClick={handleJoin}
              disabled={connecting}
            >
              {connecting ? 'Joining…' : 'Join pod'}
            </button>
          </section>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </main>
      )}
    </div>
  );
}
