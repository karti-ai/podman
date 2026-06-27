/**
 * Hardcoded teams/engineers for R&D so the join screen is select-only (no typing)
 * while we develop. Swap for real data (backend/Atlas) once pods are persisted.
 */
export interface DemoTeam {
  id: string;
  name: string;
  repo: string;
  members: string[];
}

export const TEAMS: DemoTeam[] = [
  {
    id: 'demo-pod',
    name: 'Demo Pod',
    repo: 'karti-ai/podman',
    members: ['Karti', 'Yahya', 'Ramis', 'Zander', 'Shakthi'],
  },
  {
    id: 'frontend-squad',
    name: 'Frontend Squad',
    repo: 'karti-ai/podman',
    members: ['Karti', 'Zander'],
  },
  {
    id: 'backend-squad',
    name: 'Backend Squad',
    repo: 'karti-ai/podman',
    members: ['Yahya', 'Ramis'],
  },
];
