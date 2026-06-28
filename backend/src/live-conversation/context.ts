import { getDb } from '../memory/db.js';
import { getMemberWorkHistory } from '../activity/member-history.js';
import {
  buildUserLearningProfile,
  getUserLearningProfileByIdentity,
} from '../memory/user-learning.js';

const DEFAULT_LIMIT = 8;

function sinceIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export async function getLiveConversationContext(podId: string, identity: string) {
  const db = await getDb();
  const since = sinceIso(12);
  const [pod, history, gitState, collisions, interventions, outcomes, userLearningProfile] =
    await Promise.all([
    db.collection('pods').findOne({ id: podId }, { projection: { _id: 0 } }),
    getMemberWorkHistory(podId, identity, { hours: 24, limit: 30 }).catch(() => null),
    db.collection('engineer_states').findOne(
      { podId, name: identity },
      {
        projection: {
          _id: 0,
          name: 1,
          branch: 1,
          changedFiles: 1,
          recentCommit: 1,
          gitUpdatedAt: 1,
        },
      },
    ),
    db
      .collection('collisions')
      .find({ podId, detectedAt: { $gte: since } }, { projection: { _id: 0, embedding: 0 } })
      .sort({ detectedAt: -1 })
      .limit(DEFAULT_LIMIT)
      .toArray(),
    db
      .collection('interventions')
      .find({ podId, createdAt: { $gte: since } }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(DEFAULT_LIMIT)
      .toArray(),
    db
      .collection('outcomes')
      .find({ podId, recordedAt: { $gte: since } }, { projection: { _id: 0 } })
      .sort({ recordedAt: -1 })
      .limit(DEFAULT_LIMIT)
      .toArray(),
    getUserLearningProfileByIdentity(identity).catch(() => null),
  ]);

  return {
    pod,
    identity,
    generatedAt: new Date().toISOString(),
    currentGitState: gitState,
    userLearningProfile,
    memberHistory: history,
    recentCollisions: collisions,
    recentInterventions: interventions,
    recentOutcomes: outcomes,
  };
}

export async function recordLiveConversationNote(input: {
  podId: string;
  sessionId: string;
  identity?: string;
  note: string;
  kind?: string;
}) {
  const note = input.note.trim();
  if (!note) throw new Error('note is required');
  const doc = {
    podId: input.podId,
    sessionId: input.sessionId,
    identity: input.identity,
    kind: input.kind || 'summary',
    note: note.slice(0, 4000),
    createdAt: new Date().toISOString(),
  };
  await (await getDb()).collection('conversation_notes').insertOne(doc);
  if (input.identity) {
    const profile = await getUserLearningProfileByIdentity(input.identity);
    if (profile) {
      void buildUserLearningProfile(profile.clerkUserId).catch((err) =>
        console.warn(`[memory] note user learning refresh failed: ${(err as Error).message}`),
      );
    }
  }
  return { ...doc, _id: undefined };
}
