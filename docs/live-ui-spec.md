# Real Continual-Learning UI — Spec

> Owner: graph data + visualization (live data). Status: **demo-backed graph shipped (`docs/graph.md`); this spec makes it REAL.**
> **Extends `docs/graph.md` — does not duplicate it.** Same files, same contracts (`shared/src/graph.ts`, `PodGraph`, the two collections, the two routes). This spec only adds: a live materializer behind `loadPodGraph`, an outcomes aggregation, a ws push of `GRAPH_DIRTY`, and the per-pod GraphView wiring. Everything in `graph.md` (node/edge kinds, `$graphLookup`, demo fallback) remains the contract.

## 0. Purpose & framing

The demo graph already renders the "it learned" story (`createDemoPodGraph` → Karti owns auth, `learned_from` edge, 86% accept rate). The problem: **none of it is real** — `team_model`/`graph_nodes`/`graph_edges` are never written (`seedGraph` has zero callers), so `loadPodGraph` always returns the hardcoded demo. The graph looks alive but is a poster.

**This spec makes the same poster a live render of the 6 collections the agent actually writes** (`pods`, `engineer_states`, `observations`, `collisions`, `interventions`, `outcomes`), so the continual-learning loop the judges see is backed by data the pipeline produced this session.

The visible self-improving loop, before → after:

- **Before:** Two engineers edit `auth.ts`, one unpushed. A `collisions` doc is written, an `interventions` doc (status `pending`). The graph grows a red `collision` triangle and a `warns` edge to the intervention diamond. Copy: _"new — first time PodMan saw this path."_
- **After:** The human clicks Accept → `POST /api/outcome` writes `{accepted:true, wasRealCollision:true}`. The materializer turns that outcome into a **`learned_from` edge** (`intervention → engineer`, label `learned: owns auth.ts`), flips the engineer node to `status:'learned'`, and bumps the **Learned owners** metric. Copy on the next similar collision: _"I've seen this before — last time the team accepted sync PR"_ (driven by `collisions.memorySignature` recall, already live).

**Why this is not a dashboard** (hard constraint): it stays the **secondary, toggle-opened** view behind the pods list (`graph.md`), keeps the dark-Bauhaus single-canvas SVG (one graph, not a grid of charts), and every visible element is anchored to a live write + an action loop. The metrics rail is 3 numbers derived from real counts, not a wall of KPIs. The hero remains the intervention card in `PodView`; this view exists only to make _"PodMan got better"_ legible in 10 seconds.

## 1. Live data → graph mapping

The materializer (`backend/src/graph/live.ts`, §3) reads these collections per `podId` and emits `PodGraph` (`shared/src/graph.ts`). Node ids stay stable so realtime refreshes don't reshuffle: `engineer:<name>`, `file:<normalizedFile>`, `collision:<collision.id>`, `intervention:<intervention.id>`.

| Source collection                          | Fields read                                                                          | Produces                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`pods`**                                 | `members[]`, `name`, `repo`                                                          | Baseline `engineer:` nodes for every roster member (so the graph isn't empty pre-activity). `summary` = pod `repo`.                                                                                                                                                                                                                                                                                                 |
| **`engineer_states`** (via `getGitStates`) | `name`, `changedFiles[]`, `branch`, `recentCommit`, `gitUpdatedAt`                   | `engineer:<name>` node `status:'risk'` when `changedFiles.length>0` (= `hasUnpushedChanges`); `file:` node per entry in `changedFiles`; `editing` edge engineer→file, `strength` 0.6. Engineer `summary` = `"N changed files on <branch>"`.                                                                                                                                                                         |
| **`observations`** (`EngineerContext`)     | `engineerId`, `currentFile`, `currentSymbol`, `activity`, `confidence`, `observedAt` | `engineer:<engineerId>` node `status:'active'` if a `observedAt` within last 60s exists; `file:<currentFile>` node; `editing` edge engineer→file, `strength` = `confidence` (Gemini meter). Most-recent `observedAt` wins for a file's de-facto `primaryOwner` (used to label the `owns` edge — there is no `ownership_map`). Edge `label` = `activity`.                                                            |
| **`collisions`** (`Collision`)             | `id`, `file`, `symbol`, `engineers[]`, `severity`, `detectedAt`, `memorySignature`   | One `collision:<id>` node, `kind:'collision'`, `status:'risk'`, `weight` by severity (`info`0.4/`warn`0.7/`critical`1.0). `collides` edge per name in `engineers[]` (engineer→collision, `strength` from severity). `touches` edge `file:<file>`→collision. A `summary` badge `"seen before"` when `memorySignature` matched a prior collision (severity escalated to `critical` — already the live recall signal). |
| **`interventions`** (`Intervention`)       | `id`, `collisionId`, `kind`, `suggestedAction.kind`, `status`, `createdAt`           | One `intervention:<id>` diamond. `warns` edge `collision:<collisionId>`→intervention, `label` from `suggestedAction.kind` (`open_sync_pr`→`"sync PR"`, `ping_teammate`→`"ping"`, `none`→`"watch"`). **Color cannot come from `status`** (always `pending` — never updated), so it is joined to `outcomes` (next row).                                                                                               |
| **`outcomes`** (`InterventionOutcome`)     | `interventionId`, `wasRealCollision`, `accepted`, `recordedAt`                       | **The learning signal.** For each outcome where `accepted===true && wasRealCollision===true`: emit a `learned_from` edge `intervention:<interventionId>`→`engineer:<primaryOwnerOfFile>`, `label` = `learned: owns <file>`, `strength` 0.6; flip that engineer node `status:'learned'` and the intervention node `status:'learned'`. `accepted===false` → intervention node `status:'stable'` (grey, "dismissed").  |

**Metrics rail** (`PodGraphMetric[]`, replacing demo's hardcoded `5 / 2 / 86%`), computed live in `live.ts`:

| `label`           | `value`                                                                                                                             | `detail`                                                  | Source                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------- |
| `Learned owners`  | count of accepted+real outcomes                                                                                                     | `"Ownership edges retained from accepted interventions."` | `outcomes` aggregation           |
| `Open risk paths` | count of `collisions` with `engineers.length>=2` and any colliding engineer has unpushed (`engineer_states.changedFiles` non-empty) | `"Files with converging editors and unpushed work."`      | `collisions` × `engineer_states` |
| `Accept rate`     | `round(accepted / total outcomes * 100)%` (`"—"` when total 0)                                                                      | `"Interventions accepted this session."`                  | `outcomes` aggregation           |

`x`/`y` layout: `live.ts` runs a deterministic column layout (engineers x≈78, files x≈300, collisions x≈470, interventions/features x≈620; y spread evenly per column within the `0..472` viewBox) so the existing SVG renders unchanged.

## 2. The visible workflow (observe → store → predict → outcome → adapt)

The graph view narrates the same loop the agent runs, mapped to what the viewer sees:

1. **Observe** (`observations`, ~1fps; `engineer_states`, 15s): engineer nodes light `active`; `editing` edges thicken with Gemini `confidence`. A small caption under the canvas: _"Yahya — editing auth.ts (unpushed)"_ from the latest observation + git chip.
2. **Store / Predict** (`collisions` + vector recall): when ≥2 engineers + unpushed, a red `collision` triangle and `collides`/`touches` edges appear. If `memorySignature` recall hit (severity `critical`), the node carries a **"seen before"** badge — the self-improvement signal.
3. **Intervene** (`interventions`): a `warns` edge draws to a new `intervention` diamond labeled by `suggestedAction.kind`. The view shows a _"PodMan is speaking"_ pulse on that edge when a `VOICE_CUE` arrives over ws (§5).
4. **Outcome** (`POST /api/outcome` from the `PodView` card): the moment the human clicks Accept.
5. **Adapt** (`outcomes` → `learned_from`): on the next graph refresh, a dashed purple `learned_from` edge animates in, the engineer node flips to `learned` (gold/locked), and **Learned owners** + **Accept rate** tick up.

**The live "money moment" (sequence the demo lands):** collision detected → red triangle + edges appear and PodMan speaks (pulse) → human clicks Accept on the card in `PodView` → switch to Team memory → the `learned_from` edge to `engineer:karti` (`learned: owns auth.ts`) is now present, the engineer is gold, metrics rose. A second collision on the same signature renders with the "seen before" badge. That single before→after transition, all from collections written this session, is the continual-learning proof.

## 3. Backend changes

All additive / behind existing signatures — `graph.md` contracts unchanged.

### 3a. Live materializer — `backend/src/graph/live.ts` (NEW)

`export async function materializePodGraph(podId: string): Promise<PodGraph>`. Reads the 6 collections via `collections()` + `getGitStates(podId)` (`memory/db.ts`), builds nodes/edges/metrics per §1, runs the column layout, returns `PodGraph`. Pure-read; never writes. Wrapped so any Mongo error throws to the caller (which falls back to demo, §3b). Helper `normalizeFile()` reused from `collision/detector.ts` so file ids match collision files exactly.

### 3b. `loadPodGraph` — `backend/src/graph/store.ts` (MODIFY)

Replace the body so it prefers live, then `team_model`, then demo:

```
1. const graph = await materializePodGraph(podId)
2. if (graph.nodes.length > <BASELINE>) return graph   // real activity exists
3. const doc = team_model.findOne({podId}); if (doc?.graph) return doc.graph
4. return createDemoPodGraph(podId)                      // demo-stability fallback
```

`<BASELINE>` = the count of pure roster `engineer:` nodes (no files/collisions). If only roster nodes exist (no observations/collisions yet) the view shows demo so the canvas is never empty mid-demo (§5). Signature, route, and demo fallback all unchanged.

### 3c. Keep `$graphLookup` real — mirror into `graph_nodes`/`graph_edges`

Add `export async function materializeAndSeed(podId)` in `store.ts`: calls `materializePodGraph`, then reuses `seedGraph`'s existing upsert/`deleteMany`/`insertMany` block to write `team_model.graph` + `graph_nodes` + `graph_edges` from the **live** graph (today `seedGraph` writes the demo graph from `createDemoPodGraph`; this variant takes the live one). Called (a) on every `POST /api/outcome` (so `reachFrom` reflects the new `learned_from` edge), and (b) lazily inside the graph route after `loadPodGraph` returns a live graph. This is the only way `reachFrom`/`/graph/reach/:node` stops returning empty.

### 3d. Routes — `backend/src/server.ts` (MODIFY, additive only)

- `GET /api/pods/:id/graph` — unchanged signature; now returns live graph via §3b.
- `GET /api/pods/:id/graph/reach/:node` — unchanged; now non-empty once §3c runs.
- `GET /api/pods/:id/graph/metrics` (NEW, small) — returns just `PodGraphMetric[]` (the outcomes aggregation: `learned owners`, `open risk paths`, `accept rate`) so the rail can poll cheaply without re-sending the whole graph. Backed by a `db.collection('outcomes').aggregate` group on `podId` (count, `$sum accepted`).
- `POST /api/outcome` (MODIFY): after `recordOutcome`, call `materializeAndSeed(podId)` (best-effort, never throws) **and** broadcast `{type:'GRAPH_DIRTY', podId}` to ws `/api/events` clients (reuse the existing `clients` set / `c.send`). This is the only place the loop closes.

### 3e. Realtime push — ws `/api/events` (MODIFY)

The relay already fans out any JSON. Add server-originated `GRAPH_DIRTY` (above) and pass through agent `COLLISION` / `VOICE_CUE` (the agent already publishes these on the LiveKit data channel; mirror them onto ws so the dashboard-level GraphView — which is not in a LiveKit room — can react). No new transport; just two more message `type`s on the existing bus.

## 4. Frontend changes

### 4a. Per-pod entry point — `frontend/src/App.tsx` (MODIFY)

The "Team memory" button currently passes `pods[0]?.id ?? 'demo-pod'` (line 271) — wrong pod for a multi-pod demo. Change to open the graph for the **pod in context**: add a `BrainCircuitIcon` action on each `PodCard` (`onOpenGraph(pod.id)`) wired to `setGraphPodId(pod.id)`, and keep the header button as a fallback that opens the **selected/first live pod** (the one with presence). The router slot (`if (graphPodId) return <GraphView podId={graphPodId} …/>`, line 237-239) is unchanged.

### 4b. `GraphView.tsx` — keep dark-Bauhaus, add realtime

**Stays dark-Bauhaus** (per `graph.md` it is the deliberately distinct "it learned" surface — do not convert the SVG/`.pm-*` palette to shadcn). What changes:

- **Realtime refresh:** open a ws to `/api/events` on mount; on `{type:'GRAPH_DIRTY', podId}` (matching this pod) or `COLLISION`/`VOICE_CUE`, re-call `fetchPodGraph(podId)` (and `fetchGraphMetrics`). Also a **5s poll** of `fetchPodGraph` as the floor (mirrors `App.tsx`'s existing 5s presence/memory poll) so it's live even if ws drops. New incoming nodes/edges fade in (CSS opacity transition on `<line>`/shape); `learned_from` edges animate the dashed stroke.
- **"new" vs "seen before" copy** in the detail rail from `collision` node `summary` badge (§1).
- **Speaking pulse** on the `warns` edge when a `VOICE_CUE` lands.

### 4c. `frontend/src/lib/graph.ts` (MODIFY)

- Fix `BACKEND_URL` to follow `lib/api.ts`'s resolution (empty string in prod) instead of hardcoding `localhost:8787`.
- Add `fetchGraphMetrics(podId)` → `GET /api/pods/:id/graph/metrics`.
- Add `openGraphEvents(podId, onDirty)` → thin `WebSocket('/api/events')` subscription helper (reused by `GraphView`).

### 4d. Loading / empty / error states (collections empty is the common real case)

- **Loading:** existing on-mount spinner; keep.
- **Empty (no activity yet):** §3b returns the **demo graph** so the canvas is never blank — but the detail rail shows a small _"Live mode — waiting for the first observation"_ note when metrics total is 0, so it's honest that nothing has been learned yet. No empty-grid placeholder.
- **Error / backend down:** `fetchPodGraph` rejects → render the last good graph if any, else the demo graph rendered client-side is not available; show a single-line `.pm-` error chip _"memory offline — retrying"_ and keep polling. ws errors are swallowed (poll covers it).

## 5. Realtime & data freshness

| Surface                           | Transport                                            | Cadence                         |
| --------------------------------- | ---------------------------------------------------- | ------------------------------- |
| Engineer `active`/file edits      | ws `COLLISION` passthrough + 5s `fetchPodGraph` poll | ~1fps source data, surfaced ≤5s |
| Git chip (changed files / branch) | folded into 5s graph poll (`engineer_states`)        | 15s underlying write            |
| Collision / intervention nodes    | ws `COLLISION` (instant) → triggers refetch          | instant on event                |
| Speaking pulse                    | ws `VOICE_CUE`                                       | instant                         |
| `learned_from` edge + metrics     | ws `GRAPH_DIRTY` on `POST /api/outcome` → refetch    | instant on Accept               |

**Polling is the floor, ws is the accelerator** — never gate the canvas on ws. **Demo-stability fallback:** if the live materializer yields ≤ baseline nodes or Mongo is unreachable, the route serves `createDemoPodGraph` (§3b) so the toggle always shows a coherent graph on stage. The Accept→`learned_from` beat is driven by `POST /api/outcome` → `materializeAndSeed` → `GRAPH_DIRTY`, the one path that must be solid.

## 6. Demo path

**Must-have (the 3-min money moment):**

- `materializePodGraph` reading `collisions` + `interventions` + `outcomes` + `engineer_states` so the graph reflects this session.
- `POST /api/outcome` → `materializeAndSeed` + `GRAPH_DIRTY`; GraphView refetches and the `learned_from` edge + gold node + risen metrics appear after Accept.
- Live metrics rail (Learned owners / Open risk paths / Accept rate) from the outcomes aggregation.
- "seen before" badge from `collisions.memorySignature` (already live) on the second collision.
- Demo-graph fallback when collections are empty (stage safety).

**Nice-to-have:**

- ws `VOICE_CUE` speaking pulse on the `warns` edge.
- `/graph/reach/:node` lit risk-path walk (`$graphLookup`) once `materializeAndSeed` populates `graph_edges`.
- Fade/stroke animations on incoming edges.
- Per-`PodCard` graph entry button.

**Cut if behind (per CLAUDE.md 12h box):**

- Vector-search dependency for recall (exact `memorySignature` recall already covers the learning beat).
- Any new chart primitive / recharts — keep the SVG.
- Auth/pod-scoping on ws `/api/events`.
- Historical/time-scrubbed graph; only "now" is needed.

**The 3-min beat (extends `PLAN.md` §9, ends in this view):** IDE with unpushed `auth.ts` → live caption → second engineer opens same file → **COLLISION** card in `PodView` (named teammate + sync PR action) → Hermes voice → human clicks **Accept** → toggle **Team memory** → the `learned_from` "learned: Karti owns auth.ts" edge is now real, metrics rose → second collision shows "I've seen this before" → close on the public repo PR URL + the live metrics.

## 7. Files & tasks (documentation-first)

> Per CLAUDE.md gate: this spec + the new task entries in `docs/PLAN.md` land **before** code. Add task `Pxx — Live continual-learning graph` to `PLAN.md` with the Files list below.

**Create:**

- `backend/src/graph/live.ts` — `materializePodGraph(podId)`, `normalizeFile`, metrics aggregation, column layout. _(Task: live materializer)_

**Modify:**

- `docs/graph.md` — append a **"Live data backing"** section pointing to this spec (the §1 mapping table + `live.ts`); change the "Demo-first plan" step 3 ("Swap `loadPodGraph`…") to "done via `materializePodGraph`." _(documentation-first)_
- `docs/PLAN.md` — add the task + Files list. _(documentation-first)_
- `backend/src/graph/store.ts` — `loadPodGraph` prefers live (§3b); add `materializeAndSeed(podId)` (§3c). _(Task: live wiring + $graphLookup)_
- `backend/src/server.ts` — `POST /api/outcome` calls `materializeAndSeed` + broadcasts `GRAPH_DIRTY`; new `GET /api/pods/:id/graph/metrics`; ws passthrough of `COLLISION`/`VOICE_CUE`/`GRAPH_DIRTY`. _(Task: routes + realtime)_
- `backend/src/agent/podman.ts` — also emit `COLLISION`/`VOICE_CUE` onto ws `/api/events` (mirror of the LiveKit data-channel publish) so the dashboard-level GraphView reacts. _(Task: realtime mirror)_
- `frontend/src/lib/graph.ts` — `BACKEND_URL` resolution fix; `fetchGraphMetrics`; `openGraphEvents`. _(Task: client)_
- `frontend/src/components/GraphView.tsx` — ws subscription + 5s poll + animations + "new/seen-before" rail copy + speaking pulse; keep dark-Bauhaus. _(Task: client)_
- `frontend/src/App.tsx` — per-pod graph entry; header button opens live/selected pod not `pods[0]`. _(Task: entry point)_
- `frontend/src/components/PodCard.tsx` — `onOpenGraph(pod.id)` action. _(Task: entry point)_

**Unchanged contracts (do not edit):** `shared/src/graph.ts` (types already cover live), the two graph routes' signatures, `createDemoPodGraph` (kept as fallback), `seedGraph`/`graph:seed` (kept; `materializeAndSeed` reuses its write block).

## 8. Risks & open questions

- **`engineer_states` is keyed by `name`; `observations` by `engineerId`; collisions by names in `engineers[]`.** The materializer must reconcile these to one `engineer:<name>` node. Assumption (from data map): LiveKit identity == `--name` == engineer name. If they diverge, edges will orphan. **Mitigation:** key all engineer nodes off `pods.members` and match case-insensitively; drop unmatched.
- **`outcomes` has no `engineerId`/`file`** — only `interventionId`/`collisionId`. To draw the `learned_from` edge to the right engineer/file, `live.ts` must join `outcome → intervention.collisionId → collision.file/engineers` and pick the de-facto `primaryOwner` (most-recent observation on that file). If observations expired (6h TTL), fall back to the first name in `collision.engineers`.
- **`observations` TTL may not fire** (init.ts indexes `observedAt` as Date but it's stored as ISO string) — so "active" windowing must compare parsed ISO timestamps in `live.ts`, not rely on TTL eviction; old observations could otherwise inflate "active." **Open:** cap to most-recent observation per `(engineerId,file)`.
- **`intervention.status` never advances past `pending`** — confirmed; the UI must color interventions from the `outcomes` join, never from `status`. Already handled in §1, but worth a one-line code comment so a future dev doesn't "fix" it by reading `status`.
- **ws `/api/events` has no pod-scoping** — `GRAPH_DIRTY` carries `podId` and the client filters; acceptable for the demo, flagged as the known shortcut.
- **Open question:** should `materializeAndSeed` run on every `POST /api/outcome` (simple, slightly heavy) or be debounced? For a 3-engineer demo, run inline; revisit only if outcome volume spikes.
- **Open question:** when both a live `materializePodGraph` graph and a `team_model.graph` exist, live wins (§3b). Confirm no flow expects `team_model.graph` to be authoritative — currently nothing writes it except the dead `seedGraph`, so live-wins is safe.
