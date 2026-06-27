import type { Pod, PodInput } from '@podman/shared';
import { collections } from '../memory/db.js';

const NO_ID = { projection: { _id: 0 } } as const;

const MAX_NAME = 120;
const MAX_REPO = 140;
const MAX_DESCRIPTION = 2000;
const MAX_MEMBERS = 50;
const MAX_MEMBER_LEN = 80;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Validate + normalize a string field. Throws (-> 400) on type/length errors. */
function str(value: unknown, field: string, max: number, required = false): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new Error(`${field} is required`);
  if (trimmed.length > max) throw new Error(`${field} too long (max ${max})`);
  return trimmed;
}

/** Validate, trim, length-cap, de-dupe (case-insensitive), and limit count. */
function cleanMembers(members: unknown): string[] {
  if (members === undefined || members === null) return [];
  if (!Array.isArray(members)) throw new Error('members must be an array');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of members) {
    if (typeof raw !== 'string') throw new Error('member names must be strings');
    const name = raw.trim();
    if (name.length > MAX_MEMBER_LEN) throw new Error(`member name too long (max ${MAX_MEMBER_LEN})`);
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  if (out.length > MAX_MEMBERS) throw new Error(`too many members (max ${MAX_MEMBERS})`);
  return out;
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
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

export async function createPod(input: PodInput): Promise<Pod> {
  const name = str(input.name, 'name', MAX_NAME, true)!;
  const repo = str(input.repo, 'repo', MAX_REPO) ?? '';
  const description = str(input.description, 'description', MAX_DESCRIPTION);
  const members = cleanMembers(input.members);
  const c = await collections();
  const ts = now();
  const base = slugify(name) || 'pod';

  // Atomic create: let the unique index arbitrate slug collisions. On a
  // duplicate-key error, bump the suffix and retry — no check-then-insert race.
  for (let suffix = 1; suffix <= MAX_MEMBERS + 50; suffix++) {
    const pod: Pod = {
      id: suffix === 1 ? base : `${base}-${suffix}`,
      name,
      repo,
      description: description || undefined,
      members,
      createdAt: ts,
      updatedAt: ts,
    };
    try {
      await c.pods.insertOne({ ...pod });
      return pod;
    } catch (err) {
      if (isDuplicateKey(err)) continue;
      throw err;
    }
  }
  throw new Error('could not allocate a unique pod id');
}

export async function updatePod(id: string, patch: PodInput): Promise<Pod | null> {
  const set: Partial<Pod> = { updatedAt: now() };
  if (patch.name !== undefined) {
    const name = str(patch.name, 'name', MAX_NAME);
    if (!name) throw new Error('name cannot be empty');
    set.name = name;
  }
  if (patch.repo !== undefined) set.repo = str(patch.repo, 'repo', MAX_REPO) ?? '';
  if (patch.description !== undefined) {
    set.description = str(patch.description, 'description', MAX_DESCRIPTION) || undefined;
  }
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

export async function addMember(id: string, rawName: unknown): Promise<Pod | null> {
  if (typeof rawName !== 'string') throw new Error('member name must be a string');
  const name = rawName.trim();
  if (!name) throw new Error('member name is required');
  if (name.length > MAX_MEMBER_LEN) throw new Error(`member name too long (max ${MAX_MEMBER_LEN})`);
  const pod = await getPod(id);
  if (!pod) return null;
  if (pod.members.some((m) => m.toLowerCase() === name.toLowerCase())) return pod;
  if (pod.members.length >= MAX_MEMBERS) throw new Error(`too many members (max ${MAX_MEMBERS})`);
  return setMembers(id, [...pod.members, name]);
}

export async function removeMember(id: string, rawName: string): Promise<Pod | null> {
  const name = String(rawName).trim().toLowerCase();
  const pod = await getPod(id);
  if (!pod) return null;
  const filtered = pod.members.filter((m) => m.toLowerCase() !== name);
  if (filtered.length === pod.members.length) return pod; // no-op: don't write / bump updatedAt
  return setMembers(id, filtered);
}

/**
 * Seed the default pods into a fresh DB. Idempotent and race-safe: gated on an
 * empty collection, and uses per-doc upserts so concurrent startups can't
 * create duplicates. Won't resurrect a default a user later deletes.
 */
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
  await Promise.all(
    defaults.map((p) => c.pods.updateOne({ id: p.id }, { $setOnInsert: p }, { upsert: true })),
  );
  console.log('[pods] seeded default pods');
}
