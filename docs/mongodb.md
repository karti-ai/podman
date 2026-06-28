# MongoDB Atlas Integration Spec

Status: demo-backed / active

MongoDB Atlas is PodMan's shared memory. It stores live work observations,
collision predictions (with vector embeddings for recall), interventions,
outcomes, latest engineer state, the materialized Team memory graph, and async
Hermes job runs.

See also:

- [`docs/cont_learning.md`](cont_learning.md) for outcome-backed team memory,
  graph materialization, and `$graphLookup` traversal.

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

Predicted coordination risks, with memory enrichment for recall.

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
- `memoryText` — short text embedded for recall
- `embedding` — vector (Voyage `voyage-4-lite` or Gemini `gemini-embedding-001`)
- `embeddingProvider` — `voyage` | `gemini`

Vector index `collision_embedding` (Atlas Vector Search) powers `$vectorSearch`
recall in `backend/src/memory/vectors.ts`. When Atlas vector search is
unavailable, recall falls back to app-side cosine, then exact signature/file
matching.

Primary use: collision cards, vector + signature recall, and graph risk paths.

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

### `hermes_jobs` and `hermes_job_events`

Async Hermes task runs delegated from the live conversation agent (see
`docs/hermes.md`).

- `hermes_jobs` — one doc per job (`id` unique; `{ sessionId, status, updatedAt }`
  index). Fields: `id`, `podId`, `sessionId`, `prompt`, `contextScope`,
  `riskLevel`, `successCriteria`, `status`, `finalSummary`, timestamps.
- `hermes_job_events` — append-only step log (`{ jobId, createdAt }` index):
  `accepted`, `heartbeat`, `step_started`, `step_output`, `needs_confirmation`,
  `step_completed`, `completed`, `aborted`, `failed`. Output is redacted +
  truncated before storage and mirrored to the room over LiveKit.

Primary use: durable, replayable record of what Hermes did, streamed live to the
conversation UI.

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
