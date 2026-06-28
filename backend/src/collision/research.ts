import type { Collision, EngineerContext } from '@podman/shared';
import { env } from '../env.js';
import type { GitState } from '../memory/db.js';
import { semanticSimilarity } from '../memory/vectors.js';

export interface ResearchOpts {
  similarity?: (a: string, b: string) => Promise<number | null>;
  threshold?: number;
}

interface EditorFile {
  engineerId: string;
  file: string;
  symbol?: string;
  activity?: string;
}

interface Candidate {
  collision: Collision;
  score: number;
}

function stripGitPrefix(raw: string): string {
  return raw.trim().replace(/^(\?\?|[MADRCU!]{1,2})\s+/, '');
}

function fileStem(raw: string): string {
  const base = stripGitPrefix(raw).split(/[\\/]/).pop()?.trim().toLowerCase() ?? '';
  return base.replace(/\.[^.]+$/, '');
}

function words(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3);
}

function uniqueTokens(raw: string): Set<string> {
  const tokens = new Set(words(raw));
  for (const word of [...tokens]) {
    if (word.endsWith('kit')) tokens.add(word.replace(/kit$/, ''));
    if (word.endsWith('s')) tokens.add(word.slice(0, -1));
  }
  return tokens;
}

function fallbackMatches(researchText: string, fileText: string): boolean {
  const research = uniqueTokens(researchText);
  const file = uniqueTokens(fileText);
  for (const token of file) {
    if (research.has(token)) return true;
  }
  return false;
}

function collectEditorFiles(
  contexts: EngineerContext[],
  gitStates: Map<string, GitState> | undefined,
): EditorFile[] {
  const files = new Map<string, EditorFile>();
  const add = (editor: EditorFile): void => {
    const stem = fileStem(editor.file);
    if (!stem) return;
    files.set(`${editor.engineerId}:${stripGitPrefix(editor.file)}`, editor);
  };

  for (const [engineerId, git] of gitStates ?? []) {
    for (const changed of git.changedFiles) {
      add({ engineerId, file: changed });
    }
  }

  for (const context of contexts) {
    if (context.mode !== 'research' && context.currentFile) {
      add({
        engineerId: context.engineerId,
        file: context.currentFile,
        symbol: context.currentSymbol,
        activity: context.activity,
      });
    }
  }

  return [...files.values()];
}

export async function detectResearchOverlaps(
  contexts: EngineerContext[],
  gitStates: Map<string, GitState> | undefined,
  opts: ResearchOpts = {},
): Promise<Collision[]> {
  const similarity = opts.similarity ?? semanticSimilarity;
  const threshold = opts.threshold ?? env.RESEARCH_OVERLAP_THRESHOLD;
  const researchers = contexts.filter((c) => c.mode === 'research' && c.researchTopic);
  const editorFiles = collectEditorFiles(contexts, gitStates);
  const bestByResearcher = new Map<string, Candidate>();

  for (const researcher of researchers) {
    const topic = researcher.researchTopic?.trim();
    if (!topic) continue;
    const source = researcher.researchSource?.trim();
    const researchText = [topic, source].filter(Boolean).join(' ');

    for (const editor of editorFiles) {
      if (editor.engineerId === researcher.engineerId) continue;

      const stem = fileStem(editor.file);
      if (!stem) continue;
      const fileText = [stem, editor.symbol, editor.activity].filter(Boolean).join(' ');
      const score = await similarity(researchText, fileText);
      const matched = score === null ? fallbackMatches(researchText, fileText) : score >= threshold;
      if (!matched) continue;

      const rank = score ?? 1;
      const existing = bestByResearcher.get(researcher.engineerId);
      if (existing && existing.score >= rank) continue;

      bestByResearcher.set(researcher.engineerId, {
        score: rank,
        collision: {
          id: `col_research_${stem}_${Date.now()}`,
          podId: researcher.podId,
          file: editor.file,
          symbol: editor.symbol,
          engineers: [editor.engineerId, researcher.engineerId],
          severity: 'warn',
          overlapKind: 'research',
          researchTopic: topic,
          ...(source ? { researchSource: source } : {}),
          researcher: researcher.engineerId,
          editor: editor.engineerId,
          detectedAt: new Date().toISOString(),
        },
      });
    }
  }

  return [...bestByResearcher.values()].map((candidate) => candidate.collision);
}
