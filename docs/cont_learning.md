# Continual-Learning Graph Spec

> Owner: graph data + visualization. Status: demo-backed / active.
> Satisfies the documentation-first gate for the `backend/src/graph/*` and
> `frontend/src/components/GraphView.tsx` files. This file is the canonical
> graph spec.

## What this is (and is NOT)

PodMan's **visible "it learned" surface**. The graph is a render of the per-pod
`team_model` — who **owns / edits** which files, where work **collides**, and what
PodMan **learned** from accepted interventions (the `learned_from` edges). It is the
continual-learning loop made legible in 10 seconds: _"PodMan now knows Karti owns auth."_

It is **not** a generic analytics dashboard (judges down-rank dashboard-as-product). It is a
**secondary view** behind the pods list — opened from a header toggle — that exists to make
the self-improving loop _visible_ during the demo. The landing surface stays the pods list.

## Data model — graph as a view of `team_model`

The graph lives in two places, both keyed by `podId`:

1. **Embedded (served to the viz):** the `team_model` document carries a `graph` field:

   ```ts
   // team_model doc (one per pod, unique index { podId: 1 })
   { podId, graph: PodGraph, updatedAt }
   ```

   `GET /api/pods/:podId/graph` returns the live materialized graph first, then
   `team_model.graph`, then a labeled demo graph when neither live nor seeded
   data exists.

2. **Normalized (for traversal):** the same nodes/edges are mirrored into two collections so
   the model can be walked with MongoDB `$graphLookup` (the graph-database pattern):

   | Collection    | Doc shape (`shared/src/graph.ts`)         | Index                        |
   | ------------- | ----------------------------------------- | ---------------------------- |
   | `graph_nodes` | `GraphNodeDoc` = `PodGraphNode` + `podId` | `{ podId: 1, id: 1 }` unique |
   | `graph_edges` | `GraphEdgeDoc` = `PodGraphEdge` + `podId` | `{ podId: 1, source: 1 }`    |

Node kinds: `engineer · feature · file · collision · intervention`.
Edge kinds: `owns · editing · touches · collides · warns · learned_from`.
The `learned_from` edges are the continual-learning signal — derived from accepted
`interventions` / `outcomes` (ownership PodMan retains across sessions).

### Traversal (`$graphLookup`)

Walk the directed edge chain from any node (e.g. engineer → file → collision → intervention):

```ts
db.collection('graph_edges').aggregate([
  { $match: { podId, source: startNodeId } },
  {
    $graphLookup: {
      from: 'graph_edges',
      startWith: '$target',
      connectFromField: 'target',
      connectToField: 'source',
      as: 'reaches',
      restrictSearchWithMatch: { podId },
    },
  },
]);
```

This answers "what does this engineer's edit reach?" — the risk path PodMan lights up.

## API

| Method | Route                              | Returns                                       |
| ------ | ---------------------------------- | --------------------------------------------- |
| `GET`  | `/api/pods/:podId/graph`           | `PodGraph` (live `team_model`, demo fallback) |
| `GET`  | `/api/pods/:podId/graph/reach/:id` | `$graphLookup` reachability from node `:id`   |

Additive routes in `backend/src/server.ts` (shared file — additive only).

## Files

- `shared/src/graph.ts` — `PodGraph`, `PodGraphNode/Edge/Metric`, `GraphNodeDoc`, `GraphEdgeDoc`
- `backend/src/graph/demo.ts` — `createDemoPodGraph(podId)` (grounded in the demo-pod crew)
- `backend/src/graph/live.ts` — **`materializePodGraph(podId)`**: builds the graph from the real
  collections (pods, engineer_states, observations, collisions, interventions, outcomes)
- `backend/src/graph/store.ts` — `loadPodGraph` (live → seeded → demo), `seedGraph`, `reachFrom` (`$graphLookup`)
- `backend/src/graph/seed.ts` — `pnpm graph:seed` (writes demo into `team_model` + graph collections)
- `frontend/src/lib/graph.ts` — `fetchPodGraph(podId)`
- `frontend/src/components/GraphView.tsx` — shadcn-themed SVG graph (theme-aware; toggle from `App.tsx`)

## Live data → graph mapping

`materializePodGraph` reads the 5 real collections per pod and emits a `PodGraph`:

| Collection        | Produces                                                                   |
| ----------------- | -------------------------------------------------------------------------- |
| `pods.members`    | baseline **engineer** nodes                                                |
| `engineer_states` | engineer `risk` if unpushed; **file** nodes (git paths parsed); `editing`  |
| `observations`    | engineer `active`; **file** from `currentFile`; `editing` (strength=conf.) |
| `collisions`      | **collision** nodes; `collides` (eng→col) + `touches` (file→col)           |
| `interventions`   | **intervention** nodes; `warns` (col→intervention)                         |
| `outcomes`        | `learned_from` (intervention→owner) on accepted; flips nodes to `learned`  |

Metrics (learned owners / open risk paths / accept rate) are live counts.

## Fallback order (`loadPodGraph`)

1. **Live** — `materializePodGraph` from the real collections (returns `null` if only bare roster).
2. **Seeded** — `team_model.graph` (from `pnpm graph:seed`).
3. **Demo** — `createDemoPodGraph()` (stage safety; never an empty canvas).
