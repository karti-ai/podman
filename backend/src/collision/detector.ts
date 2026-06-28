import type { EngineerContext, Collision, GithubStateSnapshot } from '@podman/shared';
import type { GitState } from '../memory/db.js';

/**
 * Collapse any path-ish string to a comparable file key.
 *
 * Vision reads paths at inconsistent depths ("agent.ts" vs
 * "backend/src/agent.ts"), and git status lines carry a status prefix
 * ("M README.md", "?? test.txt"). Reduce both to a lowercased basename so the
 * same file matches regardless of how it was observed. Basename matching can
 * over-group two same-named files in different dirs, but for live coordination
 * that bias toward firing is the right trade.
 */
function fileKey(raw?: string): string | undefined {
  if (!raw) return undefined;
  const stripped = raw.trim().replace(/^(\?\?|[MADRCU!]{1,2})\s+/, ''); // drop git status prefix
  const base = stripped.split(/[\\/]/).pop()?.trim();
  if (!base) return undefined;
  return base.toLowerCase();
}

interface Touch {
  engineerId: string;
  unpushed: boolean;
  display: string; // original path/name to show in the card
}

/**
 * Detect same-file collisions from two fused signals:
 *  1. Vision — what each engineer currently has on screen.
 *  2. Git ground truth — each engineer's dirty/unpushed `changedFiles`.
 *
 * Git overlap is deterministic and does not require both engineers to have the
 * file on screen at the same instant, so it is the reliable demo path.
 */
export function detectCollisions(
  contexts: EngineerContext[],
  github: GithubStateSnapshot,
  gitStates?: Map<string, GitState>,
): Collision[] {
  const byFile = new Map<string, Touch[]>();
  const add = (key: string | undefined, touch: Touch): void => {
    if (!key) return;
    (byFile.get(key) ?? byFile.set(key, []).get(key)!).push(touch);
  };

  // Signal 1: live vision context.
  for (const c of contexts) {
    add(fileKey(c.currentFile), {
      engineerId: c.engineerId,
      unpushed: c.hasUnpushedChanges === true,
      display: c.currentFile ?? '',
    });
  }

  // Signal 2: git ground truth (a dirty changed file is unpushed by definition).
  if (gitStates) {
    for (const [engineerId, git] of gitStates) {
      for (const changed of git.changedFiles) {
        add(fileKey(changed), { engineerId, unpushed: true, display: changed });
      }
    }
  }

  const out: Collision[] = [];
  for (const [, touches] of byFile) {
    const engineers = [...new Set(touches.map((t) => t.engineerId))];
    if (engineers.length < 2) continue; // need two distinct people on one file

    const anyUnpushed = touches.some((t) => t.unpushed) || github.unpushed === true;
    if (!anyUnpushed) continue; // the crux GitHub alone cannot answer

    // Show the most specific path we saw for this file.
    const display =
      touches.map((t) => t.display).sort((a, b) => b.length - a.length)[0] ?? touches[0]!.display;

    out.push({
      id: `col_${fileKey(display)}_${Date.now()}`,
      podId: contexts[0]?.podId ?? 'demo-pod',
      file: display,
      symbol: contexts.find((c) => c.currentSymbol)?.currentSymbol,
      engineers,
      severity: 'warn',
      githubState: { ...github, unpushed: anyUnpushed },
      detectedAt: new Date().toISOString(),
    });
  }
  return out;
}
