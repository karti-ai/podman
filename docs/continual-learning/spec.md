# Continual Learning Spec

Status: demo-backed / active
Scope: how PodMan learns team memory from live work and outcomes
Owner: continual learning / Team memory

## Purpose

Continual learning is the product proof that PodMan gets more useful from use.
It learns team-level coordination memory: ownership, repeated collisions,
accepted interventions, dismissed noise, and preferred routing.

The visible loop:

```text
observe -> store -> predict -> outcome -> adapt
```

## What Is Implemented Now

- `observations`, `collisions`, `interventions`, `outcomes`,
  `engineer_states`, `team_model`, `graph_nodes`, and `graph_edges` are the
  current memory truth.
- Exact signature recall and accepted/dismissed outcomes exist.
- Accepted real outcomes can produce `learned_from` graph edges and ownership
  memory.
- Raw screenshots and recordings are not stored.

## What Is Intentionally Cut

- Full autonomous training.
- Broad threshold changes from one example.
- Making vector search required for the demo learning proof.

## Source Collections

### `engineer_states`

Latest per-engineer state from vision and local git.

Key fields:

- `podId`
- `name`
- `currentFile`
- `changedFiles`
- `branch`
- `confidence`
- `visionUpdatedAt`
- `gitUpdatedAt`
- `updatedAt`

### `observations`

Structured perception events.

Key fields:

- `podId`
- `engineerId`
- `currentFile`
- `symbol`
- `activity`
- `confidence`
- `observedAt`

### `collisions`

Predicted risk events.

Key fields:

- `id`
- `podId`
- `file`
- `symbol`
- `engineers`
- `severity`
- `status`
- `memorySignature`
- `detectedAt`

### `interventions`

Actions PodMan sent or suggested.

Key fields:

- `id`
- `podId`
- `collisionId`
- `kind`
- `channel`
- `message`
- `suggestedAction`
- `createdAt`

### `outcomes`

Human or verifier supervision.

Key fields:

- `id`
- `podId`
- `interventionId`
- `collisionId`
- `accepted`
- `wasRealCollision`
- `learnedOwner`
- `recordedAt`

### `team_model`

Durable pod memory.

Key fields:

- `podId`
- `graph`
- `ownership`
- `collisionSignatures`
- `interventionPolicy`
- `updatedAt`

### `memory_vectors`

Optional semantic recall. Exact recall comes first.

Key fields:

- `podId`
- `sourceKind`
- `sourceId`
- `text`
- `embedding`
- `embeddingModel`
- `tags`

## Learning Rules

### Observe

Write structured evidence from vision, git, GitHub, and agent traces.

### Store

Persist source records and materialized summaries. Do not store raw screenshots
or recordings.

### Predict

Create a collision when multiple engineers converge on the same normalized file
or symbol and at least one signal shows active or unpushed work.

### Outcome

Record whether the intervention was accepted, dismissed, real, or false.

### Adapt

Only accepted real outcomes can create `learned_from` graph edges. Dismissals
adapt suppression, routing, or confidence.

## Exact Signature

Use deterministic signatures:

```text
podId:eventType:normalizedFile:symbol:sortedEngineers
```

Rules:

- Sort engineer names.
- Normalize file paths.
- Use `*` for missing symbol.
- Never include timestamps.

## UI-Facing Loop Snapshot

The graph response may include:

```text
loop
  activeStep
  steps[]
    key
    label
    value
    detail
    status
```

Step mapping:

| Step | Source |
| --- | --- |
| Observe | recent observations and git updates |
| Store | team model, graph records, memory vectors |
| Predict | open collisions |
| Outcome | accepted and dismissed outcomes |
| Adapt | learned owners, learned edges, strategy changes |

## Activity Stream

The graph response may include:

```text
activity[]
  id
  at
  kind
  title
  detail
  nodeId
  edgeId
```

Allowed `kind` values:

```text
editing, collision, intervention, outcome, learned, agent
```

## Acceptance Criteria

- The system can show one accepted outcome changing future memory.
- Exact recall works without vector search.
- The Team memory graph can explain the learning loop.
- Dismissals and false positives are retained.
- The demo does not rely on raw screenshots or hidden state.
