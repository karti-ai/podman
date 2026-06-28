import { useState } from 'react';
import type { Pod, PodInput } from '@podman/shared';
import { Avatar } from './Avatar.js';

export function PodCard({
  pod,
  busy,
  presence,
  onJoin,
  onAddAndJoin,
  onAddMember,
  onRemoveMember,
  onUpdate,
  onDelete,
}: {
  pod: Pod;
  busy: boolean;
  presence: string[];
  onJoin: (pod: Pod, member: string) => void;
  onAddAndJoin: (pod: Pod, name: string) => void;
  onAddMember: (id: string, name: string) => void;
  onRemoveMember: (id: string, name: string) => void;
  onUpdate: (id: string, patch: PodInput) => void;
  onDelete: (id: string) => void;
}) {
  const [newMember, setNewMember] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PodInput>({
    name: pod.name,
    repo: pod.repo,
    description: pod.description ?? '',
  });

  const inRoom = (name: string) => presence.some((p) => p.toLowerCase() === name.toLowerCase());
  const active = presence.length > 0;
  const memberCount = pod.members.length;

  function saveEdit() {
    onUpdate(pod.id, {
      name: draft.name?.trim(),
      repo: draft.repo?.trim(),
      description: draft.description?.trim(),
    });
    setEditing(false);
  }

  return (
    <div className="group relative flex min-h-[280px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <div
        className={`absolute inset-x-0 top-0 h-1 ${active ? 'bg-emerald-500' : 'bg-slate-200'}`}
      />
      {editing ? (
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-950">Edit pod</h3>
            <p className="text-xs text-slate-500">Name, repository, and summary.</p>
          </div>
          <input
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-400"
            value={draft.name ?? ''}
            placeholder="Pod name"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-400"
            value={draft.repo ?? ''}
            placeholder="owner/repo"
            onChange={(e) => setDraft({ ...draft, repo: e.target.value })}
          />
          <input
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-400"
            value={draft.description ?? ''}
            placeholder="Description"
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <div className="flex gap-2">
            <button
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              onClick={saveEdit}
              disabled={busy}
            >
              Save
            </button>
            <button
              className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-semibold text-slate-950">{pod.name}</h3>
              {presence.length > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {presence.length} live
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">{pod.repo || 'no repo set'}</p>
            {pod.description && (
              <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm leading-5 text-slate-700">
                {pod.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setDraft({ name: pod.name, repo: pod.repo, description: pod.description ?? '' });
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button
              className="rounded-md border border-red-200 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
              onClick={() => {
                if (confirm(`Delete pod “${pod.name}”?`)) onDelete(pod.id);
              }}
              disabled={busy}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Members" value={memberCount} />
        <Stat label="Live" value={presence.length} />
        <Stat label="Mode" value={active ? 'hot' : 'idle'} />
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-slate-500">Roster</p>
          <p className="text-xs text-slate-500">Members</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pod.members.length === 0 && (
            <span className="text-xs text-slate-600">No members yet — add your name below.</span>
          )}
          {pod.members.map((m) => (
            <span
              key={m}
              className="flex items-center overflow-hidden rounded-full border border-slate-200 bg-slate-50"
            >
              <button
                className="flex min-h-8 items-center gap-1.5 py-0.5 pl-0.5 pr-2 text-sm text-slate-800 hover:bg-emerald-50 disabled:opacity-50"
                onClick={() => onJoin(pod, m)}
                disabled={busy}
                title={`Join as ${m}`}
              >
                <Avatar name={m} size={22} />
                {m}
                {inRoom(m) && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
              </button>
              <button
                className="min-h-8 px-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                onClick={() => onRemoveMember(pod.id, m)}
                disabled={busy}
                title={`Remove ${m}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>

        <div className="mt-auto grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input
            className="min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-400"
            placeholder="Add your name..."
            value={newMember}
            onChange={(e) => setNewMember(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newMember.trim()) {
                onAddAndJoin(pod, newMember.trim());
                setNewMember('');
              }
            }}
          />
          <button
            className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => {
              onAddMember(pod.id, newMember.trim());
              setNewMember('');
            }}
            disabled={busy || !newMember.trim()}
            title="Add to roster without joining"
          >
            Add
          </button>
          <button
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            onClick={() => {
              onAddAndJoin(pod, newMember.trim());
              setNewMember('');
            }}
            disabled={busy || !newMember.trim()}
            title="Add your name and join the room"
          >
            Join
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
      <p className="text-[10px] font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}
