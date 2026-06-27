import type { Pod } from '@podman/shared';
import { Avatar } from './Avatar.js';

export function PodView({
  team,
  me,
  devMode,
  onLeave,
}: {
  team: Pod;
  me: string;
  devMode: boolean;
  onLeave: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100">{team.name}</h2>
          <p className="text-xs text-slate-500">{team.repo}</p>
        </div>
        <button
          onClick={onLeave}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Leave
        </button>
      </header>

      {devMode && (
        <p className="rounded-md border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
          DEV MODE — LiveKit not configured / insecure context, so screen capture is off.
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        {/* Pod members */}
        <section>
          <h3 className="mb-3 text-sm font-medium text-slate-400">In this pod</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {team.members.map((m) => {
              const isMe = m === me;
              return (
                <div
                  key={m}
                  className={`flex items-center gap-3 rounded-lg border p-3 ${
                    isMe ? 'border-emerald-500/50 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/40'
                  }`}
                >
                  <Avatar name={m} size={36} ring={isMe} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-200">{m}</p>
                    <p className="text-xs text-slate-500">{isMe ? 'you' : 'in pod'}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* PodMan panel */}
        <aside className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">🛰️</span>
            <h3 className="font-semibold text-slate-100">PodMan</h3>
            <span className="ml-auto flex items-center gap-1 text-xs text-emerald-400">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" /> watching
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Watching {team.members.length} screen{team.members.length === 1 ? '' : 's'} for collisions
            before push.
          </p>
          <div className="mt-4 border-t border-slate-800 pt-4">
            <h4 className="mb-2 text-xs font-medium text-slate-400">Interventions</h4>
            <div className="rounded-lg border border-dashed border-slate-800 px-3 py-6 text-center text-xs text-slate-600">
              No collisions detected.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
