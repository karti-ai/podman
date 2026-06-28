# Build spec: Work History "Coordination ROI" band

> Self-contained spec for an implementing agent. Everything needed to build is
> here: current-state anchors, exact edits, code sketches, verification. Read
> the referenced files before editing. Changes are **additive** — one optional
> field on a shared type, two new backend queries, one new presentational
> component. No route signature changes, no DB writes, no new deps.

## Context / why

The Work History dialog (opens when you click a teammate's "History" button)
today shows three raw counters (files / screen logs / git changes), a Recent
files bar list, and a Timeline. It is pure **activity volume** — it summarizes
nothing and shows none of PodMan's actual value.

We add a **Coordination ROI band** at the top of the dialog that answers "what
did PodMan save this person?": estimated rework-hours saved by clashes Hermes
caught early, plus hard defensible counts. This is a *summary* layer — it must
NOT re-stream the pod activity feed ("Team Memory"). Existing Recent files +
Timeline sections stay exactly as they are, below the new band.

### Locked decisions
- **Primary story = saved time / ROI.** One number leads: `~Xh Ym rework saved`.
- **Transparent heuristic.** The hours are a labeled estimate (`~`, `(est.)`)
  with an info tooltip showing the per-clash breakdown. Technical judges can see
  the model; we never claim precision.
- **Backend extension required** (collisions/interventions are not in the
  current `MemberWorkHistory` payload). Field is optional → old frontends and
  pods with no collisions degrade gracefully (band hidden).
- **Cut:** editing/research focus donut. ROI is the single story; a donut
  dilutes it.
- **Credit split** across involved engineers so a 2-person clash does not
  double-count the pod total.

## Heuristic (this is the contract — implement exactly)

For each `collisions` doc in the window where the member is involved AND an
`interventions` doc exists for it (Hermes actually surfaced it):

1. **Eligibility (must be "real"):** count the collision only if
   `gitOverlap === true` OR `severity === 'critical'`. Otherwise skip.
2. **Weight by kind/severity:**
   | condition | minutesEach |
   |---|---|
   | `overlapKind === 'research'` | 10 |
   | `severity === 'critical'` (same-file) | 45 |
   | `severity === 'warn'` (same-file) | 20 |
   | `severity === 'info'` (same-file) | 10 |
   (Evaluate research first; a research overlap is always 10 regardless of severity.)
3. **Member share:** `minutesEach / max(1, engineers.length)`. Sum all shares →
   `savedMinutes` (round to nearest integer).
4. **breakdown[]:** group eligible collisions by label
   (`"critical same-file"`, `"warn same-file"`, `"research overlap"`, etc.),
   each entry `{ label, count, minutesEach }` — for the tooltip.

Member "involved" = `engineers` array contains the member (case-insensitive),
OR `researcher`/`editor` equals the member (case-insensitive). Reuse the
existing `sameMember()` helper logic.

Hard counts (no estimation):
- `clashesCaught` = number of eligible collisions (the integer behind the hours).
- `filesDeconflicted` = distinct `collision.file` values across eligible collisions.
- `conflictFreeCommits` / `totalCommits`: see "commits" note below.

### Commits note (keep simple, defensible)
There is no per-commit log in the window. Use the git ground-truth we have:
`totalCommits` = count of distinct `changedFiles` for the member from
`engineer_states` (already loaded as `gitState.changedFiles.length`).
`conflictFreeCommits` = `totalCommits - filesDeconflicted` (clamped ≥ 0). This
reads as "files in flight that never hit a clash". Label it in the UI as
**"conflict-free files"**, not commits, so the wording matches the data. (The
band copy below already says "files".)

## Current-state anchors (read these first)

- `shared/src/member-history.ts:24-36` — `MemberWorkHistory` interface (add `roi?`).
- `backend/src/activity/member-history.ts:73-174` — `getMemberWorkHistory()`.
  - `:83-94` — the `Promise.all` that loads `observations` + `engineer_states`. Add collisions/interventions here.
  - `:45-47` — `sameMember()` helper to reuse for involvement check.
  - `:124` — `gitState` already in scope; `:169` uses `gitState.changedFiles.length`.
  - `:161-173` — the returned object (add `roi`).
- `backend/src/memory/db.ts:47-48` — canonical collection names `collisions`, `interventions` (typed `Collision`, `Intervention`).
- `backend/src/activity/store.ts:167-178` — reference query shape for both collections.
- `shared/src/collision.ts:7-36` — `Collision` (`engineers`, `severity`, `overlapKind`, `gitOverlap`, `researcher`, `editor`, `file`, `detectedAt`).
- `shared/src/intervention.ts:8-18` — `Intervention` (`collisionId`, `podId`).
- `frontend/src/components/PodView.tsx:33-35` — type imports from `@podman/shared`.
- `frontend/src/components/PodView.tsx:1035-1041` — the `history && !loading && !error` block; the 3-stat grid is the insert point (band goes ABOVE it).
- `frontend/src/components/PodView.tsx:1093-1100` — `HistoryStat` (style reference for new sub-stats).
- `frontend/src/components/PodView.tsx` — `timeLabel()` exists for relative time; reuse if needed.
- Route is unchanged: `backend/src/server.ts:502-506` already returns whatever `getMemberWorkHistory` produces.

## Edit 1 — shared type (`shared/src/member-history.ts`)

Add to the `MemberWorkHistory` interface (after `timeline`):

```ts
  /** Coordination ROI summary — clashes Hermes caught for this member. Optional
   * so pods with no collisions / older payloads render without the band. */
  roi?: MemberWorkHistoryRoi;
}

export interface MemberWorkHistoryRoi {
  /** Estimated rework minutes saved (heuristic, labeled "~/est." in UI). */
  savedMinutes: number;
  /** Eligible collisions caught early (hard count). */
  clashesCaught: number;
  /** Distinct files that hit an eligible clash. */
  filesDeconflicted: number;
  /** Member files in flight that never hit a clash. */
  conflictFreeFiles: number;
  /** Total member files in flight (git changedFiles). */
  totalFiles: number;
  /** Per-kind breakdown for the tooltip. */
  breakdown: { label: string; count: number; minutesEach: number }[];
}
```

`shared/src/index.ts:56-59` already re-exports the member-history types via a
`export type { ... }` block — add `MemberWorkHistoryRoi` to that list.

## Edit 2 — backend (`backend/src/activity/member-history.ts`)

1. Import the types: `import type { Collision } from '@podman/shared';` (Intervention only needs `collisionId`, can stay untyped or import too).
2. In the `Promise.all` at `:83`, add two queries (windowed, podId-scoped):

```ts
db.collection<Collision>('collisions')
  .find({ podId, detectedAt: { $gte: since } }, { projection: { _id: 0 } })
  .sort({ detectedAt: -1 })
  .limit(200)
  .toArray(),
db.collection<{ collisionId: string }>('interventions')
  .find({ podId }, { projection: { collisionId: 1, _id: 0 } })
  .toArray(),
```

3. After building `fileRows`, compute `roi` with a new local helper
   `computeRoi(member, collisions, interventions, gitState)`:

```ts
function computeRoi(
  member: string,
  collisions: Collision[],
  interventionCollisionIds: Set<string>,
  changedFileCount: number,
): MemberWorkHistoryRoi {
  const involved = (c: Collision) =>
    c.engineers?.some((e) => sameMember(e, member)) ||
    sameMember(c.researcher, member) ||
    sameMember(c.editor, member);

  const eligible = collisions.filter(
    (c) =>
      involved(c) &&
      interventionCollisionIds.has(c.id) &&
      (c.gitOverlap === true || c.severity === 'critical'),
  );

  const weightOf = (c: Collision): { label: string; minutes: number } => {
    if (c.overlapKind === 'research') return { label: 'research overlap', minutes: 10 };
    if (c.severity === 'critical') return { label: 'critical same-file', minutes: 45 };
    if (c.severity === 'warn') return { label: 'warn same-file', minutes: 20 };
    return { label: 'info same-file', minutes: 10 };
  };

  let savedMinutes = 0;
  const groups = new Map<string, { count: number; minutesEach: number }>();
  for (const c of eligible) {
    const { label, minutes } = weightOf(c);
    savedMinutes += minutes / Math.max(1, c.engineers?.length ?? 1);
    const g = groups.get(label) ?? { count: 0, minutesEach: minutes };
    g.count += 1;
    groups.set(label, g);
  }

  const filesDeconflicted = new Set(eligible.map((c) => c.file)).size;
  const totalFiles = changedFileCount;
  return {
    savedMinutes: Math.round(savedMinutes),
    clashesCaught: eligible.length,
    filesDeconflicted,
    conflictFreeFiles: Math.max(0, totalFiles - filesDeconflicted),
    totalFiles,
    breakdown: [...groups.entries()].map(([label, g]) => ({
      label,
      count: g.count,
      minutesEach: g.minutesEach,
    })),
  };
}
```

4. Build the intervention id set and attach to the return:

```ts
const interventionIds = new Set(interventions.map((i) => i.collisionId));
const roi = computeRoi(member, collisions, interventionIds, gitState?.changedFiles?.length ?? 0);
```

Add `roi` to the returned object at `:161-173`. Always return it (it self-zeroes
when there are no clashes); the frontend decides whether to show the band based
on `clashesCaught`/`savedMinutes`.

> Note `Collision.id` survives the `{ _id: 0 }` projection — `id` is a real field
> (`shared/src/collision.ts:8`), distinct from Mongo `_id`. Do not project it out.

## Edit 3 — frontend (`frontend/src/components/PodView.tsx`)

1. Add `MemberWorkHistoryRoi` to the `@podman/shared` type import (`:33-35`).
2. Insert `<RoiBand roi={history.roi} />` immediately inside the
   `history && !loading && !error` block, BEFORE the `grid ... sm:grid-cols-3`
   stat grid (`:1037`).
3. New presentational component (place near `HistoryStat`, `:1093`):

```tsx
function formatSaved(minutes: number): string {
  if (minutes < 60) return `~${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `~${h}h ${m}m` : `~${h}h`;
}

function RoiBand({ roi }: { roi?: MemberWorkHistoryRoi }) {
  if (!roi || roi.clashesCaught === 0) return null; // no clashes → no band
  const conflictFree = roi.totalFiles
    ? Math.round((roi.conflictFreeFiles / roi.totalFiles) * 100)
    : 100;
  return (
    <section className="rounded-lg border bg-primary/5 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="font-mono text-2xl font-semibold">{formatSaved(roi.savedMinutes)}</p>
            <span className="text-sm text-muted-foreground">rework saved</span>
            <RoiTooltip roi={roi} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            estimated · clashes caught pre-commit
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-medium">{roi.clashesCaught}</p>
          <p className="text-xs text-muted-foreground">clashes caught early</p>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${conflictFree}%` }} />
      </div>
      <p className="mt-1.5 text-[0.68rem] text-muted-foreground">
        conflict-free: {roi.conflictFreeFiles} of {roi.totalFiles} files ·{' '}
        {roi.filesDeconflicted} auto-deconflicted
      </p>
    </section>
  );
}
```

4. Tooltip — reuse the existing Tooltip primitives already imported in this file
   (`Tooltip`, `TooltipTrigger`, `TooltipContent` — see the History button at
   `:982-988`). `RoiTooltip` renders an `ⓘ`/`InfoIcon` trigger; content lists
   `breakdown` rows as `{count} × {minutesEach}m  {label}` plus a footer line
   `"split across engineers · est. only"`. Keep it a few lines.

## Verification

```bash
pnpm -r build            # @podman/shared first, then backend + frontend typecheck
```
Manual / demo check (against a pod that has collisions, e.g. demo-pod):
1. Open the app, click a teammate who was in a clash → History.
2. Band shows at top: `~Xh Ym rework saved`, clashes-caught integer, conflict-free bar.
3. Hover `ⓘ` → breakdown rows match the heuristic table.
4. Click a teammate with **no** clashes → band absent, rest of dialog unchanged.
5. Existing Recent files + Timeline sections render unchanged below the band.

Quick data sanity (optional, on the box or via mongosh):
```js
db.collisions.find({ podId: "demo-pod" }).count()       // > 0 for a real band
db.interventions.find({ podId: "demo-pod" }).count()    // surfaced clashes
```

## Coordination / merge risk (team is concurrent)

- Touches two shared hot files: `shared/src/member-history.ts` and
  `frontend/src/components/PodView.tsx`. Both edits are **additive** (one
  optional field + one new component + one insert line). Low conflict risk, but
  announce before pushing.
- `git pull --rebase origin main` immediately before push. Never force-push main.
- No changes to `/api/...` route signatures, no new deps, no Mongo writes.

## Deploy (after merge, on the box — see CLAUDE.md ops)

```bash
cd /root/podman && git pull && pnpm -r build
rm -rf /var/www/podman/* && cp -r frontend/dist/* /var/www/podman/
systemctl restart podman-platform-api podman-platform-agent
```
(Frontend-visible change + backend payload change → both the static build and
the API service must be refreshed.)
