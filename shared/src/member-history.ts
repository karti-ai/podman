export type MemberWorkHistorySource = 'vision' | 'git';

export interface MemberWorkHistoryFile {
  file: string;
  observations: number;
  gitChanges: number;
  firstSeenAt: string;
  lastSeenAt: string;
  confidenceAvg: number | null;
  activities: string[];
  current: boolean;
}

export interface MemberWorkHistoryEvent {
  id: string;
  at: string;
  source: MemberWorkHistorySource;
  file: string;
  title: string;
  detail?: string;
  confidence?: number;
}

export interface MemberWorkHistory {
  podId: string;
  member: string;
  generatedAt: string;
  windowHours: number;
  totals: {
    files: number;
    observations: number;
    gitChanges: number;
  };
  files: MemberWorkHistoryFile[];
  timeline: MemberWorkHistoryEvent[];
  /**
   * Coordination ROI summary — clashes Hermes caught for this member. Optional
   * so pods with no collisions / older payloads render without the band.
   */
  roi?: MemberWorkHistoryRoi;
}

export interface MemberWorkHistoryRoi {
  /** Estimated rework minutes saved (heuristic, labeled "~/est." in UI). */
  savedMinutes: number;
  /** Eligible collisions caught early (hard count). */
  clashesCaught: number;
  /** Distinct files that hit an eligible clash. */
  filesDeconflicted: number;
  /** Member files in flight that never hit a clash. */
  conflictFreeFiles: number;
  /** Total member files in flight (git changedFiles). */
  totalFiles: number;
  /** Per-kind breakdown for the tooltip. */
  breakdown: { label: string; count: number; minutesEach: number }[];
}
