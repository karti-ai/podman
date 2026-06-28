# MongoDB Atlas Integration Spec

Status: demo-backed / active

MongoDB Atlas is PodMan's shared memory. It stores live work observations,
collision predictions, interventions, outcomes, latest engineer state, the
materialized Team memory graph, and optional future recall records.

See also:

- [`docs/continual-learning/`](continual-learning/) for outcome-backed team
  memory.
- [`docs/graph-discovery/`](graph-discovery/) for graph materialization and
  `$graphLookup` traversal.
- [`docs/agent-learning/`](agent-learning/) for planned strategy-version
  records.

---

## Current Collections

### `engineer_states`

Latest context per engineer. The local git watcher writes git fields; the vision
pipeline may write screen-derived fields. Each writer updates only its own
fields so MongoDB upserts merge cleanly.

Key fields:

- `podId`
- `name`
- `currentFile`
- `inferredTask`
- `confidence`
- `changedFiles`
- `diffStat`
- `recentCommit`
- `branch`
- `visionUpdatedAt`
- `gitUpdatedAt`
- `updatedAt`

Primary use: deterministic dirty/unpushed truth for collision detection and
graph discovery.

### `observations`

Structured perception events from consented screen context and agent inference.

Key fields:

- `podId`
- `engineerId`
- `currentFile`
- `symbol`
- `activity`
- `confidence`
- `observedAt`

Primary use: observe/store proof and active editing edges in the Team memory
graph.

### `collisions`

Predicted coordination risks.

Key fields:

- `id`
- `podId`
- `file`
- `symbol`
- `engineers`
- `severity`
- `memorySignature`
- `githubState`
- `detectedAt`

Primary use: collision cards, exact signature recall, and graph risk paths.

### `interventions`

Actions PodMan sent or suggested.

Key fields:

- `id`
- `podId`
- `collisionId`
- `kind`
- `message`
- `suggestedAction`
- `status`
- `createdAt`

Primary use: closing the loop from prediction to a visible card, Hermes message,
or urgent voice cue.

### `outcomes`

Human or verifier supervision recorded through `POST /api/outcome`.

Key fields:

- `podId`
- `interventionId`
- `collisionId`
- `accepted`
- `wasRealCollision`
- `recordedAt`

Primary use: accepted and dismissed outcomes drive exact recall, suppression,
and learned graph paths.

### `team_model`

Durable per-pod summary memory.

Key fields:

- `podId`
- `ownership`
- `hotspots`
- `graph`
- `updatedAt`

Primary use: stable Team memory, including seeded `graph` snapshots used after
live materialization and before demo fallback.

### `graph_nodes` and `graph_edges`

Normalized mirror of the Team memory graph for MongoDB traversal.

Indexes:

- `graph_nodes`: `{ podId: 1, id: 1 }` unique
- `graph_edges`: `{ podId: 1, source: 1 }`

Primary use: `GET /api/pods/:podId/graph/reach/:id` with `$graphLookup`.

### Optional Future Collections

These are documented for planned work and should not be treated as active write
paths unless implementation is added:

- `memory_vectors`
- `agent_runs`
- `agent_trace_events`
- `strategy_versions`
- `learning_proposals`

---

## Graph Truth Order

`GET /api/pods/:podId/graph` follows this order:

1. Live graph from real collections.
2. Seeded graph from `team_model.graph` and mirrored graph records.
3. Demo fallback graph for stage safety.

Seeded and fallback graphs are acceptable for demos only when labeled honestly.

---

## Demo Proof Path

Observe screen/git state -> detect collision -> send intervention -> accept or
dismiss outcome -> recall similar event -> show changed graph or changed
behavior.

---

## What MongoDB Does Not Store

- Raw screenshot frames.
- Screen recordings.
- Secrets or credentials.
- Full terminal logs.
- Full Gemini response objects beyond extracted fields needed for memory.
