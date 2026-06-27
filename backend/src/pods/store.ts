import type { Pod, PodInput } from '@podman/shared';
import { collections } from '../memory/db.js';

const NO_ID = { projection: { _id: 0 } } as const;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Trim, drop empties, de-dupe case-insensitively while preserving order. */
function cleanMembers(members: unknown): string[] {
  if (!Array.isArray(members)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of members) {
    const name = String(raw).trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

function now(): string {
  return new Date().toISOString();
}

export async function listPods(): Promise<Pod[]> {
  const c = await collections();
  return c.pods.find({}, NO_ID).sort({ createdAt: 1 }).toArray();
}

export async function getPod(id: string): Promise<Pod | null> {
  const c = await collections();
  return c.pods.findOne({ id }, NO_ID);
}

async function uniqueSlug(base: string): Promise<string> {
  const c = await collections();
  const root = base || 'pod';
  let slug = root;
  let n = 2;
  while (await c.pods.findOne({ id: slug })) slug = `${root}-${n++}`;
  return slug;
}

export async function createPod(input: PodInput): Promise<Pod> {
  const name = (input.name ?? '').trim();
  if (!name) throw new Error('name is required');
  const c = await collections();
  const ts = now();
  const pod: Pod = {
    id: await uniqueSlug(slugify(name)),
    name,
    repo: (input.repo ?? '').trim(),
    description: input.description?.trim() || undefined,
    members: cleanMembers(input.members),
    createdAt: ts,
    updatedAt: ts,
  };
  await c.pods.insertOne({ ...pod });
  return pod;
}

export async function updatePod(id: string, patch: PodInput): Promise<Pod | null> {
  const set: Partial<Pod> = { updatedAt: now() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error('name cannot be empty');
    set.name = name;
  }
  if (patch.repo !== undefined) set.repo = patch.repo.trim();
  if (patch.description !== undefined) set.description = patch.description.trim() || undefined;
  if (patch.members !== undefined) set.members = cleanMembers(patch.members);
  const c = await collections();
  const updated = await c.pods.findOneAndUpdate(
    { id },
    { $set: set },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  return updated ?? null;
}

export async function deletePod(id: string): Promise<boolean> {
  const c = await collections();
  const r = await c.pods.deleteOne({ id });
  return r.deletedCount > 0;
}

async function setMembers(id: string, members: string[]): Promise<Pod | null> {
  const c = await collections();
  const updated = await c.pods.findOneAndUpdate(
    { id },
    { $set: { members, updatedAt: now() } },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  return updated ?? null;
}

export async function addMember(id: string, rawName: string): Promise<Pod | null> {
  const name = rawName.trim();
  if (!name) throw new Error('member name is required');
  const pod = await getPod(id);
  if (!pod) return null;
  if (pod.members.some((m) => m.toLowerCase() === name.toLowerCase())) return pod;
  return setMembers(id, [...pod.members, name]);
}

export async function removeMember(id: string, rawName: string): Promise<Pod | null> {
  const name = rawName.trim().toLowerCase();
  const pod = await getPod(id);
  if (!pod) return null;
  return setMembers(
    id,
    pod.members.filter((m) => m.toLowerCase() !== name),
  );
}

/** Insert the default pods once, if the collection is empty. */
export async function seedDefaultPods(): Promise<void> {
  const c = await collections();
  if ((await c.pods.estimatedDocumentCount()) > 0) return;
  const ts = now();
  const defaults: Pod[] = [
    {
      id: 'demo-pod',
      name: 'Demo Pod',
      repo: 'karti-ai/podman',
      description: 'The full crew — used for the live demo.',
      members: ['Karti', 'Yahya', 'Ramis', 'Zander', 'Shakthi'],
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: 'frontend-pod',
      name: 'Frontend Pod',
      repo: 'karti-ai/podman',
      description: 'PWA, capture, and PodMan card UI.',
      members: ['Karti', 'Zander'],
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: 'backend-pod',
      name: 'Backend Pod',
      repo: 'karti-ai/podman',
      description: 'LiveKit agent, vision, collision detector.',
      members: ['Yahya', 'Ramis'],
      createdAt: ts,
      updatedAt: ts,
    },
  ];
  await c.pods.insertMany(defaults.map((p) => ({ ...p })));
  console.log('[pods] seeded default pods');
}
