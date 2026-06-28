# Team Memory Graph — Redesign Brief (fresh-session handoff)

> **You are a fresh Claude Code session with no prior context. Read this whole file first.**
> Your job: rebuild the **live "Team memory" graph view** so the **light/real-data** version is as
> polished and functional as the original **dark Bauhaus mock**, and make the graph **dynamic**
> (force-directed + animated), not the current dead static-column layout.
> **Do not rewrite the backend materializer — it is good.** The problem is 100% the frontend rendering.

---

## 0. Mission (one paragraph)

PodMan's "Team memory" is a per-pod graph of who owns/edits which files, where work collides, and what
PodMan learned from accepted interventions — the continual-learning loop made legible in 10 seconds.
A **dark Bauhaus mock** of this view looks great (clean 3-panel layout, a learning-loop rail, an activity
stream, a readable graph). The **shipped light version on real data looks terrible** (a hairball of red
edges, overlapping labels, a static lifeless layout, and it's missing the learning-loop rail + activity
stream entirely). Make the light version match the mock's structure/polish/functionality, in the app's
**light shadcn theme**, and make the **graph dynamic** (organic force-directed layout, draggable,
animated transitions). Keep using **real data** from the existing materializer.

---

## 1. The two reference points

### A. The dark Bauhaus mock = what "good" looks like (target structure)

A single dark card titled **"PODMAN — CONTINUAL-LEARNING OBSERVATORY"** with a `LIVE · POD demo-pod`
status. Layout:

- **Left rail — WORKFLOW METRICS**: a vertical stack of bordered cards, each a big numeral + an
  UPPERCASE tracked label + a one-line detail, with a colored left-accent bar:
  `03 PODS WATCHED`, `05 ENGINEERS LIVE`, `02 COLLISIONS OPEN (▲ auth.ts critical)`,
  `01 INTERVENTION SENT`, `86% ACCEPT RATE (▲ +14% this session)`, `124 MEMORY VECTORS`.
- **Center — the GRAPH**: sparse, geometric, readable. Node shapes encode kind
  (engineer = filled square, file = outlined square, feature = circle, collision = triangle,
  intervention = diamond). One **risk path is lit** (Karti+Yahya → auth.ts → collision → sync PR →
  `learned_from`), everything else dimmed. Edges color-coded (`collides` red, `warns` amber/orange,
  `learned_from` dashed violet, `owns` blue, `editing` paper, `touches` grey).
- **Right rail — LEARNING LOOP**: a vertical 5-step stepper with the active step highlighted/pulsing:
  `01 OBSERVE (vision → 5 contexts/s)` → `02 STORE (124 vectors · Atlas)` →
  `03 PREDICT (2 collisions flagged)` [active] → `04 OUTCOME (1 accepted · 0 dismissed)` →
  `05 ADAPT (Karti→auth ownership +)`. Arrows between steps.
- **Bottom-left — ACTIVITY STREAM**: a time-stamped feed with colored kind-tags:
  `15:48 EDITING Yahya opened auth.ts — unpushed changes detected`,
  `15:48 COLLISION Critical overlap on auth.ts · Karti + Yahya`,
  `15:49 WARNS PodMan spoke: "open a sync PR?" → card sent`,
  `15:49 OUTCOME Sync PR accepted by the pod`,
  `15:49 LEARNED_FROM Memory updated: Karti owns auth (confidence ↑)`.
- **Bottom-right — SELECTED NODE**: click a node → kind / name / relationships count / severity / a
  one-line "why" (`Two engineers editing the same file before push — the signal git can't see.`).
- **Legend**: engineer / file / feature / collision / intervention · collides / warns / learned_from.

It reads in 10 seconds because it is **sparse, color-coded, and tells the loop story** with the rails +
stream, not just a node blob. (The full mock HTML/CSS is reproduced in **Appendix A** — port its
structure to light shadcn.)

### B. The shipped light version = what's wrong (the thing to fix)

Same data, but: a **hairball** — every engineer fans red `collides` edges to ~6 collision triangles
(all labeled `sync PR`); **file labels overlap** in a dim middle column; the graph uses a **static
deterministic column layout** (`x` by kind, `y` evenly spread) so it looks dead/lifeless; and it is
**missing the LEARNING LOOP rail and the ACTIVITY STREAM** entirely — it's just a metrics rail + the bare
graph + a selected-node panel. (Two already-fixed-on-branch items: garbage collision labels
`infra/README.md### Running the git watcher` and full-path bleed — see PR #7 / commit `a21a289`,
`shortLabel` in `live.ts`. Build on top of that, don't redo it.)

---

## 2. The gap to close (light vs mock)

| Mock has                                 | Light version                   | Action                             |
| ---------------------------------------- | ------------------------------- | ---------------------------------- |
| Workflow metrics rail                    | ✅ has it (3 metrics)           | keep; restyle to match             |
| **Learning loop rail (observe→…→adapt)** | ❌ missing                      | **build it** (needs live counts)   |
| **Activity stream feed**                 | ❌ missing                      | **build it** (needs an event feed) |
| Selected-node panel                      | ✅ has it                       | keep                               |
| **Dynamic / animated graph**             | ❌ static columns               | **replace the layout**             |
| Sparse, lit "risk path"                  | partial (Risk-path mode exists) | improve emphasis + spacing         |
| Legend                                   | ✅                              | keep                               |

---

## 3. Current architecture (build on this — do NOT rewrite the materializer)

**Backend (good, keep):**

- `backend/src/graph/live.ts` — `materializePodGraph(podId)`: builds the graph from the real Mongo
  collections (`pods`, `engineer_states`, `observations`, `collisions`, `interventions`, `outcomes`).
  It already de-noises hard: collapses collisions by `memorySignature`, caps to 8, collapses
  interventions to one per collision, filters junk files (`isFilePath`), prunes test-artifact engineers
  (`ENGINEER_NOISE`), caps files to 9, short labels (`shortLabel`). Output is ~20 clean nodes for
  `demo-pod`. **This is solid — extend it, don't replace it.**
- `backend/src/graph/store.ts` — `loadPodGraph(podId)`: live materializer → seeded `team_model.graph`
  → demo fallback (`createDemoPodGraph`). Plus `reachFrom` (`$graphLookup`).
- Route: `GET /api/pods/:id/graph` returns `PodGraph` (also `/graph/reach/:node`).
- `backend/src/memory/db.ts` — `collections()`, `getGitStates(podId)`, `getDb()`.
- WS bus: `backend/src/server.ts` hosts `ws /api/events` (the agent + `/api/outcome` broadcast here).

**Frontend (this is where the work is):**

- `frontend/src/components/GraphView.tsx` — **the thing you redesign** (~90% of the work). Currently:
  fetches `/api/pods/:id/graph`, renders a bespoke SVG with the static column layout, Risk/Learning/Whole
  toggles, a metrics rail, a selected-node panel, a legend. Composed from shadcn primitives (`Button`,
  `Badge`) + Tailwind utilities. Theme-aware via shadcn tokens.
- `frontend/src/lib/graph.ts` — `fetchPodGraph(podId)`.
- Opened from each `PodCard`'s `⋯` menu → "Team memory" (`onOpenGraph(pod.id)` in
  `frontend/src/App.tsx`). It is a conditional render (no route).

**Data contract** (`shared/src/graph.ts`):

```ts
PodGraph = { podId, generatedAt, nodes: PodGraphNode[], edges: PodGraphEdge[], metrics: PodGraphMetric[] }
PodGraphNode = { id, kind, label, summary, weight 0..1, status: 'stable'|'active'|'risk'|'learned', x, y }
//   kind: 'engineer'|'feature'|'file'|'collision'|'intervention'
PodGraphEdge = { id, source, target, kind, label, strength 0..1 }
//   kind: 'owns'|'editing'|'touches'|'collides'|'warns'|'learned_from'
PodGraphMetric = { label, value, detail }
```

**Theme / components (HARD RULE):** the app is **light shadcn**, built from the **ruixen registry** —
add primitives with `npx shadcn@latest add "https://ruixen.com/r/[component]"` and compose from
`@/components/ui/*` (`Button`, `Badge`, `Card`, `Tabs`, `ToggleGroup`, etc.) using the design tokens
(`var(--card)` / `--foreground` / `--muted-foreground` / `--border`, `--chart-1..5`). Only the SVG/canvas
graph is bespoke. Match `frontend/src/App.tsx`'s `StatPill`/`BriefLine` utility patterns.

---

## 4. Target design (build this)

A light shadcn page with the **mock's structure**:

```
┌───────────────────────────────────────────────────────────────────────┐
│ Header: "Team memory · What PodMan learned · <pod>"        [← Pods]      │
├───────────────────────────────────────────────────────────────────────┤
│ Toggles: Risk path | Learning edges | Whole graph   (keep)              │
├──────────────┬──────────────────────────────────┬─────────────────────┤
│ WORKFLOW     │                                  │  LEARNING LOOP        │
│ METRICS      │        DYNAMIC GRAPH CANVAS        │  observe→store→       │
│ (cards)      │   (force-directed + animated)     │  predict→outcome→     │
│              │                                  │  adapt (active pulses)│
├──────────────┴──────────────────────────────────┴─────────────────────┤
│ ACTIVITY STREAM (time-tagged feed)        │ SELECTED NODE (detail)      │
└───────────────────────────────────────────────────────────────────────┘
```

- **Light shadcn** throughout (theme-aware; follows dark mode if the app ever toggles). Keep the
  geometric **node-shape + color encoding** (it's the legible part) but on light surfaces with the
  app's hues (engineer blue `#2563eb`, file slate outline `#475569`, feature amber `#d97706`,
  collision red `#dc2626`, intervention violet `#7c3aed`; edges: collides red, warns amber,
  learned_from dashed violet, owns blue, editing slate, touches faint slate).
- **Default to "Risk path"**: light the collision→intervention→`learned_from` chain; dim the rest.

---

## 5. Make the graph DYNAMIC (the headline new requirement)

The static column layout (`live.ts` `layout()` sets `x`/`y` by kind) looks dead. Replace the frontend
rendering with a **dynamic** graph. Pick one (recommended order):

1. **`d3-force` force-directed (recommended).** Add `d3-force` (small). Run a force simulation on the
   `PodGraph` nodes/edges: link force (by `edge.strength`), charge/repulsion, center, collision radius
   (by `node.weight`). Render nodes/edges as SVG, update positions per tick. Make nodes **draggable**
   (pin on drag). Animate new nodes/edges fading in on data refresh, and the `learned_from` dashed
   stroke animating. Ignore the server's `x`/`y` (or use them as initial positions). Keep node shapes.
2. `react-force-graph` / `force-graph` (canvas) — heavier, faster for big graphs; overkill at ~20 nodes
   but fine.
3. A custom animated **layered** layout (engineers → files → collisions → interventions columns, but
   with curved edges, eased position transitions on refresh, and gentle idle motion). Lighter-weight
   than d3-force; still feels alive if you animate transitions.

**Realtime/dynamic data:** poll `GET /api/pods/:id/graph` every ~5s and **animate the diff** between
snapshots (don't hard-replace). Optionally subscribe to `ws /api/events` for instant nudges. New
collisions/interventions should visibly animate in; the `learned_from` edge + gold node should pop on a
new accepted outcome.

**De-hairball:** even force-directed, ~6 collisions × 3 engineers = many `collides` edges. Mitigate:
bundle/curve edges, lower non-risk edge opacity, default to Risk-path emphasis, size nodes by `weight`,
and keep label collision-avoidance (offset labels, hide on overlap, show on hover/select).

---

## 6. Data for the new panels (extend the materializer or add endpoints)

The mock's **Learning Loop** and **Activity Stream** need data the current `PodGraph` doesn't carry. Two
options: (a) extend `materializePodGraph` to also return `loop` + `activity`, or (b) add small endpoints.
Recommended: extend the return type (additive to `shared/src/graph.ts`).

- **Learning loop counts** (`observe→store→predict→outcome→adapt`):
  - observe = recent `observations` count (e.g. last 60s) / rate
  - store = `memory_vectors` or `collisions.embedding` count (Voyage vectors)
  - predict = open `collisions` (distinct signatures) count
  - outcome = `outcomes` accepted vs dismissed counts
  - adapt = `team_model.ownership` entries / learned owners count
  - mark the "active" stage = the most recent activity.
- **Activity stream**: merge + time-sort recent events from `collisions.detectedAt`,
  `interventions.createdAt`, `outcomes.recordedAt`, `engineer_states.gitUpdatedAt` → a typed feed
  `{ at, kind: 'editing'|'collision'|'warns'|'outcome'|'learned_from', text }`. Cap to ~8 most recent.

(`backend/src/memory/db.ts` `collections()` gives you `observations/collisions/interventions/outcomes`;
`getGitStates` gives engineer_states; `team_model` is `db.collection('team_model')`.)

---

## 7. Files to touch

- **`frontend/src/components/GraphView.tsx`** — the redesign (force-directed graph + 3-panel layout +
  learning-loop rail + activity stream). May split into `GraphCanvas.tsx`, `LearningLoop.tsx`,
  `ActivityStream.tsx`, `MetricsRail.tsx`.
- **`frontend/src/lib/graph.ts`** — add fetches for loop/activity if you add endpoints.
- **`backend/src/graph/live.ts`** (extend, don't rewrite) — emit `loop` + `activity` in the result;
  keep all the de-noise.
- **`shared/src/graph.ts`** — add `loop`/`activity` types to `PodGraph` (additive).
- **deps** — `d3-force` (+ `@types/d3-force`) via pnpm in `frontend`.
- Possibly add a ruixen primitive (e.g. `timeline`, `stepper`) via the shadcn CLI if one fits.

---

## 8. Constraints & gotchas (READ — these will bite you)

- **The materializer is good — do not rewrite it.** It already de-noises (caps, collapse-by-signature,
  engineer/file filters, short labels). The bad UI is the **frontend layout/render**, not the data.
- **PWA service worker caches aggressively** — after any deploy, hard-refresh (Cmd-Shift-R) or test in a
  private window, or you'll think nothing changed.
- **Deploy = merge to `main`** (DO `deploy_on_push: true`). `main` is shared by ~4 engineers and moves
  fast. Work on a branch, open a PR, merge. Don't push to `main` directly.
- **`learned_from` "money" edge won't render on `demo-pod`** right now — its one accepted outcome is
  orphaned (points at a collision deleted by test churn). It needs **one intact accept flow** (real
  collision → intervention → someone clicks Accept) to draw. To demo, seed a clean chain or clear test
  docs (writes to shared Atlas — confirm scope first).
- **Atlas creds rotate frequently** — `podman/.env`'s `MONGODB_URI` may be stale; the **deployed env**
  has the working one. If local Mongo auth fails, that's why.
- **Build verification**: some sandboxes can't run `pnpm`/`vite`/shadcn deps (`lucide-react`,
  `@radix-ui`). Verify the frontend with `pnpm build` in a real env or CI before merging. Backend
  typecheck excludes uninstalled `ws`/`sharp`/`@livekit/rtc-node` noise.
- **Compose from ruixen/shadcn primitives** (`npx shadcn add ruixen.com/r/[component]`,
  `@/components/ui/*`); only the SVG/canvas graph is bespoke. Match `StatPill`/`BriefLine` in `App.tsx`.
- **Light theme + tokens** — never hardcode dark colors for chrome; use `var(--card)/--foreground/…`.
  Keep fixed semantic hues only for the node/edge kind encoding.

---

## 9. Acceptance criteria

- Light Team-memory page matches the mock's structure: **metrics rail + dynamic graph + learning-loop
  rail + activity stream + selected-node panel + legend**.
- **Graph is dynamic**: force-directed (or animated layered), **draggable**, **animates** new
  nodes/edges and refresh transitions; **no overlapping labels, no hairball**.
- Reads in 10s; the **risk/money path is obvious** by default.
- **Light shadcn** theme, theme-aware; composed from ruixen primitives.
- Uses **real data** from `materializePodGraph`; graceful demo fallback when empty.
- `pnpm build` + typechecks pass; deploys; verified after a hard-refresh.

---

## 10. Suggested first moves for the new session

1. Read this file + `docs/graph.md` + `docs/live-ui-spec.md` (R1/R2 sections) + `CLAUDE.md`.
2. `git fetch`; branch off `main` (or `feat/live-graph-glue`, which has the latest graph work).
3. Hit the live data once: `curl https://165-22-129-249.sslip.io/api/pods/demo-pod/graph` — that's the
   real `PodGraph` you'll render.
4. Build a `d3-force` `GraphCanvas` first (replace the static layout), get it draggable + animated.
5. Add `LearningLoop` + `ActivityStream` (extend the materializer to feed them).
6. Polish to the mock; `pnpm build`; PR → main → redeploy → hard-refresh.

---

## Appendix A — the dark mock (reference structure to port to light)

The mock is a single dark card. Structure + the exact content to reproduce (in light shadcn):

- Header: brand glyph (blue square + amber circle + red triangle + outlined square) + `PODMAN /
CONTINUAL-LEARNING OBSERVATORY` + `● LIVE · POD demo-pod`.
- Grid `180px 1fr 196px`: **metrics rail** | **graph** | **learning-loop rail**.
- Metrics cards: big `Archivo`-weight numeral, uppercase tracked label, muted detail, colored
  left-accent (blue/red/yellow/violet/green).
- Graph: SVG, geometric node shapes by kind, color-coded edges, one lit risk path, dim others; click a
  node → highlight its incident edges + neighbors, fill the selected-node panel.
- Learning-loop rail: 5 bordered steps with number + UPPERCASE title + muted sub; the active step has a
  pulsing left bar; `↓` arrows between.
- Legend row (node kinds + edge kinds).
- Activity stream (time + colored tag + text) and selected-node panel below.

Palette used (port to shadcn tokens for chrome; keep these as node/edge hues):
`bg #0c0c0e`, `panel #141417`, `line #2a2a31`, `paper/text #ECE7DA`, `muted #8d897e`,
`blue #3B5BFF`, `red #E2403A`, `amber #F6C445`, `violet #8b6cff`, `green #46c07a`.
For light: chrome → `var(--card)/--foreground/--border/--muted-foreground`; node/edge hues →
blue `#2563eb`, slate `#475569`, amber `#d97706`, red `#dc2626`, violet `#7c3aed` (light-readable).

> The dark mock was a `show_widget` demo (not a saved file). If you want the literal HTML/CSS, ask the
> user to paste it, or reconstruct from this appendix — the **structure + content above is the spec**.
> Goal: same structure, same legibility, **light theme + dynamic graph**.
