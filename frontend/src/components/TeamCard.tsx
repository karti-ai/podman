import type { DemoTeam } from '../lib/teams.js';
import { Avatar } from './Avatar.js';

export function TeamCard({
  team,
  selected,
  onSelect,
}: {
  team: DemoTeam;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(team.id)}
      className={`flex w-full flex-col gap-3 rounded-xl border p-4 text-left transition ${
        selected
          ? 'border-emerald-500 bg-emerald-950/30 ring-1 ring-emerald-500/40'
          : 'border-slate-700 bg-slate-900/50 hover:border-slate-500 hover:bg-slate-900'
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-100">{team.name}</h3>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
          {team.members.length} members
        </span>
      </div>
      <p className="text-xs text-slate-500">{team.repo}</p>
      <p className="text-sm text-slate-300">{team.description}</p>
      <div className="flex -space-x-2 pt-1">
        {team.members.map((m) => (
          <Avatar key={m} name={m} size={28} />
        ))}
      </div>
    </button>
  );
}
