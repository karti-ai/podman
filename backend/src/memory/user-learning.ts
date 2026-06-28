import type { Collision, EngineerContext, HermesJob, Pod, UserLearningProfile } from '@podman/shared';
import { getDb, type UserPodContextDoc } from './db.js';

interface EngineerStateDoc {
  podId: string;
  name: string;
  changedFiles?: string[];
  branch?: string | null;
  recentCommit?: string | null;
  gitUpdatedAt?: Date | string;
}

interface ConversationNoteDoc {
  podId: string;
  identity?: string;
  kind?: string;
  note?: string;
  createdAt?: string;
}

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}

function uniq(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const item = value?.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function top(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const item = value.trim();
    if (!item) continue;
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function lowerRegex(values: string[]): RegExp[] {
  return values.map((value) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
}

function noteGoals(notes: ConversationNoteDoc[]): string[] {
  const goalNotes = notes
    .filter((note) => /goal|plan|todo|next|preference|prefers|likes|wants|needs/i.test(`${note.kind} ${note.note}`))
    .map((note) => clean(note.note)?.slice(0, 180))
    .filter(Boolean) as string[];
  return uniq(goalNotes).slice(0, 8);
}

function inferCollaborationStyle(input: {
  contexts: UserPodContextDoc[];
  observations: EngineerContext[];
  collisions: Collision[];
  outcomes: Array<{ accepted?: boolean; wasRealCollision?: boolean }>;
  notes: ConversationNoteDoc[];
  jobs: HermesJob[];
}): string[] {
  const style: string[] = [];
  const actions = input.contexts.map((ctx) => ctx.action);
  const pods = new Set(input.contexts.map((ctx) => ctx.podId));
  if (pods.size > 1) style.push(`Works across ${pods.size} pods and carries context between rooms.`);
  if (actions.filter((action) => action === 'joined_pod').length >= 3)
    style.push('Frequently joins live rooms and collaborates synchronously.');
  if (input.collisions.length > 0)
    style.push(`Has been involved in ${input.collisions.length} coordination risk signals.`);
  const accepted = input.outcomes.filter((outcome) => outcome.accepted).length;
  if (accepted > 0) style.push(`Accepts Hermes help when useful (${accepted} accepted outcomes).`);
  if (input.jobs.length > 0) style.push(`Delegates complex work to Hermes (${input.jobs.length} jobs).`);
  if (input.notes.some((note) => /concise|short|brief/i.test(note.note ?? '')))
    style.push('Prefers concise coordination.');
  return style.slice(0, 8);
}

function inferWorkingStyle(input: {
  observations: EngineerContext[];
  gitStates: EngineerStateDoc[];
}): string[] {
  const style: string[] = [];
  const modes = top(input.observations.map((obs) => obs.mode ?? '').filter(Boolean), 2);
  const activities = top(input.observations.map((obs) => obs.activity ?? '').filter(Boolean), 5);
  const files = top(
    [
      ...input.observations.map((obs) => obs.currentFile ?? ''),
      ...input.gitStates.flatMap((state) => state.changedFiles ?? []),
    ].filter(Boolean),
    6,
  );
  if (modes.length) style.push(`Usually seen in ${modes.join(' and ')} mode.`);
  if (activities.length) style.push(`Common work patterns: ${activities.join(', ')}.`);
  if (files.length) style.push(`Frequently touches ${files.join(', ')}.`);
  return style.slice(0, 8);
}

function inferKnowledge(input: {
  observations: EngineerContext[];
  gitStates: EngineerStateDoc[];
  notes: ConversationNoteDoc[];
}): string[] {
  const topics = top(
    [
      ...input.observations.map((obs) => obs.researchTopic ?? ''),
      ...input.observations.map((obs) => obs.researchSource ?? ''),
      ...input.observations.map((obs) => obs.currentSymbol ?? ''),
      ...input.gitStates.flatMap((state) => state.changedFiles ?? []),
      ...input.notes
        .filter((note) => /learn|knows|expert|worked on|decision/i.test(note.note ?? ''))
        .map((note) => note.note?.slice(0, 120) ?? ''),
    ].filter(Boolean),
    10,
  );
  return topics;
}

export async function buildUserLearningProfile(clerkUserId: string): Promise<UserLearningProfile | null> {
  const db = await getDb();
  const contexts = await db
    .collection<UserPodContextDoc>('user_pod_context')
    .find({ clerkUserId }, { projection: { _id: 0 } })
    .sort({ observedAt: -1 })
    .limit(500)
    .toArray();
  if (!contexts.length) return null;

  const latest = contexts[0];
  const identities = uniq([
    ...contexts.map((ctx) => ctx.memberName),
    ...contexts.map((ctx) => clean(ctx.metadata?.identity)),
    ...contexts.map((ctx) => clean(ctx.metadata?.email)),
  ]);
  const email = clean(latest?.metadata?.email) ?? identities.find((item) => item.includes('@'));
  const displayName = latest?.memberName ?? identities.find((item) => !item.includes('@')) ?? email;
  const imageUrl = clean(latest?.metadata?.imageUrl);
  const identityRegex = lowerRegex(identities);

  const podIds = uniq(contexts.map((ctx) => ctx.podId));
  const [pods, observations, gitStates, collisions, outcomes, notes, jobs] = await Promise.all([
    db
      .collection<Pod>('pods')
      .find({ id: { $in: podIds } }, { projection: { _id: 0 } })
      .toArray(),
    db
      .collection<EngineerContext>('observations')
      .find({ engineerId: { $in: identities } }, { projection: { _id: 0, screenshotDataUrl: 0 } })
      .sort({ observedAt: -1 })
      .limit(500)
      .toArray(),
    db
      .collection<EngineerStateDoc>('engineer_states')
      .find({ name: { $in: identityRegex } }, { projection: { _id: 0 } })
      .limit(100)
      .toArray(),
    db
      .collection<Collision>('collisions')
      .find({ engineers: { $in: identities } }, { projection: { _id: 0, embedding: 0 } })
      .sort({ detectedAt: -1 })
      .limit(100)
      .toArray(),
    db
      .collection<{ podId: string; accepted?: boolean; wasRealCollision?: boolean }>('outcomes')
      .find({ podId: { $in: podIds } }, { projection: { _id: 0 } })
      .sort({ recordedAt: -1 })
      .limit(100)
      .toArray(),
    db
      .collection<ConversationNoteDoc>('conversation_notes')
      .find({ identity: { $in: identities } }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray(),
    db
      .collection<HermesJob>('hermes_jobs')
      .find({ identity: { $in: identities } }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray(),
  ]);

  const podById = new Map(pods.map((pod) => [pod.id, pod]));
  const podsSummary = podIds.map((podId) => {
    const rows = contexts.filter((ctx) => ctx.podId === podId);
    const sorted = [...rows].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
    return {
      podId,
      podName: podById.get(podId)?.name,
      visits: rows.filter((row) => row.action === 'joined_pod').length,
      actions: top(rows.map((row) => row.action), 6),
      firstSeenAt: toIso(sorted[0]?.observedAt),
      lastSeenAt: toIso(sorted.at(-1)?.observedAt),
    };
  });

  const profile: UserLearningProfile = {
    clerkUserId,
    displayName,
    email,
    imageUrl,
    identities,
    pods: podsSummary,
    recentWork: observations.slice(0, 20).map((obs) => ({
      podId: obs.podId,
      file: obs.currentFile,
      activity: obs.activity ?? obs.researchTopic,
      at: obs.observedAt,
    })),
    collaborationStyle: inferCollaborationStyle({ contexts, observations, collisions, outcomes, notes, jobs }),
    workingStyle: inferWorkingStyle({ observations, gitStates }),
    goals: noteGoals(notes),
    knowledge: inferKnowledge({ observations, gitStates, notes }),
    counts: {
      podActions: contexts.length,
      observations: observations.length,
      gitStates: gitStates.length,
      collisionsInvolved: collisions.length,
      outcomes: outcomes.length,
      conversationNotes: notes.length,
      hermesJobs: jobs.length,
    },
    updatedAt: new Date().toISOString(),
  };

  await db
    .collection<UserLearningProfile>('user_learning_profiles')
    .updateOne({ clerkUserId }, { $set: profile }, { upsert: true });
  return profile;
}

export async function refreshUserLearningProfiles(): Promise<UserLearningProfile[]> {
  const db = await getDb();
  const ids = await db.collection<UserPodContextDoc>('user_pod_context').distinct('clerkUserId');
  const profiles = await Promise.all(ids.map((id) => buildUserLearningProfile(String(id))));
  return profiles.filter(Boolean) as UserLearningProfile[];
}

export async function getUserLearningProfileByIdentity(identity: string): Promise<UserLearningProfile | null> {
  const db = await getDb();
  const direct = await db
    .collection<UserLearningProfile>('user_learning_profiles')
    .findOne({ identities: { $regex: `^${identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }, { projection: { _id: 0 } });
  if (direct) return direct;

  const context = await db
    .collection<UserPodContextDoc>('user_pod_context')
    .findOne(
      {
        $or: [
          { memberName: { $regex: `^${identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
          { 'metadata.identity': { $regex: `^${identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
        ],
      },
      { sort: { observedAt: -1 }, projection: { _id: 0 } },
    );
  return context ? buildUserLearningProfile(context.clerkUserId) : null;
}

export async function listUserLearningProfiles(): Promise<UserLearningProfile[]> {
  const db = await getDb();
  return db
    .collection<UserLearningProfile>('user_learning_profiles')
    .find({}, { projection: { _id: 0 } })
    .sort({ updatedAt: -1 })
    .toArray();
}
