/** A pod is one room of engineers working together (one LiveKit room per pod). */
export interface Pod {
  id: string;
  name: string;
  /** GitHub repo the pod is working in, as "owner/name". */
  repo: string;
  members: Engineer[];
  createdAt: string;
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
