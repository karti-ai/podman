import type { Collision, EngineerContext, GithubStateSnapshot } from '@podman/shared';

/**
 * Fuse live engineer contexts (from vision) with GitHub state to find overlaps:
 * two or more engineers editing the same file — especially when unpushed.
 *
 * Pure function: easy to unit-test, no I/O. Callers supply the GitHub snapshot.
 */
export function detectCollisions(
  contexts: EngineerContext[],
  githubStateByFile: Record<string, GithubStateSnapshot> = {},
  now: string = new Date().toISOString(),
): Collision[] {
  const byFile = new Map<string, EngineerContext[]>();
  for (const ctx of contexts) {
    if (!ctx.currentFile) continue;
    const list = byFile.get(ctx.currentFile) ?? [];
    list.push(ctx);
    byFile.set(ctx.currentFile, list);
  }

  const collisions: Collision[] = [];
  for (const [file, group] of byFile) {
    if (group.length < 2) continue;

    const engineers = [...new Set(group.map((g) => g.engineerId))];
    if (engineers.length < 2) continue;

    const github = githubStateByFile[file];
    const unpushed = group.some((g) => g.hasUnpushedChanges) || github?.unpushed === true;
    const sharedSymbol = group.every(
      (g) => g.currentSymbol && g.currentSymbol === group[0]!.currentSymbol,
    )
      ? group[0]!.currentSymbol
      : undefined;

    collisions.push({
      id: `${group[0]!.podId}:${file}:${engineers.sort().join(',')}`,
      podId: group[0]!.podId,
      file,
      symbol: sharedSymbol,
      engineers,
      severity: unpushed ? 'critical' : sharedSymbol ? 'warn' : 'info',
      githubState: github,
      detectedAt: now,
    });
  }

  return collisions;
}
