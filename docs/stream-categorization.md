# Stream Categorization — My Stream / Team Stream

## Why

Judges must read the pod stream in 10 seconds. Right now both lanes (`My stream`,
`Team stream`) dump every event into one flat chronological list. The two things
that prove "self-improving agent" are mushed together:

- **Sources of decisions** — raw signals the agent observed (screen vision, git).
- **Reasoning decisions** — what Hermes concluded and did (conflict detected,
  intervention spoken, outcome/verifier result).

`source` (vision/git/memory/hermes/policy) is currently buried as a plain outline
badge next to the filename. `kind` is only an icon. No sectioning. Result: bloated,
undifferentiated, doesn't tell the loop story (observe → reason → act → learn).

## Goal

Split each stream lane into clear sections and promote provenance, so a judge sees:
"agent ingests **signals**, then makes **reasoning decisions** from them."

No backend / shared-type changes. The data already carries `kind` + `source`.
Pure presentation change in `frontend/src/components/PodView.tsx` —
`ActivitySidebar` + `ActivityItem` + new helpers only. Additive, localized.

## Categorization (the contract)

Two sections, derived from existing `PodActivityKind`:

| Section | Heading | kinds | Meaning |
|---|---|---|---|
| `signal` | **Signals** | `observation`, `git` | Raw inputs the agent saw. The *sources*. |
| `decision` | **Reasoning & decisions** | `collision`, `intervention`, `outcome` | What Hermes reasoned and did. |

```ts
const CATEGORY_OF: Record<PodActivityKind, 'signal' | 'decision'> = {
  observation: 'signal',
  git: 'signal',
  collision: 'decision',
  intervention: 'decision',
  outcome: 'decision',
};
```

Section order: **Signals** first, **Reasoning & decisions** second (top-to-bottom =
the loop direction). A section with zero events renders nothing.

## Provenance chip (sources)

Promote `source` to a leading color-coded chip with an icon. This is the "source of
decision" tag judges look for.

| source | label | icon | tint |
|---|---|---|---|
| `vision` | Vision | `EyeIcon` | chart-1 |
| `git` | Git | `GitBranchIcon` | chart-2 |
| `memory` | Memory | `BrainIcon` | chart-4 |
| `hermes` | Hermes | `SparklesIcon` | primary |
| `policy` | Policy | `ShieldIcon` | chart-3 |

Chip class pattern (use `variant="outline"` so the default primary fill is overridden):
`border-{tint}/40 bg-{tint}/10 text-{tint}`.

## Kind label

Render `kind` as readable text next to the provenance chip, not just an icon:

| kind | label |
|---|---|
| observation | Observed |
| git | Git |
| collision | Conflict |
| intervention | Intervention |
| outcome | Outcome |

Tag row order in each card: **source chip → kind label → actors → file**.

## Implementation steps (after teammate lands frontend work)

1. **Rebase / pull teammate's PodView.tsx first.** Do not start before it lands —
   this file is being actively rewritten right now.
2. Add icon imports: `BrainIcon`, `EyeIcon`, `ShieldIcon`, `WorkflowIcon` (and
   reuse `GitBranchIcon`, `SparklesIcon`, `RadioTowerIcon`). Import
   `PodActivitySource` type from `@podman/shared`.
3. Add module-level consts: `CATEGORY_OF`, `CATEGORIES` (id/label/hint/icon),
   `SOURCE_META` (label/icon/className), `KIND_LABEL`.
4. In `ActivitySidebar`'s expanded `SidebarContent`, replace the flat
   `events.map(...)` with a `CATEGORIES.map(...)` that filters events per category,
   skips empty sections, and renders a section header (icon + label + count + hint)
   above each group.
5. In `ActivityItem`, replace the buried source `<Badge variant="outline">{source}</Badge>`
   with the colored provenance chip + a kind-label badge; keep actors and file badges.
6. Collapsed icon-rail (the `group-data-[collapsible=icon]` mini list) stays flat —
   no sectioning needed there.
7. Verify: `pnpm --filter @podman/frontend build` typechecks; empty-state and a
   live pod with mixed events both render correctly.

## Out of scope (do not do)

- No changes to `shared/src/activity.ts`, the SSE hook, or backend event emission.
- No new event kinds/sources.
- No third section / per-kind lanes — two buckets is the whole point (signals vs
  reasoning). Keeps a sparse demo stream from fragmenting.

## Merge-safety note

Single file, two functions. Hold until the teammate improving the frontend pushes,
then pull and apply on top to avoid clobbering their design pass.
