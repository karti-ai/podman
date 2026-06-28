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
}
