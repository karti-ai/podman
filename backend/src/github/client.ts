import { Octokit } from 'octokit';
import type { GithubStateSnapshot } from '@podman/shared';
import { env } from '../env.js';

export const octokit: Octokit = new Octokit({ auth: env.github.token });

/**
 * Pull the GitHub state relevant to a file in the pod's repo: open branches
 * and PRs touching it. Fused with vision contexts by the collision detector.
 *
 * TODO(github): list branches/PRs, diff files, map commits -> engineer logins.
 */
export async function getStateForFile(_file: string): Promise<GithubStateSnapshot> {
  return { branches: {}, openPrs: [], unpushed: false };
}

/** Open a draft "sync PR" between two engineers' branches — the suggested action. */
export async function openSyncPr(_params: {
  base: string;
  head: string;
  title: string;
}): Promise<{ number: number; url: string } | null> {
  // TODO(github): octokit.rest.pulls.create({ ...env.github.repo, draft: true })
  return null;
}
