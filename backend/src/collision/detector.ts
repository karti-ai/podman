import type { EngineerContext, Collision, GithubStateSnapshot } from '@podman/shared';

function normalize(path?: string): string | undefined {
  if (!path) return undefined;
  return path.replace(/^\.?\/?(src\/)?/, 'src/').toLowerCase();
}

export function detectCollisions(
  contexts: EngineerContext[],
  github: GithubStateSnapshot,
): Collision[] {
  const byFile = new Map<string, EngineerContext[]>();
  for (const c of contexts) {
    const f = normalize(c.currentFile);
    if (!f) continue;
    (byFile.get(f) ?? byFile.set(f, []).get(f)!).push(c);
  }

  const out: Collision[] = [];
  for (const [file, group] of byFile) {
    const engineers = [...new Set(group.map((g) => g.engineerId))];
    if (engineers.length < 2) continue;

    const anyUnpushed = group.some((g) => g.hasUnpushedChanges) || github.unpushed === true;
    if (!anyUnpushed) continue; // the crux GitHub alone cannot answer

    out.push({
      id: `col_${file}_${Date.now()}`,
      podId: group[0]!.podId,
      file,
      symbol: group.find((g) => g.currentSymbol)?.currentSymbol,
      engineers,
      severity: 'warn',
      githubState: { ...github, unpushed: anyUnpushed },
      detectedAt: new Date().toISOString(),
    });
  }
  return out;
}
