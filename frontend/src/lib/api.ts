import type { InterventionOutcome } from '@podman/shared';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787';

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
  if (!res.ok) throw new Error(`token request failed: ${res.status}`);
  return res.json() as Promise<{ token: string; url: string }>;
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
