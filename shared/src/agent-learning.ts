export type AgentRunStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'improved'
  | 'regressed'
  | 'abandoned';

export interface AgentRun {
  runId: string;
  podId: string;
  goal: string;
  trigger: string;
  strategyVersionId: string;
  status: AgentRunStatus;
  startedAt: string;
  completedAt?: string;
  score?: number;
  verifierSummary?: string;
  inputRefs?: string[];
  outputRefs?: string[];
}

export interface AgentTraceEvent {
  runId: string;
  podId: string;
  step: number;
  phase: string;
  eventType: string;
  inputSummary?: string;
  outputSummary?: string;
  toolName?: string;
  error?: string;
  metrics?: Record<string, number | string | boolean>;
  createdAt: string;
}

export type StrategyVersionKind = 'prompt' | 'policy' | 'detector' | 'verifier' | 'routing';

export type StrategyVersionStatus = 'candidate' | 'active' | 'retired' | 'rejected';

export interface StrategyVersion {
  strategyVersionId: string;
  podId: string;
  kind: StrategyVersionKind;
  name: string;
  parentVersionId?: string;
  status: StrategyVersionStatus;
  summary: string;
  promptText?: string;
  policy?: Record<string, unknown>;
  verifier?: Record<string, unknown>;
  metrics?: Record<string, number | string | boolean>;
  createdAt: string;
  promotedAt?: string;
}

export type LearningProposalStatus = 'open' | 'accepted' | 'rejected' | 'superseded';

export interface LearningProposal {
  proposalId: string;
  podId: string;
  sourceRunId: string;
  targetKind: StrategyVersionKind;
  parentVersionId: string;
  proposedChange: string;
  rationale: string;
  verifierPlan: string;
  status: LearningProposalStatus;
  createdAt: string;
  resolvedAt?: string;
}
