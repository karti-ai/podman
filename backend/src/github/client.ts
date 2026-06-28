import { Octokit } from 'octokit';
import type { GithubStateSnapshot } from '@podman/shared';
import { env, repoParts } from '../env.js';

const gh = new Octokit({ auth: env.GITHUB_TOKEN });
let cache: { at: number; state: GithubStateSnapshot } | null = null;
const TTL_MS = 5000;

export async function getGithubState(): Promise<GithubStateSnapshot> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.state;
  const { owner, repo } = repoParts();
  const [{ data: branches }] = await Promise.all([
    gh.rest.repos.listBranches({ owner, repo, per_page: 50 }),
  ]);
  const state: GithubStateSnapshot = {
    branches: Object.fromEntries(branches.map((b) => [b.name, b.commit.sha])),
    openPrs: [],
    unpushed: undefined, // vision/Tier-2 fills this; API cannot know
  };
  cache = { at: Date.now(), state };
  return state;
}

export async function remoteHasFile(path: string, ref = 'main'): Promise<boolean> {
  const { owner, repo } = repoParts();
  return gh.rest.repos
    .getContent({ owner, repo, path, ref })
    .then(() => true)
    .catch(() => false);
}

export async function createSyncPr(input: { headBranch: string; file: string; summary: string }) {
  const { owner, repo } = repoParts();
  const { data: mainRef } = await gh.rest.git.getRef({ owner, repo, ref: 'heads/main' });
  const branch = `podman-sync-${Date.now()}`;
  await gh.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: mainRef.object.sha,
  });

  const artifactPath = `podman-sync-artifacts/${branch}.md`;
  const body = [
    '# PodMan Sync Artifact',
    '',
    `- File: \`${input.file || 'unknown'}\``,
    `- Source branch hint: \`${input.headBranch || 'not provided'}\``,
    `- Created: ${new Date().toISOString()}`,
    '',
    '## Coordination Summary',
    '',
    input.summary || 'PodMan detected a coordination risk before the relevant work was pushed.',
    '',
    '## Suggested Next Step',
    '',
    'Coordinate ownership before pushing or merging overlapping local work.',
    '',
  ].join('\n');

  await gh.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    branch,
    path: artifactPath,
    message: `PodMan sync artifact for ${input.file || 'active work'}`,
    content: Buffer.from(body).toString('base64'),
  });

  const { data: pr } = await gh.rest.pulls.create({
    owner,
    repo,
    title: `PodMan: sync ${input.file} before collision`,
    head: branch,
    base: 'main',
    body: [
      input.summary,
      '',
      `PodMan created a visible sync artifact at \`${artifactPath}\` so the team can coordinate before pushing overlapping work.`,
    ].join('\n'),
  });
  return pr;
}
