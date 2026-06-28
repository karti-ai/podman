export type CollisionSeverity = 'info' | 'warn' | 'critical';

/**
 * A detected overlap between two or more engineers' live work, fused from
 * vision-derived contexts and GitHub state.
 */
export interface Collision {
  id: string;
  podId: string;
  /** File both engineers are touching. */
  file: string;
  /** Symbol-level overlap, if known. */
  symbol?: string;
  /** Engineer ids involved in the overlap. */
  engineers: string[];
  severity: CollisionSeverity;
  /** Snapshot of relevant GitHub state at detection time. */
  githubState?: GithubStateSnapshot;
  /**
   * Git ground-truth overlap captured AT detection time, while engineer_states
   * are still fresh: true when every involved engineer had `file` in their git
   * changedFiles. Read as the authoritative wasRealCollision evidence at outcome
   * time, so a late click, a stale sidecar, or the engineer_states freshness TTL
   * cannot retroactively zero it out.
   */
  gitOverlap?: boolean;
  detectedAt: string;
}

export interface GithubStateSnapshot {
  /** Open branches touching the file, keyed by engineer/login. */
  branches?: Record<string, string>;
  /** Open PR numbers touching the file. */
  openPrs?: number[];
  /** Whether any involved engineer has unpushed local changes. */
  unpushed?: boolean;
}
