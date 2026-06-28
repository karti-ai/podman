import type {
  InterventionOutcome,
  HermesJob,
  HermesJobEvent,
  MemberWorkHistory,
  Pod,
  PodActivityEvent,
  PodInput,
} from '@podman/shared';

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://localhost:8787'
    : '');

export interface MemoryStats {
  observations: number;
  collisions: number;
  interventions: number;
  outcomes: number;
}

export interface LiveConversationSession {
  sessionId: string;
  podId: string;
  identity: string;
  displayName: string;
  room: string;
  url: string;
  token: string;
  startedAt: string;
  lastEventAt?: string;
  endedAt?: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Mint a LiveKit token from the backend. */
export async function fetchToken(params: {
  room: string;
  identity: string;
  name: string;
  githubLogin?: string;
}): Promise<{ token: string; url: string }> {
  const res = await fetch(`${BACKEND_URL}/api/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  return json(res);
}

/** Record an intervention outcome for the policy learning loop. */
export async function postOutcome(outcome: InterventionOutcome): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/api/outcome`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(outcome),
  });
  if (!res.ok) throw new Error(`outcome post failed: ${res.status}`);
}

export async function createSyncPr(input: {
  headBranch?: string;
  file?: string;
  summary?: string;
}): Promise<{ url: string; number: number }> {
  return json(
    await fetch(`${BACKEND_URL}/api/sync-pr`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

// --- Pods CRUD ---

export async function listPods(): Promise<Pod[]> {
  return json(await fetch(`${BACKEND_URL}/api/pods`));
}

/** Display names currently connected per pod id (= LiveKit room name). */
export async function getPresence(): Promise<Record<string, string[]>> {
  return json(await fetch(`${BACKEND_URL}/api/presence`));
}

export async function getMemoryStats(): Promise<MemoryStats> {
  return json(await fetch(`${BACKEND_URL}/api/memory/stats`));
}

export async function getPodActivity(id: string, limit = 80): Promise<PodActivityEvent[]> {
  return json(
    await fetch(`${BACKEND_URL}/api/pods/${encodeURIComponent(id)}/activity?limit=${limit}`),
  );
}

export function podActivityStreamUrl(id: string): string {
  return `${BACKEND_URL}/api/pods/${encodeURIComponent(id)}/activity/stream`;
}

export async function getMemberWorkHistory(
  podId: string,
  member: string,
): Promise<MemberWorkHistory> {
  return json(
    await fetch(
      `${BACKEND_URL}/api/pods/${encodeURIComponent(podId)}/members/${encodeURIComponent(
        member,
      )}/history?hours=24&limit=80`,
    ),
  );
}

export async function createPod(input: PodInput): Promise<Pod> {
  return json(
    await fetch(`${BACKEND_URL}/api/pods`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

export async function updatePod(id: string, patch: PodInput): Promise<Pod> {
  return json(
    await fetch(`${BACKEND_URL}/api/pods/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  );
}

export async function deletePod(id: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/api/pods/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`delete pod failed: ${res.status}`);
}

export async function addMember(id: string, name: string): Promise<Pod> {
  return json(
    await fetch(`${BACKEND_URL}/api/pods/${encodeURIComponent(id)}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  );
}

export async function testPodVoice(id: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/api/pods/${encodeURIComponent(id)}/voice-test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'PodMan voice test. Gemini TTS is playing through LiveKit.',
    }),
  });
  if (!res.ok) throw new Error(`voice test failed: ${res.status}`);
}

export async function startLiveConversation(
  podId: string,
  input: { identity: string; displayName?: string },
): Promise<LiveConversationSession> {
  return json(
    await fetch(`${BACKEND_URL}/api/pods/${encodeURIComponent(podId)}/live-conversation/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

export async function stopLiveConversation(podId: string, sessionId: string): Promise<void> {
  const res = await fetch(
    `${BACKEND_URL}/api/pods/${encodeURIComponent(
      podId,
    )}/live-conversation/${encodeURIComponent(sessionId)}/stop`,
    { method: 'POST' },
  );
  if (!res.ok) throw new Error(`live conversation stop failed: ${res.status}`);
}

export async function getLiveConversationHermesJob(
  podId: string,
  sessionId: string,
): Promise<{ job: HermesJob | null; events: HermesJobEvent[] }> {
  return json(
    await fetch(
      `${BACKEND_URL}/api/pods/${encodeURIComponent(
        podId,
      )}/live-conversation/${encodeURIComponent(sessionId)}/hermes-job`,
    ),
  );
}

export async function abortLiveConversationHermesJob(
  podId: string,
  sessionId: string,
): Promise<{ job: HermesJob | null }> {
  return json(
    await fetch(
      `${BACKEND_URL}/api/pods/${encodeURIComponent(
        podId,
      )}/live-conversation/${encodeURIComponent(sessionId)}/hermes-job/abort`,
      { method: 'POST' },
    ),
  );
}

export async function removeMember(id: string, name: string): Promise<Pod> {
  return json(
    await fetch(
      `${BACKEND_URL}/api/pods/${encodeURIComponent(id)}/members/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    ),
  );
}
