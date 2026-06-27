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

  function saveEdit() {
    onUpdate(pod.id, {
      name: draft.name?.trim(),
      repo: draft.repo?.trim(),
      description: draft.description?.trim(),
    });
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-700 bg-slate-900/50 p-4">
      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm"
            value={draft.name ?? ''}
            placeholder="Pod name"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm"
            value={draft.repo ?? ''}
            placeholder="owner/repo"
            onChange={(e) => setDraft({ ...draft, repo: e.target.value })}
          />
          <input
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm"
            value={draft.description ?? ''}
            placeholder="Description"
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <div className="flex gap-2">
            <button
              className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
              onClick={saveEdit}
              disabled={busy}
            >
              Save
            </button>
            <button
              className="rounded-md border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-100">{pod.name}</h3>
              {presence.length > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-950/60 px-2 py-0.5 text-xs text-emerald-400">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {presence.length} in room
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">{pod.repo || 'no repo set'}</p>
            {pod.description && <p className="mt-1 text-sm text-slate-300">{pod.description}</p>}
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              onClick={() => {
                setDraft({ name: pod.name, repo: pod.repo, description: pod.description ?? '' });
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button
              className="rounded-md border border-red-900/60 px-2 py-1 text-xs text-red-400 hover:bg-red-950/40 disabled:opacity-50"
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

      {/* Members — click your name to join */}
      <div className="flex flex-col gap-2">
        <p className="text-xs text-slate-500">Click your name to join:</p>
        <div className="flex flex-wrap gap-1.5">
          {pod.members.length === 0 && (
            <span className="text-xs text-slate-600">No members yet — add your name below.</span>
          )}
          {pod.members.map((m) => (
            <span
              key={m}
              className="flex items-center overflow-hidden rounded-full border border-slate-700 bg-slate-800"
            >
              <button
                className="flex items-center gap-1.5 py-0.5 pl-0.5 pr-2 text-sm text-slate-100 hover:bg-emerald-900/40 disabled:opacity-50"
                onClick={() => onJoin(pod, m)}
                disabled={busy}
                title={`Join as ${m}`}
              >
                <Avatar name={m} size={22} />
                {m}
                {inRoom(m) && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
              </button>
              <button
                className="px-1.5 text-slate-500 hover:bg-red-950/40 hover:text-red-400 disabled:opacity-50"
                onClick={() => onRemoveMember(pod.id, m)}
                disabled={busy}
                title={`Remove ${m}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>

        {/* Add your name (and join) */}
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm"
            placeholder="Add your name…"
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
            className="rounded-md border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-50"
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
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
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
