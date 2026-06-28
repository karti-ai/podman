import type { PodGraph } from '@podman/shared';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787';

/** Fetch a pod's continual-learning graph (team_model view, demo fallback). */
export async function fetchPodGraph(podId: string): Promise<PodGraph> {
  const res = await fetch(`${BACKEND_URL}/api/pods/${encodeURIComponent(podId)}/graph`);
  if (!res.ok) throw new Error(`graph request failed: ${res.status}`);
  return res.json() as Promise<PodGraph>;
}
