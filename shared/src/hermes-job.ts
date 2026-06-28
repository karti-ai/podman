export type HermesJobStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_confirmation'
  | 'aborting'
  | 'aborted'
  | 'failed'
  | 'completed';

export type HermesJobEventType =
  | 'accepted'
  | 'heartbeat'
  | 'step_started'
  | 'step_output'
  | 'needs_confirmation'
  | 'step_completed'
  | 'aborted'
  | 'failed'
  | 'completed';

export type HermesContextScope =
  | 'current_pod'
  | 'current_repo'
  | 'current_file'
  | 'github'
  | 'mongodb'
  | 'terminal'
  | 'full_workspace';

export type HermesRiskLevel = 'read_only' | 'safe_write' | 'commit_allowed' | 'deploy_allowed';

export interface HermesJobInput {
  prompt: string;
  contextScope: HermesContextScope;
  targetRepository?: string;
  riskLevel: HermesRiskLevel;
  requiresConfirmation?: boolean;
  successCriteria: string[];
  podId: string;
  identity: string;
  sessionId: string;
  conversationRoom?: string;
  parentJobId?: string;
}

export interface HermesJob {
  id: string;
  podId: string;
  identity: string;
  sessionId: string;
  conversationRoom?: string;
  prompt: string;
  contextScope: HermesContextScope;
  targetRepository: string;
  riskLevel: HermesRiskLevel;
  requiresConfirmation: boolean;
  successCriteria: string[];
  parentJobId?: string;
  status: HermesJobStatus;
  finalSummary?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  lastHeartbeatAt?: string;
  abortRequestedAt?: string;
}

export interface HermesJobEvent {
  id: string;
  jobId: string;
  podId: string;
  sessionId: string;
  type: HermesJobEventType;
  message: string;
  data?: Record<string, unknown>;
  createdAt: string;
}
