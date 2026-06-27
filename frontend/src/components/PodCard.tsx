import { useState } from 'react';
import type { Pod, PodInput } from '@podman/shared';
import { Avatar } from './Avatar.js';

export function PodCard({
  pod,
  busy,
  onJoin,
  onAddMember,
  onRemoveMember,
  onUpdate,
  onDelete,
}: {
  pod: Pod;
  busy: boolean;
  onJoin: (pod: Pod, member: string) => void;
  onAddMember: (id: string, name: string) => void;
  onRemoveMember: (id: string, name: string) => void;
  onUpdate: (id: string, patch: PodInput) => void;
  onDelete: (id: string) => void;
}) {
  const [newMember, setNewMember] = useState('');
  const [joinAs, setJoinAs] = useState(pod.members[0] ?? '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PodInput>({
    name: pod.name,
    repo: pod.repo,
    description: pod.description ?? '',
  });

  // keep joinAs valid as members change
  const joinMember = pod.members.includes(joinAs) ? joinAs : (pod.members[0] ?? '');

  function add() {
    const name = newMember.trim();
    if (!name) return;
    onAddMember(pod.id, name);
    setNewMember('');
  }

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
            <h3 className="font-semibold text-slate-100">{pod.name}</h3>
            <p className="text-xs text-slate-500">{pod.repo || 'no repo set'}</p>
            {pod.description && <p className="mt-1 text-sm text-slate-300">{pod.description}</p>}
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              title="Edit pod"
              className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              onClick={() => {
                setDraft({ name: pod.name, repo: pod.repo, description: pod.description ?? '' });
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button
              title="Delete pod"
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

      {/* Members */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {pod.members.length === 0 && (
            <span className="text-xs text-slate-600">No members yet.</span>
          )}
          {pod.members.map((m) => (
            <span
              key={m}
              className="flex items-center gap-1.5 rounded-full bg-slate-800 py-0.5 pl-0.5 pr-2 text-sm text-slate-200"
            >
              <Avatar name={m} size={22} />
              {m}
              <button
                title={`Remove ${m}`}
                className="ml-0.5 text-slate-500 hover:text-red-400"
                onClick={() => onRemoveMember(pod.id, m)}
                disabled={busy}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm"
            placeholder="Add your name…"
            value={newMember}
            onChange={(e) => setNewMember(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button
            className="rounded-md border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-50"
            onClick={add}
            disabled={busy || !newMember.trim()}
          >
            Add
          </button>
        </div>
      </div>

      {/* Join */}
      <div className="flex gap-2 border-t border-slate-800 pt-3">
        <select
          className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 disabled:opacity-50"
          value={joinMember}
          onChange={(e) => setJoinAs(e.target.value)}
          disabled={pod.members.length === 0}
        >
          {pod.members.length === 0 ? (
            <option>add a member first</option>
          ) : (
            pod.members.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))
          )}
        </select>
        <button
          className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
          onClick={() => onJoin(pod, joinMember)}
          disabled={busy || pod.members.length === 0}
        >
          Join
        </button>
      </div>
    </div>
  );
}
