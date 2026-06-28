# Team Memory Graph - Codex Redesign Brief

> **Read this whole file before touching code.**
> This is a fresh-session handoff for rebuilding PodMan's live **Team memory** graph UI.
> The goal is not to tweak labels or add another filter. The goal is to make the
> real-data light UI as polished, legible, and functional as the original dark
> Bauhaus mock, while keeping the graph backed by live MongoDB data.

## 0. Mission

PodMan's Team memory view should make the recursive self-improvement loop visible:
who is working, which files overlap, where collisions happen, which intervention was
sent, and what PodMan learned from accepted outcomes.

The current light real-data implementation proves the backend can materialize a graph,
but the UI does not yet tell the story. It still reads as a static node-link diagram:
edges dominate, labels collide, the layout feels fixed, and the important loop
`observe -> store -> predict -> outcome -> adapt` is not visible.

Rebuild the Team memory experience so it has the narrative clarity of the dark
Bauhaus mock, in the app's light shadcn/ruixen visual system, with a dynamic graph
that animates and responds to live data changes.

## 1. Current State

Branch context:

- Work is on `feat/live-graph-glue`.
- The live graph backend exists and should be reused.
- A PR for the live graph glue already exists, and later commits have continued
  refining readability.
- The current file requested by the user is this document:
  `codex_team_memory_redisgn.md`.

Important existing files:

- `backend/src/graph/live.ts`
  Builds `PodGraph` from real Mongo collections:
  `pods`, `engineer_states`, `observations`, `collisions`, `interventions`,
  and `outcomes`.
- `backend/src/graph/store.ts`
  Loads live graph first, then seeded `team_model.graph`, then demo fallback.
- `shared/src/graph.ts`
  Defines the graph contract.
- `frontend/src/components/GraphView.tsx`
  Current frontend graph rendering. This is the main file to redesign.
- `frontend/src/lib/graph.ts`
  Fetches the graph.
- `frontend/src/App.tsx` and `frontend/src/components/PodCard.tsx`
  Open Team memory per pod.

Do **not** start by rewriting the backend materializer. It already does the most
important real-data work: filtering noisy files, collapsing repeated collisions,
capping graph size, shortening labels, and pruning test engineers. The redesign is
primarily a frontend information-architecture and interaction problem.

## 2. Reference Screens

### Current Light Real-Data UI

The light UI is technically real and connected to live data, but it fails visually.

Observed problems:

- The graph is too static and column-like.
- Red collision edges dominate the canvas.
- Labels overlap and fight for attention.
- Interventions repeat as a row of identical diamonds.
- The right panel says "It learned" but does not explain the actual workflow state.
- The screen lacks an activity stream.
- The screen lacks the explicit learning-loop rail from the dark mock.
- The viewer cannot quickly answer:
  - What happened?
  - Who collided?
  - What did PodMan do?
  - Did the team accept it?
  - What changed in memory?

The current light version proves data plumbing. It does not yet work as a demo
surface.

### Dark Bauhaus Mock

The dark mock is the quality target. Do not copy the dark palette wholesale, but
copy the structure, density, and storytelling.

The mock has:

- A strong title bar:
  `PODMAN / CONTINUAL-LEARNING OBSERVATORY`
- A live status indicator:
  `LIVE - POD demo-pod`
- A left metrics rail:
  workflow metrics as compact, high-contrast cards.
- A center graph:
  sparse, geometric, readable, with one primary path emphasized.
- A right learning-loop rail:
  `Observe -> Store -> Predict -> Outcome -> Adapt`
- A bottom activity stream:
  timestamped events with type badges.
- A selected-node detail panel:
  kind, relationships, severity, explanation.
- A legend:
  node shapes and edge colors.

The mock works because it is not just a graph. It is an observatory. It tells the
loop story.

## 3. Product Goal

Team memory should be the "it learned" surface.

In a 10-second demo, a viewer should understand:

1. Two engineers are converging on the same file.
2. PodMan detected the risk before a push.
3. PodMan suggested an intervention.
4. The team accepted or dismissed the intervention.
5. PodMan retained that outcome as memory.
6. Future collisions become more informed.

The graph should support that story, not overwhelm it.

## 4. Target Layout

Build a light shadcn page with the same conceptual structure as the dark mock.

```text
+--------------------------------------------------------------------------+
| Header: Team memory - What PodMan learned - <pod>              [<- Pods] |
+--------------------------------------------------------------------------+
| Mode controls: Risk path | Learning edges | Whole graph                  |
+---------------+--------------------------------------+-------------------+
| Workflow      |                                      | Learning loop     |
| metrics       |          Dynamic graph canvas         | Observe           |
| cards         |                                      | Store             |
|               |                                      | Predict           |
|               |                                      | Outcome           |
|               |                                      | Adapt             |
+---------------+--------------------------------------+-------------------+
| Activity stream                                | Selected node details   |
+--------------------------------------------------------------------------+
```

Required panels:

- **Header**
  - Pod name / id.
  - Live/generated timestamp.
  - Back to pods action.
- **Mode controls**
  - Risk path.
  - Learning edges.
  - Whole graph.
- **Workflow metrics rail**
  - Learned owners.
  - Open risk paths.
  - Accept rate.
  - Optional: observations, interventions, memory vectors if available.
- **Dynamic graph canvas**
  - Force-directed or animated layered graph.
  - Geometric node shapes.
  - Curved or bundled edges.
  - Labels should not overlap by default.
  - Hover/select reveals full details.
- **Learning loop rail**
  - Observe.
  - Store.
  - Predict.
  - Outcome.
  - Adapt.
  - Active/current step should pulse or be highlighted.
- **Activity stream**
  - Recent editing, collision, warning, outcome, learned events.
  - Compact rows with timestamp + colored type badge.
- **Selected node**
  - Default state explains the loop.
  - Selected state shows node kind, name, relationships, severity/status, and
    why this node matters.

## 5. Visual Direction

Use the app's light shadcn/ruixen design system for chrome.

Hard rules:

- Use `@/components/ui/*` primitives where possible.
- If a primitive is missing, add it through:
  `npx shadcn@latest add "https://ruixen.com/r/[component]"`
- Do not make the entire UI a bespoke CSS island.
- The graph canvas itself may be bespoke SVG/canvas.
- The rest should be composed from cards, badges, buttons, tabs/toggles, and
  utility classes consistent with `App.tsx`.

Keep semantic graph colors:

- Engineer: blue.
- File: slate outline.
- Feature: amber circle.
- Collision: red triangle.
- Intervention: violet diamond.
- `collides`: red edge.
- `warns`: amber/orange edge.
- `learned_from`: dashed violet edge.
- `owns`: blue edge.
- `editing` / `touches`: muted slate.

Use light surfaces:

- Background: app background token.
- Panels: `card`.
- Borders: `border`.
- Text: `foreground`.
- Supporting copy: `muted-foreground`.

The result should feel like the dark mock translated into the app's light command
center, not a random analytics dashboard.

## 6. Dynamic Graph Requirement

The current graph is too static. Replace or augment the static column layout.

Preferred implementation:

- Use `d3-force` in the frontend.
- Initialize nodes from server `x/y` when useful, but let the simulation settle.
- Use:
  - link force by edge strength.
  - charge force for separation.
  - center force.
  - collision force based on node radius.
  - optional x/y bias by kind to preserve rough story flow.
- Make nodes draggable.
- Preserve node shape encoding.
- Animate:
  - new nodes fading/scaling in.
  - new edges drawing/fading in.
  - `learned_from` dashed edge flowing or pulsing.
  - active collision/intervention pulse.

If `d3-force` is too much for the current branch, use an animated layered layout:

- Engineers left.
- Files mid-left.
- Collisions center/right.
- Interventions right.
- Curved edges.
- Smooth transitions between graph snapshots.
- Gentle idle motion only if it helps.

Do not leave the final version as static fixed columns.

## 7. De-Hairball Rules

Default screen should show the risk path, not every possible relationship.

Rules:

- Default mode: `Risk path`.
- Whole graph can exist, but it is not the demo default.
- Dim non-selected/non-risk edges aggressively.
- Use curved edges or edge bundling.
- Hide low-priority labels until hover/select.
- Prefer file basename/short path on canvas.
- Put full path in selected-node panel.
- Group repeated collisions by signature.
- Cap visible collisions/interventions for demo readability.
- Preserve all data in the payload; choose a readable default projection.

The graph is not an exhaustive database browser. It is a story-first visualization.

## 8. Data Model To Use

Current `PodGraph` contract:

```ts
interface PodGraph {
  podId: string;
  generatedAt: string;
  nodes: PodGraphNode[];
  edges: PodGraphEdge[];
  metrics: PodGraphMetric[];
}
```

Node kinds:

- `engineer`
- `file`
- `feature`
- `collision`
- `intervention`

Edge kinds:

- `owns`
- `editing`
- `touches`
- `collides`
- `warns`
- `learned_from`

Statuses:

- `stable`
- `active`
- `risk`
- `learned`

Existing collections behind the materializer:

- `pods`
- `engineer_states`
- `observations`
- `collisions`
- `interventions`
- `outcomes`

Important caveat:

The current `demo-pod` accepted outcome chain may be orphaned from test churn.
If `learned_from` does not show, confirm whether there is an intact:

```text
collision -> intervention -> accepted outcome
```

Do not assume the UI is broken until this data chain is verified.

## 9. Extend Data For Missing Panels

The current graph contract does not fully support the dark mock's learning-loop
rail or activity stream.

Recommended additive extension:

```ts
interface PodGraphLoopStep {
  id: 'observe' | 'store' | 'predict' | 'outcome' | 'adapt';
  label: string;
  value: string;
  detail: string;
  status: 'idle' | 'active' | 'complete';
}

interface PodGraphActivity {
  id: string;
  at: string;
  kind: 'editing' | 'collision' | 'warns' | 'outcome' | 'learned_from';
  label: string;
  detail: string;
  nodeId?: string;
  edgeId?: string;
}

interface PodGraph {
  ...
  loop?: PodGraphLoopStep[];
  activity?: PodGraphActivity[];
}
```

Possible data mappings:

- Observe:
  recent `observations`.
- Store:
  stored observations / vectorized collisions / memory documents.
- Predict:
  distinct live collisions.
- Outcome:
  accepted vs dismissed outcomes.
- Adapt:
  learned owners / `learned_from` edges / `team_model.ownership`.

Activity stream source:

- `engineer_states.gitUpdatedAt` -> editing/git state.
- `collisions.detectedAt` -> collision.
- `interventions.createdAt` -> warns/intervention.
- `outcomes.recordedAt` -> outcome.
- accepted real outcome -> learned_from/adapt event.

Cap activity rows to 8-10.

## 10. Suggested Implementation Plan

1. Create a new branch from the current graph branch or latest `main`.
2. Read:
   - this file.
   - `claude_team_memory_redesign.md`.
   - `docs/graph.md`.
   - `docs/live-ui-spec.md` if present.
   - `frontend/src/components/GraphView.tsx`.
   - `backend/src/graph/live.ts`.
3. Add graph UI subcomponents:
   - `MetricsRail`.
   - `GraphCanvas`.
   - `LearningLoopRail`.
   - `ActivityStream`.
   - `SelectedNodePanel`.
4. Implement the dynamic graph canvas first.
5. Add the learning-loop rail and activity stream.
6. Polish interaction states:
   - hover.
   - selected node.
   - selected edge/path.
   - empty/live-loading/offline.
7. Verify with local live data.
8. Capture screenshots at desktop and narrow widths.
9. Run:
   - `pnpm build` or local `vite build`.
   - `tsc` for shared/backend/frontend.
10. Open a PR. Do not push directly to `main`.

## 11. Acceptance Criteria

The redesign is acceptable only when:

- The default view is readable in 10 seconds.
- The graph is dynamic, not static columns.
- It includes metrics, graph, learning-loop rail, activity stream, selected-node
  panel, and legend.
- The primary risk path is obvious.
- Labels do not overlap in the default view.
- Whole graph mode exists but can be visually denser.
- It uses real data from the materializer.
- It remains composed from light shadcn/ruixen primitives where possible.
- It builds successfully.
- It is verified after a hard refresh because the PWA can cache stale bundles.

## 12. What Not To Do

- Do not make a marketing page.
- Do not make a generic dashboard.
- Do not rewrite the backend materializer unless the UI needs a small additive
  field.
- Do not return to the dark UI wholesale.
- Do not keep the static column layout as the final answer.
- Do not show raw full paths as always-on canvas labels.
- Do not show every edge at equal opacity.
- Do not hide the learning loop in copy only; it needs a visible rail or panel.

## 13. Demo Script The UI Should Support

The final UI should support this story:

1. Engineer A and Engineer B work in the same repo.
2. One has unpushed changes.
3. PodMan observes the overlap.
4. A collision node appears and pulses.
5. PodMan sends a sync PR / warning intervention.
6. The intervention diamond appears.
7. The team accepts.
8. The outcome appears in the activity stream.
9. A `learned_from` edge appears or pulses.
10. The learning-loop rail advances to Adapt.

That is the recursive self-improvement moment. Everything else is supporting
evidence.

## 14. Open Questions For The Implementer

- Should dynamic layout be `d3-force` or animated layered SVG?
- Should loop/activity be added to `PodGraph` or exposed as separate endpoints?
- Should the demo seed one intact accepted outcome chain?
- Should `Whole graph` be hidden behind an explicit "inspect full graph" affordance?
- Should mobile show a simplified activity-first version instead of the full graph?

Answer these in code comments or PR notes when implementing.

## 15. Final Reminder

The backend now has real graph glue. The UI needs to become a **live learning
observatory**, not a static graph dump.

Make the light version earn the same reaction as the dark Bauhaus mock:

```text
I can see what happened.
I can see what PodMan did.
I can see what it learned.
```
