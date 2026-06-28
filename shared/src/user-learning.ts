export interface UserLearningPodSummary {
  podId: string;
  podName?: string;
  visits: number;
  actions: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface UserLearningProfile {
  clerkUserId: string;
  displayName?: string;
  email?: string;
  imageUrl?: string;
  identities: string[];
  pods: UserLearningPodSummary[];
  recentWork: Array<{
    podId: string;
    file?: string;
    activity?: string;
    at: string;
  }>;
  collaborationStyle: string[];
  workingStyle: string[];
  goals: string[];
  knowledge: string[];
  counts: {
    podActions: number;
    observations: number;
    gitStates: number;
    collisionsInvolved: number;
    outcomes: number;
    conversationNotes: number;
    hermesJobs: number;
  };
  updatedAt: string;
}
