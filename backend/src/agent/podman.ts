import { RoomEvent, type Room } from '@livekit/rtc-node';
import type { EngineerContext, Collision, Intervention, DataMessage } from '@podman/shared';
import { DATA_TOPIC } from '@podman/shared';
import { analyzeFrame } from '../vision/gemini.js';
import { detectCollisions } from '../collision/detector.js';
import { getGithubState } from '../github/client.js';
import { recordObservation, recordCollision, recordIntervention } from '../memory/store.js';
import { recallSimilar } from '../memory/vectors.js';
import { shouldIntervene, preferredAction } from '../memory/policy.js';
import { speak } from '../voice/live.js';

export class PodMan {
  private contexts = new Map<string, EngineerContext>();
  private encoder = new TextEncoder();

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
          if (c) c.hasUnpushedChanges = msg.report.unpushedCount > 0 || msg.report.dirtyFiles.length > 0;
        }
      } catch { /* ignore malformed */ }
    });
  }

  async onScreenFrame(engineerId: string, jpeg: Buffer): Promise<void> {
    const ctx = await analyzeFrame(engineerId, this.podId, jpeg);
    this.contexts.set(engineerId, ctx);
    await recordObservation(ctx);

    const github = await getGithubState(); // cached
    const collisions = detectCollisions([...this.contexts.values()], github);
    for (const collision of collisions) await this.handle(collision);
  }

  private async handle(collision: Collision): Promise<void> {
    const prior = await recallSimilar(collision); // Loop A: vector recall raises confidence
    if (prior) collision.severity = 'critical';
    if (!shouldIntervene(collision, prior)) return; // Loop B: policy gate

    await recordCollision(collision);
    const action = preferredAction(collision, prior);
    const names = collision.engineers.join(' and ');
    const message = `${names} are both editing ${collision.file}` +
      (collision.githubState?.unpushed ? ' and one has unpushed changes.' : '.') +
      (prior ? ` I've seen this conflict pattern before.` : '');

    const intervention: Intervention = {
      id: `int_${Date.now()}`,
      collisionId: collision.id,
      podId: this.podId,
      kind: 'card',
      message,
      suggestedAction: { kind: action },
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await recordIntervention(intervention);

    const data: DataMessage = { type: 'COLLISION', collision, intervention };
    await this.room.localParticipant?.publishData(
      this.encoder.encode(JSON.stringify(data)),
      { reliable: true, topic: DATA_TOPIC },
    );
    await speak(this.room, message); // gemini-3.1-flash-live voice into the room
  }
}
