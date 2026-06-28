import { RoomEvent, type Room } from '@livekit/rtc-node';
import type { EngineerContext, Collision, Intervention, DataMessage } from '@podman/shared';
import { analyzeFrame } from '../vision/gemini.js';
import { detectCollisions } from '../collision/detector.js';
import { getGithubState } from '../github/client.js';
import {
  recordObservation,
  recordCollision,
  recordIntervention,
  hasRecentInterventionForCollision,
  updateInterventionStatus,
} from '../memory/store.js';
import { getGitStates } from '../memory/db.js';
import { recallSimilar } from '../memory/vectors.js';
import { shouldIntervene, preferredAction } from '../memory/policy.js';
import { publishHermesIntervention } from '../action/hermes.js';

export class PodMan {
  private contexts = new Map<string, EngineerContext>();

  constructor(
    private room: Room,
    private podId: string,
  ) {}

  async start(): Promise<void> {
    // Tier-2 optional ground-truth + engineer ACKs arrive over the data channel.
    this.room.on(RoomEvent.DataReceived, (payload) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as DataMessage;
        if (msg.type === 'GIT_REPORT') {
          const c = this.contexts.get(msg.report.engineerId);
          if (c)
            c.hasUnpushedChanges = msg.report.unpushedCount > 0 || msg.report.dirtyFiles.length > 0;
        }
        if (msg.type === 'ACK') {
          void updateInterventionStatus(msg.interventionId, msg.status).catch((err) =>
            console.error(`[memory] intervention ack failed: ${(err as Error).message}`),
          );
        }
      } catch {
        /* ignore malformed */
      }
    });
  }

  async onScreenFrame(engineerId: string, jpeg: Buffer, screenshotDataUrl?: string): Promise<void> {
    const ctx = await analyzeFrame(engineerId, this.podId, jpeg);
    if (screenshotDataUrl) ctx.screenshotDataUrl = screenshotDataUrl;
    this.contexts.set(engineerId, ctx);
    await recordObservation(ctx);

    // Fuse git ground truth: engineer_states written by scripts/podman-agent.mjs.
    // Keyed by name (matches --name arg), same as LiveKit participant identity.
    const gitStates = await getGitStates(this.podId);
    for (const [id, c] of this.contexts) {
      const git = gitStates.get(id);
      if (git && git.changedFiles.length > 0) c.hasUnpushedChanges = true;
    }

    const github = await getGithubState(); // cached
    const collisions = detectCollisions([...this.contexts.values()], github, gitStates);
    for (const collision of collisions) await this.handle(collision);
  }

  private async handle(collision: Collision): Promise<void> {
    const prior = await recallSimilar(collision); // Loop A: exact/vector recall raises confidence
    if (prior) collision.severity = 'critical';
    if (!shouldIntervene(collision, prior)) return; // Loop B: policy gate
    if (await hasRecentInterventionForCollision(collision)) return;

    await recordCollision(collision);
    const action = preferredAction(collision, prior);
    const names = collision.engineers.join(' + ');
    const shortFile = collision.file.split('/').pop() ?? collision.file;

    // Terse, demo-centered alert — short and direct, not chatty AI prose.
    const message =
      `Conflict: ${names} both on ${shortFile}` +
      (collision.githubState?.unpushed ? ' (unpushed).' : '.') +
      (prior ? ' Seen before.' : '');

    // Spoken line stays short, but uses natural phrasing for Gemini TTS prosody.
    const voiceLine = `${names} are both editing ${shortFile}. Please sync before pushing.`;

    const intervention: Intervention = {
      id: `int_${Date.now()}`,
      collisionId: collision.id,
      podId: this.podId,
      kind: 'card',
      message,
      suggestedAction: {
        kind: action,
        params: {
          file: collision.file,
          summary: message,
          engineers: collision.engineers,
        },
      },
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await recordIntervention(intervention);

    await publishHermesIntervention(
      this.room,
      collision,
      intervention,
      collision.severity === 'critical' ? voiceLine : undefined,
    );
  }
}
