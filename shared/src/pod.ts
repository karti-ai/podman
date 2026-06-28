/**
 * A pod is one room of engineers working together (one LiveKit room per pod).
 * Persisted in MongoDB; CRUD'd via /api/pods.
 */
export interface Pod {
  /** URL-safe slug, e.g. "frontend-pod". Stable id used everywhere. */
  id: string;
  name: string;
  /** GitHub repo the pod is working in, as "owner/name". */
  repo: string;
  description?: string;
  /** Engineer display names PodMan uses when it speaks. */
  members: string[];
  /** Latest known Clerk/Gmail profile data per member display name. */
  memberProfiles?: Record<
    string,
    {
      displayName: string;
      email?: string;
      imageUrl?: string;
    }
  >;
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when creating or updating a pod. */
export interface PodInput {
  name?: string;
  repo?: string;
  description?: string;
  members?: string[];
}

export interface Engineer {
  id: string;
  /** Display name PodMan uses when it speaks ("Karti and Yahya are both..."). */
  name: string;
  /** GitHub login, used to map vision context to GitHub state. */
  githubLogin?: string;
  /** LiveKit participant identity for this engineer in the pod room. */
  participantId?: string;
}
