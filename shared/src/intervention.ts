export type InterventionKind = 'voice' | 'card';

export type InterventionStatus = 'pending' | 'delivered' | 'accepted' | 'dismissed';

export type SuggestedActionKind = 'open_sync_pr' | 'ping_teammate' | 'none';

/** What PodMan says/does about a collision — the product's hero output. */
export interface Intervention {
  id: string;
  collisionId: string;
  podId: string;
  kind: InterventionKind;
  /** Spoken/displayed message, e.g. "Karti and Yahya are both in auth.ts...". */
  message: string;
  suggestedAction: SuggestedAction;
  status: InterventionStatus;
  createdAt: string;
}

export interface SuggestedAction {
  kind: SuggestedActionKind;
  /** Free-form payload for the action (e.g. branch names for a sync PR). */
  params?: Record<string, unknown>;
}
