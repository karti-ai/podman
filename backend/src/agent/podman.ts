import { RoomEvent, type Room } from '@livekit/rtc-node';
import type { EngineerContext, Collision, Intervention, DataMessage } from '@podman/shared';
import { analyzeFrame } from '../vision/gemini.js';
import { detectCollisions } from '../collision/detector.js';
import { getGithubState } from '../github/client.js';
import {
  recordObservation,
  recordCollision,
  recordIntervention,
  updateInterventionStatus,
} from '../memory/store.js';
import { getGitStates } from '../memory/db.js';
import { recallSimilar } from '../memory/vectors.js';
import { shouldIntervene, preferredAction } from '../memory/policy.js';
import { publishHermesIntervention } from '../action/hermes.js';

export class PodMan {
  private contexts = new Map<string, EngineerContext>();
  /**
   * Conflicts we have already voiced and that are still unresolved, keyed by
   * file (see conflictKey). Edge-triggered alerting: speak once when a conflict
   * appears, stay quiet while it persists. A conflict is re-armed (deleted
   * here) by onScreenFrame as soon as a detection cycle no longer sees it, so a
   * resolved-then-recurring conflict alerts again.
   */
  private activeConflicts = new Set<string>();

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

    // Re-arm: any conflict we previously voiced that is no longer present has
    // resolved, so allow it to alert again if it recurs.
    const current = new Set(collisions.map((c) => this.conflictKey(c)));
    for (const key of this.activeConflicts) {
      if (!current.has(key)) this.activeConflicts.delete(key);
    }

    for (const collision of collisions) await this.handle(collision);
  }

  /**
   * Stable identity for a conflict, independent of the Date.now() baked into
   * collision.id. Mirrors comparableFile() in memory/store.ts so keys line up:
   * strip any git-status prefix ("M ", "?? ") and reduce to a lowercased
   * basename.
   */
  private conflictKey(collision: Collision): string {
    return (
      (collision.file ?? '')
        .trim()
        .replace(/^(\?\?|[MADRCU!]{1,2})\s+/, '')
        .split(/[\\/]/)
        .pop()
        ?.toLowerCase() ?? ''
    );
  }

  private async handle(collision: Collision): Promise<void> {
    const key = this.conflictKey(collision);
    if (this.activeConflicts.has(key)) return; // single-shot: already voiced, still unresolved

    const prior = await recallSimilar(collision); // Loop A: exact/vector recall raises confidence
    // Only escalate to critical (which triggers the spoken alert) when the
    // recalled prior was an *accepted real* collision. Blanket-escalating every
    // recall — including dismissed/false-positive priors — masked the learned
    // routing in preferredAction and made recalled noise scream "CRITICAL".
    // (RSI Step 2 — continual-learning/policy.md:62-63, plan.md:66)
    if (prior?.priorOutcome?.accepted && prior?.priorOutcome?.wasRealCollision) {
      collision.severity = 'critical';
    }
    if (!shouldIntervene(collision, prior)) return; // Loop B: policy gate

    this.activeConflicts.add(key); // claim now we're alerting; re-armed in onScreenFrame on resolution
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
