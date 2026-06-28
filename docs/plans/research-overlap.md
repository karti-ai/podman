# Build spec: cross-channel overlap (code-edit ↔ research nudge)

> Self-contained spec for an implementing agent. Everything needed to build is
> here: current-state anchors, exact edits, code sketches, verification. Read
> the referenced files before editing.

## Context / why

Today PodMan only fires when **two engineers touch the same file** (basename
match) with unpushed changes — `backend/src/collision/detector.ts:36`. That makes
the system feel like a one-file trick. The wow we want: detect a **code↔research
overlap** — one teammate is *editing* `livekit.py` while another is *researching*
the same topic in a browser (LiveKit docs/SDK). PodMan nudges:

> 🤝 bob is deep in LiveKit docs while you edit livekit.py — sync up before duplicating effort.

This reframes PodMan from merge-conflict detector to a **team-coordination agent
that catches duplicated effort / knowledge overlap** — stronger continual-learning
story, distinct demo beat.

### Locked decisions
- **Signal capture:** Gemini vision on the existing LiveKit screenshare. When a
  teammate shares a browser/docs window, vision classifies it `research` and
  extracts `{researchTopic, researchSource}`. No browser extension, no new client
  surface. Reuses `backend/src/agent.ts` + `backend/src/vision/gemini.ts`.
- **Matching:** semantic embeddings (reuse `embed()` + `cosine()` in
  `backend/src/memory/vectors.ts`). Deterministic stem/keyword fallback fires when
  an embed call returns `null`, so the demo path never depends on a live vector call.
- **Framing:** collaboration nudge (`ping_teammate`), spoken once for the beat.

## Current-state anchors (read these first)

- `backend/src/collision/detector.ts:14-20` — `fileKey()` stem/basename logic to mirror.
- `backend/src/collision/detector.ts:36-89` — `detectCollisions()` (same-file path; leave unchanged).
- `backend/src/agent/podman.ts:85-116` — `onScreenFrame()` orchestration; `:124-126` `conflictKey()`; `:128-183` `handle()`.
- `backend/src/agent/podman.ts:38-46` — `engineersOverlapOnFile()` (git ground-truth; research must skip it).
- `backend/src/vision/gemini.ts:7-70` — `SCHEMA`, prompt, and `EngineerContext` mapping.
- `backend/src/memory/vectors.ts:52-66` `cosine()`, `:68-70` private `embed()`.
- `backend/src/action/hermes.ts:46-62` — `publishHermesIntervention()` (speaks only if `voiceLine` passed).
- `frontend/src/livekit/useInterventions.ts:36-48` — data-channel handler (renders `intervention.message` verbatim).
- `shared/src/engineer.ts:6-23` `EngineerContext`; `shared/src/collision.ts:7-28` `Collision`.

**Off-spec gate:** nothing in `docs/` covers cross-channel overlap. Update specs
in step 1 **before** code (repo documentation-first rule).

## Concurrency / safety (several people build at once)

- Shared-contract edits are **additive optional fields only** — no signature
  changes. Safe.
- `backend/src/agent/podman.ts` is hot: two in-place edits (`conflictKey`,
  `handle` branch). `git pull --rebase` before pushing.
- **No required frontend change** — nudge text rides in `intervention.message`,
  already rendered by `frontend/src/components/PodView.tsx`.

## Implementation steps

### 1. Specs first
- `docs/gemini.md` — vision classifies `editing` vs `research`; extracts `researchTopic`/`researchSource`.
- `docs/hermes.md` — new intervention type **research overlap** (collaboration nudge, `ping_teammate`, spoken once); explicitly NOT a merge conflict.
- `docs/mongodb.md` — new optional `Collision` fields.
- `docs/demo.md` — insert ~30s beat after the same-file collision.

### 2. Shared contract (additive, optional)
`shared/src/engineer.ts` — add to `EngineerContext`:
```ts
mode?: 'editing' | 'research';
researchTopic?: string;
researchSource?: string;   // domain, e.g. "docs.livekit.io"
```
`shared/src/collision.ts` — add to `Collision`:
```ts
overlapKind?: 'file' | 'research'; // undefined = file (preserves current behavior)
researchTopic?: string;
researchSource?: string;
researcher?: string;               // engineer doing research
editor?: string;                   // engineer editing the file
```

### 3. Vision: classify editing vs research
`backend/src/vision/gemini.ts` — extend `SCHEMA` with `mode`, `researchTopic`,
`researchSource` (+ propertyOrdering). Update the prompt so a browser/docs/SDK
frame returns `mode:'research'` + topic + source domain, else `mode:'editing'`
with existing IDE fields. Map new fields into the returned `EngineerContext`.
Keep `thinkingConfig.thinkingBudget:0` and `MEDIA_RESOLUTION_LOW`.

### 4. Semantic matcher helper (reuse embed/cosine)
`backend/src/memory/vectors.ts` — add and export:
```ts
export async function semanticSimilarity(a: string, b: string): Promise<number | null> {
  const [va, vb] = await Promise.all([embed(a, 'query'), embed(b, 'document')]);
  if (!va || !vb) return null;
  return cosine(va, vb);
}
```

### 5. New detector (additive file)
`backend/src/env.ts` — add `RESEARCH_OVERLAP_THRESHOLD` (default `0.6`).

`backend/src/collision/research.ts` (new):
```ts
export interface ResearchOpts { similarity?: (a: string, b: string) => Promise<number | null>; threshold?: number; }
export async function detectResearchOverlaps(
  contexts: EngineerContext[],
  gitStates: Map<string, GitState> | undefined,
  opts: ResearchOpts = {},
): Promise<Collision[]>;
```
Logic:
- **researchers** = contexts with `mode==='research'` && `researchTopic`.
- **editor files** = ground truth from `gitStates[*].changedFiles` (reliable) plus
  any `mode==='editing'` `currentFile`; each tagged with its engineer.
- For each distinct (researcher, editor) pair on a file, score
  `similarity("${topic} ${source}", "<file stem words> <symbol> <activity>")`
  (default `similarity = semanticSimilarity`). Fire when `score >= threshold`
  (default `RESEARCH_OVERLAP_THRESHOLD`).
- **Fallback:** if `score === null`, deterministic stem/token overlap (mirror
  `fileKey()` stemming) — guarantees `livekit` ↔ `livekit.py` fires offline.
- Dedupe to best-scoring file per researcher; require distinct engineers.
- Emit `Collision`: `id: col_research_<stem>_<Date.now()>`, `engineers:[editor, researcher]`,
  `file:<editor file>`, `severity:'warn'`, `overlapKind:'research'`, plus
  `researcher`, `editor`, `researchTopic`, `researchSource`.

### 6. Wire into orchestrator — `backend/src/agent/podman.ts`
- In `onScreenFrame`, after `detectCollisions(...)` (line ~100):
  ```ts
  const research = await detectResearchOverlaps([...this.contexts.values()], gitStates);
  const collisions = [...fileCollisions, ...research];
  ```
  (concat **before** the re-arm + handle loops at `:104` / `:111` / `:115`).
- `conflictKey()` (`:124`) — namespace by overlap kind so research and file
  overlaps on the same file don't share an edge-trigger key:
  ```ts
  return `${collision.overlapKind ?? 'file'}:${comparableBasename(collision.file)}`;
  ```
- `gitOverlap` loop (`:111-113`) — guard: only call `engineersOverlapOnFile` when
  `collision.overlapKind !== 'research'` (researcher won't have the file dirty;
  leave `gitOverlap` undefined for research).
- `handle()` (`:128`) — branch on `overlapKind === 'research'`:
  - `message`: `` `🤝 ${researcher} is researching ${researchTopic}` + (researchSource ? ` (${researchSource})` : '') + ` while ${editor} edits ${shortFile} — sync up before duplicating effort.` ``
  - `voiceLine`: `` `${researcher} is researching ${researchTopic} while ${editor} works on ${shortFile}. Worth a quick sync.` ``
  - `suggestedAction.kind = 'ping_teammate'`.
  - Pass `voiceLine` to `publishHermesIntervention` **regardless of severity** so
    the beat is spoken once. (For file collisions keep existing
    `severity === 'critical' ? voiceLine : undefined`.)
  - Existing `recallSimilar` / `shouldIntervene` gate stays unchanged.

### 7. Frontend (nice-to-have, cut if behind)
`frontend/src/livekit/useInterventions.ts` — capture `msg.collision.overlapKind`;
show a 🤝 badge on the card in `PodView.tsx`. Core path needs nothing.

## Verification

1. **Build:** `pnpm -r build` (shared builds first — order matters).
2. **Detector (offline, deterministic):** harness calling `detectResearchOverlaps`
   with stubbed `opts.similarity`:
   - researcher `{mode:'research', researchTopic:'LiveKit agent init', researchSource:'docs.livekit.io'}`
     + gitState with `livekit.py` dirty for another engineer → exactly one
     `overlapKind:'research'` collision naming both.
   - single engineer both sides → no overlap.
   - `similarity` returns `null` → keyword fallback still fires on `livekit`.
3. **Live:** run the agent (systemd on the box, or local); one participant shares a
   browser tab on LiveKit docs, another keeps `livekit.py` dirty (git sidecar
   running) → 🤝 nudge card + one-time spoken cue. Fires once (edge-triggered),
   re-arms after the browser closes.
4. **Regression:** same-file collision still fires, unaffected (separate
   `conflictKey` namespace).
