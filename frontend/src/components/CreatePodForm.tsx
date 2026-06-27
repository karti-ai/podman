import { useState } from 'react';
import type { PodInput } from '@podman/shared';

export function CreatePodForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (input: PodInput) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [repo, setRepo] = useState('karti-ai/podman');
  const [description, setDescription] = useState('');
  const [firstMember, setFirstMember] = useState('');

  async function submit() {
    if (!name.trim()) return;
    try {
      await onCreate({
        name: name.trim(),
        repo: repo.trim(),
        description: description.trim(),
        members: firstMember.trim() ? [firstMember.trim()] : [],
      });
      // only clear + close on success; on error keep the user's input
      setName('');
      setDescription('');
      setFirstMember('');
      setOpen(false);
    } catch {
      /* error surfaced by parent; keep inputs so nothing is lost */
    }
  }

  if (!open) {
    return (
      <button
        className="flex min-h-[140px] items-center justify-center rounded-xl border border-dashed border-slate-700 text-slate-400 hover:border-emerald-600 hover:text-emerald-400"
        onClick={() => setOpen(true)}
      >
        + New Pod
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-emerald-700/50 bg-slate-900/50 p-4">
      <h3 className="font-semibold text-slate-100">New Pod</h3>
      <input
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm"
        placeholder="Pod name (e.g. Mobile Pod)"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm"
        placeholder="owner/repo"
        value={repo}
        onChange={(e) => setRepo(e.target.value)}
      />
      <input
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <input
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm"
        placeholder="Your name (optional first member)"
        value={firstMember}
        onChange={(e) => setFirstMember(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
          onClick={submit}
          disabled={busy || !name.trim()}
        >
          Create
        </button>
        <button
          className="rounded-md border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
