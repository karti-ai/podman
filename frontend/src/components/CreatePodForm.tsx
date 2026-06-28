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
        className="group flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-slate-600 shadow-sm transition hover:border-blue-300 hover:bg-blue-50/40"
        onClick={() => setOpen(true)}
      >
        <span className="grid h-11 w-11 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-2xl font-light text-slate-900 transition group-hover:border-blue-200 group-hover:bg-blue-50">
          +
        </span>
        <span className="text-base font-semibold text-slate-950">New pod</span>
        <span className="max-w-[18rem] text-sm leading-5 text-slate-500">
          Add a workspace for a feature team, spike, or demo flow.
        </span>
      </button>
    );
  }

  return (
    <div className="flex min-h-[280px] flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h3 className="font-semibold text-slate-950">New pod</h3>
        <p className="text-xs text-slate-500">Name, repository, and first member.</p>
      </div>
      <input
        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-400"
        placeholder="Pod name (e.g. Mobile Pod)"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-400"
        placeholder="owner/repo"
        value={repo}
        onChange={(e) => setRepo(e.target.value)}
      />
      <input
        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-400"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <input
        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-400"
        placeholder="Your name (optional first member)"
        value={firstMember}
        onChange={(e) => setFirstMember(e.target.value)}
      />
      <div className="mt-auto flex gap-2">
        <button
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          onClick={submit}
          disabled={busy || !name.trim()}
        >
          Create
        </button>
        <button
          className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
