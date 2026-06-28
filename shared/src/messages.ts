import type { Collision } from './collision.js';
import type { HermesJobEvent } from './hermes-job.js';
import type { Intervention, InterventionStatus } from './intervention.js';

/** Topics multiplexed over the LiveKit data channel. */
export const DATA_TOPIC = 'podman.intervention' as const;

/** Wire messages exchanged between the PodMan agent and engineer PWAs. */
export type DataMessage =
  | { type: 'COLLISION'; collision: Collision; intervention: Intervention }
  | { type: 'HERMES_MESSAGE'; message: HermesMessage }
  | { type: 'VOICE_CUE'; text: string }
  | { type: 'LIVE_CONVERSATION_EVENT'; event: LiveConversationEvent }
  | { type: 'HERMES_JOB_EVENT'; event: HermesJobEvent }
  | { type: 'ACK'; interventionId: string; status: InterventionStatus; note?: string }
  | { type: 'GIT_REPORT'; report: LocalGitReport }
  /** Any participant → the current test-audio owner: stop publishing the shared beat. */
  | { type: 'BEAT_STOP' };

/** A targeted teammate/project-channel notification from the Hermes action layer. */
export interface HermesMessage {
  id: string;
  podId: string;
  interventionId: string;
  recipients: string[];
  text: string;
  urgency: 'normal' | 'urgent';
  createdAt: string;
}

/** Private-room event that lets PodMan interrupt a 1:1 live conversation. */
export interface LiveConversationEvent {
  id: string;
  podId: string;
  sessionId: string;
  kind: 'critical_collision' | 'context_refresh';
  severity: 'info' | 'warn' | 'critical';
  summary: string;
  interrupt: boolean;
  createdAt: string;
  collisionId?: string;
  interventionId?: string;
}

/** Outcome of an intervention — the supervision signal for policy learning. */
export interface InterventionOutcome {
  interventionId: string;
  collisionId: string;
  podId: string;
  /** Did the predicted collision turn out real? (engineer-confirmed or inferred). */
  wasRealCollision: boolean;
  /** Did the engineer accept the offered action (e.g. sync PR)? */
  accepted: boolean;
  recordedAt: string;
}

/** The continually-refined per-pod world model (Loop A). */
export interface TeamModel {
  podId: string;
  /** filePath/dir -> engineerId most associated with it (de-facto owner). */
  ownership: Record<string, string>;
  /** Pairs of files that historically collide, with a co-occurrence weight. */
  hotspots: Array<{ files: [string, string]; weight: number }>;
  updatedAt: string;
}

/** OPTIONAL Tier-2 ground-truth from a per-laptop git sidecar. */
export interface LocalGitReport {
  engineerId: string;
  branch: string;
  /** Commits ahead of upstream (invisible to the GitHub API). */
  unpushedCount: number;
  /** Working-tree files with uncommitted edits. */
  dirtyFiles: string[];
  reportedAt: string;
}
