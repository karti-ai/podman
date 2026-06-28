import { RoomEvent, type Room } from '@livekit/rtc-node';
import type { EngineerContext, Collision, Intervention, DataMessage } from '@podman/shared';
import { analyzeFrame } from '../vision/gemini.js';
import { detectCollisions } from '../collision/detector.js';
import { detectResearchOverlaps } from '../collision/research.js';
import { getGithubState } from '../github/client.js';
import {
  recordObservation,
  recordCollision,
  recordIntervention,
  recordSuppression,
  updateInterventionStatus,
} from '../memory/store.js';
import { getGitStates, type GitState } from '../memory/db.js';
import { recallSimilar } from '../memory/vectors.js';
import { shouldIntervene, preferredAction } from '../memory/policy.js';
import { publishHermesIntervention } from '../action/hermes.js';

/** Strip a git-status prefix ("M ", "?? ") and reduce a path to its lowercased
 *  basename — matches comparableFile() in memory/store.ts so keys line up. */
function comparableBasename(raw?: string): string {
  return (
    (raw ?? '')
      .trim()
      .replace(/^(\?\?|[MADRCU!]{1,2})\s+/, '')
      .split(/[\\/]/)
      .pop()
      ?.toLowerCase() ?? ''
  );
}

/** Canonicalize an engineer name for case/whitespace-insensitive matching, so
 *  "Karti" and "karti" resolve to the same engineer's git state. */
function canonicalName(raw?: string): string {
  return (raw ?? '').trim().toLowerCase();
}

/** How long a still-present conflict stays muted after we voice it, before it
 *  re-alerts. Edge-trigger alone permanently muted files that stay dirty for
 *  the whole session (e.g. README everyone tests on). This bounds that: voice
 *  once, then re-alert at most every interval while it persists. */
const CONFLICT_REALERT_MS = Number(process.env.CONFLICT_REALERT_MS ?? '20000');

/** Git ground truth: do ALL involved engineers currently have the collided file
 *  in their changedFiles? Computed at detection time while git state is fresh. */
function engineersOverlapOnFile(collision: Collision, gitStates: Map<string, GitState>): boolean {
  const target = comparableBasename(collision.file);
  if (!target || collision.engineers.length < 2) return false;
  const byCanon = new Map<string, string[]>();
  for (const [name, st] of gitStates) byCanon.set(canonicalName(name), st.changedFiles);
  return collision.engineers.every((e) =>
    (byCanon.get(canonicalName(e)) ?? []).some((f) => comparableBasename(f) === target),
  );
}

export class PodMan {
  private contexts = new Map<string, EngineerContext>();
  /**
   * Conflicts we have already voiced, keyed by file + engineer pair (see
   * conflictKey), mapped to the time we last voiced them. Edge-triggered:
   * speak once when a conflict appears. Re-armed (deleted here) by
   * onScreenFrame as soon as a detection cycle no longer sees it, so a
   * resolved-then-recurring conflict alerts again. Additionally, a conflict
   * that *persists* re-alerts every CONFLICT_REALERT_MS so a perpetually-dirty
   * file (README) doesn't go silent forever after the first alert.
   */
  private activeConflicts = new Map<string, number>();

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
    const contexts = [...this.contexts.values()];
    const fileCollisions = detectCollisions(contexts, github, gitStates);
    const researchCollisions = await detectResearchOverlaps(contexts, gitStates);
    const collisions = [...fileCollisions, ...researchCollisions];

    // Re-arm: any conflict we previously voiced that is no longer present has
    // resolved, so allow it to alert again if it recurs.
    const current = new Set(collisions.map((c) => this.conflictKey(c)));
    for (const key of this.activeConflicts.keys()) {
      if (!current.has(key)) this.activeConflicts.delete(key);
    }

    // Capture git ground-truth overlap now, while engineer_states are fresh, so
    // the outcome-time verifier never depends on a stale sidecar or a late click.
    for (const collision of collisions) {
      if (collision.overlapKind !== 'research') {
        collision.gitOverlap = engineersOverlapOnFile(collision, gitStates);
      }
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
    const who = [...collision.engineers].map(canonicalName).sort().join('+');
    return `${collision.overlapKind ?? 'file'}:${comparableBasename(collision.file)}:${who}`;
  }

  private async handle(collision: Collision): Promise<void> {
    const key = this.conflictKey(collision);
    const lastAlerted = this.activeConflicts.get(key);
    // Edge-trigger + time-based re-arm: stay quiet right after voicing, but
    // re-alert a persistent conflict once CONFLICT_REALERT_MS has elapsed.
    if (lastAlerted !== undefined && Date.now() - lastAlerted < CONFLICT_REALERT_MS) return;

    const prior = await recallSimilar(collision); // Loop A: exact/vector recall raises confidence
    // Only escalate to critical (which triggers the spoken alert) when the
    // recalled prior was an *accepted real* collision. Blanket-escalating every
    // recall — including dismissed/false-positive priors — masked the learned
    // routing in preferredAction and made recalled noise scream "CRITICAL".
    // (RSI Step 2 — continual-learning/policy.md:62-63, plan.md:66)
    if (prior?.priorOutcome?.accepted && prior?.priorOutcome?.wasRealCollision) {
      collision.severity = 'critical';
    }
    if (!shouldIntervene(collision, prior)) {
      // Feature A — make the negative-feedback loop VISIBLE. If we stayed quiet
      // *specifically* because this signature was DISMISSED before, record a
      // durable suppressed-repeat event (timestamped now, at the repeat) so the
      // activity stream shows the learning instead of nothing.
      if (prior?.priorOutcome && !prior.priorOutcome.accepted) {
        // Mark handled first — like the alert path below — so we record ONE
        // suppressed-repeat per recurrence, not once per frame; it re-arms via
        // the resolution sweep in onScreenFrame. Awaited like recordCollision so
        // the durable learning proof is reliably written.
        this.activeConflicts.set(key, Date.now());
        await recordSuppression(
          collision,
          prior.priorOutcome.interventionId,
          prior.priorOutcome.recordedAt,
        );
      }
      return; // Loop B: policy gate
    }

    this.activeConflicts.set(key, Date.now()); // claim + timestamp; re-armed on resolution or after CONFLICT_REALERT_MS
    await recordCollision(collision);
    const action = preferredAction(collision, prior);
    const shortFile = collision.file.split('/').pop() ?? collision.file;
    const isResearchOverlap = collision.overlapKind === 'research';

    if (isResearchOverlap) {
      const researcher = collision.researcher ?? collision.engineers[1] ?? 'A teammate';
      const editor = collision.editor ?? collision.engineers[0] ?? 'a teammate';
      const topic = collision.researchTopic ?? 'the same area';
      const source = collision.researchSource ? ` (${collision.researchSource})` : '';
      const message = `🤝 ${researcher} is researching ${topic}${source} while ${editor} edits ${shortFile} — sync up before duplicating effort.`;
      const voiceLine = `${researcher} is researching ${topic} while ${editor} works on ${shortFile}. Worth a quick sync.`;
      const intervention: Intervention = {
        id: `int_${Date.now()}`,
        collisionId: collision.id,
        podId: this.podId,
        kind: 'card',
        message,
        suggestedAction: {
          kind: 'ping_teammate',
          params: {
            file: collision.file,
            summary: message,
            engineers: collision.engineers,
            researchTopic: collision.researchTopic,
            researchSource: collision.researchSource,
          },
        },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      await recordIntervention(intervention);
      await publishHermesIntervention(this.room, collision, intervention, voiceLine);
      return;
    }

    const names = collision.engineers.join(' + ');

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
