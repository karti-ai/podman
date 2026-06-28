export type PodActivityKind = 'observation' | 'git' | 'collision' | 'intervention' | 'outcome';

export type PodActivitySource = 'vision' | 'git' | 'memory' | 'hermes' | 'policy';

export type PodActivitySeverity = 'info' | 'warn' | 'critical' | 'success';

export interface PodActivityEvent {
  id: string;
  podId: string;
  kind: PodActivityKind;
  source: PodActivitySource;
  title: string;
  detail?: string;
  actor?: string;
  actors?: string[];
  file?: string;
  imageUrl?: string;
  severity: PodActivitySeverity;
  at: string;
}
