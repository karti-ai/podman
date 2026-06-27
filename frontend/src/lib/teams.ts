/**
 * Hardcoded teams/engineers for R&D so the join screen is select-only (no typing)
 * while we develop. Swap for real data (backend/Atlas) once pods are persisted.
 */
export interface DemoTeam {
  id: string;
  name: string;
  repo: string;
  description: string;
  members: string[];
}

export const TEAMS: DemoTeam[] = [
  {
    id: 'demo-pod',
    name: 'Demo Pod',
    repo: 'karti-ai/podman',
    description: 'The full crew — used for the live demo.',
    members: ['Karti', 'Yahya', 'Ramis', 'Shakthi'],
  },
  {
    id: 'frontend-squad',
    name: 'Frontend Squad',
    repo: 'karti-ai/podman',
    description: 'PWA, capture, and PodMan card UI.',
    members: ['Karti', 'Ramis'],
  },
  {
    id: 'backend-squad',
    name: 'Backend Squad',
    repo: 'karti-ai/podman',
    description: 'LiveKit agent, vision, collision detector.',
    members: ['Yahya', 'Ramis'],
  },
];

export function teamById(id: string): DemoTeam {
  return TEAMS.find((t) => t.id === id) ?? TEAMS[0]!;
}
