# Claude Code Handoff — Team-Memory **Dynamic Graph** (redesign + deploy reconciliation)

> **Fresh-session handoff.** Read this top-to-bottom before touching the Team-memory graph.
> It captures the dynamic-graph redesign, the honest-metrics fix, the click-to-explain "Flow"
> pane, and — most importantly — how it was **reconciled against `main`'s parallel
> implementation** so it can actually deploy. Author: Claude Code (Opus 4.8) session, 2026-06-28.

---

## 0. TL;DR — what to do next

1. **Merge [PR #38](https://github.com/karti-ai/podman/pull/38) → `main`.** It is `MERGEABLE` (no conflicts) and is the deploy path. Deploy = push to `main` (`deploy_on_push`).
2. **After deploy, hard-refresh** (Cmd-Shift-R) or use a private window — the PWA service worker caches aggressively, so you'll think nothing changed.
3. **Close [PR #22](https://github.com/karti-ai/podman/pull/22)** (the older one into `feat/live-graph-glue`) with a note pointing at #38; it is superseded for the deploy path.
4. Optionally delete the stale branches `feat/live-graph-glue` and `feat/team-memory-dynamic-graph` once #38 lands.

**State right now:** the live site (`165-22-129-249.sslip.io` / `podman.live`) runs `main`, which has a **static** graph with **inflated metrics** and **does not render the learning-loop / activity rails** (even though its backend computes them). PR #38 fixes all three.

---

## 1. Branches, PRs, deploy

| Branch | What's on it | Status |
| --- | --- | --- |
| `main` | Trunk. Has a **parallel** Team-memory impl: computes `loop`/`activity` in the API (rich types) but **static** graph, **inflated** metrics, rails **never rendered**. Deployed. | live |
| `feat/team-memory-deploy` | **The reconciliation.** Dynamic graph + honest metrics + Flow pane, on top of `main`, rails adapted to `main`'s types. | **PR #38 → `main`, MERGEABLE** |
| `feat/live-graph-glue` | Where the original redesign (v1) was merged (PR #22). Branched ~100 commits before `main`'s later work; a direct merge to `main` was unsafe/tangled. | superseded by #38 |
| `feat/team-memory-dynamic-graph` | v1 PR branch (merged into glue via #22). | superseded |

- **Deploy = merge/push to `main`.** Do **not** push to `main` directly; merge the PR. `main` is shared by ~4 engineers and moves fast.
- Live API to sanity-check: `curl https://165-22-129-249.sslip.io/api/pods/demo-pod/graph`.

---

## 2. The divergence (read this — it's the crux)

While the dynamic-graph redesign was being built on `feat/live-graph-glue`, **another engineer shipped a *parallel* version of the same feature on `main`.** They are not the same:

| Concern | `main` (deployed) | This redesign (PR #38) |
| --- | --- | --- |
| Graph layout | **Static** — renders server `x`/`y` columns, no motion | **Dynamic** force-directed (`forceSim.ts`), draggable, animated |
| Learning-loop rail | **Computed in API, never rendered** | Rendered (`LearningLoop.tsx`) |
| Activity stream | **Computed in API, never rendered** | Rendered (`ActivityStream.tsx`) |
| Metric cards | **Inflated** (raw collision-signature / accepted-outcome counts → e.g. 50 risk paths for 4 files) | **De-noised** (distinct collision files / owner engineers) |
| Selected-node pane | kind/status/relationships | + **Flow** narrative ("Karti and Yahya are both editing auth.ts…") |
| `loop` type | `PodLearningLoop` = `{ activeStep, steps: PodLearningLoopStep[] }` (richer; step `status`) | **kept `main`'s** |
| `activity` type | `PodGraphActivity` = `{ id, at, kind, title, detail, nodeId?, edgeId? }` (richer) | **kept `main`'s** |

**Reconciliation strategy (what PR #38 does):** keep `main` as the trunk; keep `main`'s **backend** materializer/`buildLoop`/activity and its **richer shared types**; swap in **this redesign's frontend graph layer**; adapt the rail components to consume `main`'s types; port only the **honest-metrics** fix into `main`'s `live.ts`.

> A literal `feat/live-graph-glue → main` merge was attempted first and produced **invalid auto-merge states** (duplicate `loop`/`activity` keys in `demo.ts`, duplicate imports in `live.ts`) because glue was ~100 commits stale. It was aborted; the same best-of-both was re-applied cleanly on a branch off `main`. The PR diff is just the graph layer (11 files).

---

## 3. What PR #38 changes (11 files)

**Frontend — new `frontend/src/components/graph/*`, composed into `GraphView.tsx`:**
- `forceSim.ts` — **dependency-free** force layout (charge repulsion, link springs, centroid recenter + gentle pull, 2-pass collision, bounds clamp, alpha annealing). Driven by a `requestAnimationFrame` loop. **No new dependency / no `pnpm-lock.yaml` change.**
- `GraphCanvas.tsx` — SVG render from the sim: **draggable + pinnable** nodes (double-click to release), curved edges that fan parallel pairs, weight-sized geometric shapes (square / outlined-square / circle / triangle / diamond), fade-in on new nodes/edges, animated `learned_from` dash, **risk-path lit / rest dimmed**, label collision-avoidance.
- `encoding.ts` — node/edge kind colors, `highlightFor` (risk/learn/all modes), `flowNarrative(graph, nodeId)` (the plain-English path walk), `modeBlurb`, legends, `ACTIVITY_TAG` (keyed by `main`'s `PodGraphActivityKind`).
- `MetricsRail.tsx`, `LearningLoop.tsx`, `ActivityStream.tsx`, `SelectedNodePanel.tsx` — the rails + stream + detail pane in light shadcn (`@/components/ui/*`). `LearningLoop` consumes `PodLearningLoop` (steps + `activeStep`); `ActivityStream` consumes `PodGraphActivity` (title + detail); `SelectedNodePanel` renders the **Flow** section + mode-aware default copy.
- `GraphView.tsx` — composes everything; polls `/api/pods/:id/graph` every 5s and **diffs** (positions/pins preserved across refreshes — no hard replace), + best-effort `ws /api/events` nudge; drops a **stale selection** (selected node gone across a poll) so the canvas can't dim entirely.
- `lib/graph.ts` — adds `backendEventsUrl()` (http→ws) for the nudge.

**Backend — surgical (keeps `main`'s materializer + `buildLoop` + activity builder):**
- `backend/src/graph/live.ts` — the **headline metric cards** are now derived from the **final de-noised graph**: *Open risk paths* = distinct collision **files** (`touches` edges to file nodes); *Learned owners* = distinct **owner engineers** (`owns`/`learned_from` edges). On live data: **50 → 4** risk files, **16 → 1** owner. `riskPaths` (raw signatures) is still computed and fed to `buildLoop` (the loop is a throughput view, intentionally separate). **`buildLoop` and the activity builder are untouched.**
- `backend/src/graph/demo.ts` — fallback metrics realigned to the demo graph (3 owners / 1 risk path / 100%) so the numbers never contradict the picture.

---

## 4. How it works (architecture)

```
materializePodGraph(podId)            // backend/src/graph/live.ts (main's, + metric fix)
  → GET /api/pods/:id/graph           // backend/src/server.ts (PodGraph incl. loop/activity)
  → fetchPodGraph() poll every 5s     // frontend/src/lib/graph.ts  (+ ws /api/events nudge)
  → GraphView                         // diffs snapshots, computes highlight + flow
      → GraphCanvas (forceSim tick → SVG, draggable)
      → MetricsRail / LearningLoop / ActivityStream / SelectedNodePanel
```

- **`PodGraph` data contract** (`shared/src/graph.ts`, `main`'s): `nodes`, `edges`, `metrics`, optional `loop?: PodLearningLoop`, `activity?: PodGraphActivity[]`. Node kinds: engineer/feature/file/collision/intervention. Edge kinds: owns/editing/touches/collides/warns/learned_from.
- **Force sim** ignores the server's `x`/`y` except as **seed** positions (mapped into the canvas). Key tuning constants in `forceSim.ts`: `REPEL=4400`, `CENTER_STRENGTH=0.014`, `RECENTER=0.5`, `COLLIDE_PAD=12`, `COLLIDE_ITERS=2`, `BOUND_PAD=30`. Repulsion must dominate centering or the graph collapses to a point.
- **Default mode is "Risk path"** — lights the collision→intervention→`learned_from` chain, dims the rest to opacity `0.14`.
- **Flow narrative** (`flowNarrative`) walks a node's incident edges to produce sentences, e.g. collision → "Karti and Yahya are both editing auth.ts before pushing — the overlap git can't see. PodMan stepped in and suggested a sync PR."

---

## 5. Is the data real / dynamic? (FAQ — was asked)

- **Real:** yes. The graph is materialized **live from the real Atlas collections** (`observations`, `collisions`, `interventions`, `outcomes`, `engineer_states`, `pods`, `team_model`) on every request — not the hardcoded demo. The demo only shows as a **fallback** when there's zero activity. `generatedAt` advances on each request (re-materialized, not cached).
- **Dynamic:** the backend re-reads Mongo per request and the frontend polls ~5s + WS nudge, so the UI reflects current DB state within seconds. **But it only *changes* when the PodMan agent writes new data** (vision → observations → collisions → interventions → outcomes). When the agent is idle, the graph is static at last-known state. (At handoff time the newest activity was ~52 min old — no live ingestion.)
- **Numbers look inflated** because a lot of the real data is **test churn** (repeated `infra/README.md` collisions). The honest-metrics fix (§3) counts distinct entities so the cards match the graph; `MAX_COLLISIONS=8` in the materializer caps the visible collisions.

---

## 6. Build / verify (toolchain quirks — important)

- **`pnpm` is not on PATH** in the dev sandbox; use **`CI=true npx pnpm@10.32.1 …`** (pin 10.32.1 to match CI and keep the lockfile v10-compatible; `CI=true` avoids the no-TTY abort).
  - `CI=true npx pnpm@10.32.1 lint`
  - `CI=true npx pnpm@10.32.1 -r typecheck`
  - `CI=true npx pnpm@10.32.1 -r build`
- The `npm error config prefix cannot be changed from project config: .npmrc` line is a **non-fatal warning** (tsc/eslint still run; exit code 0).
- **Adding a dependency is high-friction**: `pnpm install` wants to wipe + recreate `node_modules` (modules-dir version mismatch) and churns the shared `pnpm-lock.yaml` that CI's `--frozen-lockfile` depends on. That's why the force sim is **in-house**, not `d3-force`. Prefer zero-dep solutions.
- **CI** (`.github/workflows/hermes-verify.yml`) runs `pnpm install --frozen-lockfile && pnpm lint && pnpm -r typecheck && pnpm -r build` (pnpm 10.32.1, node 22).

**Running it locally to eyeball:** the **backend can't run locally** (needs LiveKit/Gemini/GitHub secrets and hard-exits without Mongo). Verify the **frontend** by pointing a vite dev server at either the live backend (CORS is `*`) or a tiny mock that serves `createDemoPodGraph()` from `backend/dist/graph/demo.js`:

```
# mock backend (node http) serving GET /api/pods/:id/graph from backend/dist/graph/demo.js
# then: VITE_BACKEND_URL=http://localhost:8799 in frontend/.env.local
CI=true npx pnpm@10.32.1 --filter @podman/frontend dev
```

A throwaway entry (`frontend/graph-preview.html` + `frontend/src/graph-preview.tsx` mounting `<GraphView podId="demo-pod" .../>`) renders the view directly without the pods list. Drive it with Playwright (already a devDependency; chromium is cached) — sample node positions over time to confirm the sim ticks, `getComputedStyle` opacity to confirm dimming, click nodes to read the Flow text. **Delete all of these temp files before committing.**

---

## 7. Gotchas (these already bit; don't re-learn them)

- **PWA cache** — hard-refresh after every deploy or you'll think nothing changed.
- **StrictMode RAF freeze (fixed):** the dev double-mount cancels the animation frame between effect passes; the loop must re-arm **unconditionally** after `setData` (`ensureRaf()` is idempotent via the `rafRef==null` guard), not gated on a topology change — else the sim is frozen at seed positions in dev until first interaction. Seed positions are a plausible layout, so this can hide.
- **Dimming vs animation (fixed):** `.pm-dim` opacity is defeated if the fade-in uses `animation-fill-mode: both/forwards` (held final keyframe overrides the class). The enter animation must use **no fill-mode**.
- **Stale selection (fixed):** after a poll, a selected node can vanish from the payload; `highlightFor(selected)` would then light only a dead id and dim the whole graph. `GraphView` derives `liveSelected = selected ∈ nodeById ? selected : null` and clears it.
- **Force tuning:** repulsion must dominate centering (`REPEL ≫ CENTER_STRENGTH·r`) or the graph collapses; `COLLIDE_ITERS≥2` keeps linked nodes from stacking.
- **Pathological data:** with the *uncapped* live materializer (pre-`MAX_COLLISIONS`), engineer labels can crowd the center because each engineer fans many `collides` edges. The materializer cap is the real fix; the frontend still spreads + draggable.
- **`learned_from` "money" edge on `demo-pod`** won't draw on real data unless there's one intact accept flow (its one accepted outcome is orphaned). The demo fallback shows it.
- **Parallel impl on `main`:** keep `main`'s `PodLearningLoop`/`PodGraphActivity` types and `buildLoop`/activity builder. Do **not** reintroduce the v1 `LearningStage`/`ActivityEvent` types — they were dropped in the reconciliation.

---

## 8. Open items / nice-to-haves

- **Merge PR #38, redeploy, hard-refresh** (the headline).
- Close PR #22; delete `feat/live-graph-glue` + `feat/team-memory-dynamic-graph`.
- Optional polish: more canvas spread on small graphs; label de-clutter for pathological/uncapped data; seed a clean collision→intervention→accept chain on `demo-pod` so the violet money edge draws on real data.
- Optional: reconcile the loop "Predict" value (distinct signatures) vs the "Open risk paths" card (distinct files) — they intentionally differ today; could unify wording if it confuses.

---

## 9. Key files

| File | Role |
| --- | --- |
| `backend/src/graph/live.ts` | `materializePodGraph` — real-data graph + `buildLoop`/activity (main's) + **honest metric cards** |
| `backend/src/graph/demo.ts` | demo fallback (graph + loop + activity + consistent metrics) |
| `backend/src/graph/store.ts` | `loadPodGraph` (live → seeded `team_model.graph` → demo), `reachFrom` (`$graphLookup`) |
| `shared/src/graph.ts` | `PodGraph` contract incl. `PodLearningLoop`, `PodGraphActivity` (main's types) |
| `frontend/src/components/GraphView.tsx` | page: header, toggles, 3-panel grid, poll/WS, compose |
| `frontend/src/components/graph/forceSim.ts` | the in-house force simulation |
| `frontend/src/components/graph/GraphCanvas.tsx` | dynamic SVG graph (drag/animate) |
| `frontend/src/components/graph/encoding.ts` | colors, `highlightFor`, `flowNarrative`, legends, activity tags |
| `frontend/src/components/graph/{MetricsRail,LearningLoop,ActivityStream,SelectedNodePanel}.tsx` | rails/stream/detail |
| `frontend/src/lib/graph.ts` | `fetchPodGraph`, `backendEventsUrl` |

---

## 10. Verification done (PR #38)

`pnpm lint` + `-r typecheck` + `-r build` pass. Playwright (dev/StrictMode) confirmed, against the demo payload served from a mock:
- dynamic graph **ticks on load** (positions move with no interaction) and is **draggable**;
- **learning-loop rail** renders main's 5 steps (ADAPT active) and the **activity stream** renders main's title+detail;
- metric cards read **3 / 1 / 100%** (consistent with the graph);
- **Flow** narrative is correct per node kind (collision / intervention / engineer / file);
- **no overlapping nodes** (≥48px min separation), **zero page errors** (only an expected WS 404 against the mock, handled).

The honest-metric formula was also re-checked against the **real live graph**: **4** distinct risk files / **1** learned owner (vs the deployed 50 / 16).
