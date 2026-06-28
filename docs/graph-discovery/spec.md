# Graph Discovery Spec

Status: demo-backed / active
Scope: how PodMan discovers graph nodes, edges, risk paths, and learning paths from MongoDB
Owner: graph discovery / Team memory observatory

## Purpose

Graph discovery turns MongoDB memory into a legible Team memory graph. It is not
only layout. It decides which relationships matter, which path is highlighted,
and which evidence explains the graph.

The graph must answer:

1. Who is working?
2. Which files or symbols overlap?
3. Where is the risk?
4. What did PodMan do?
5. What outcome changed memory?

## What Is Implemented Now

- Live materializer first: build from current MongoDB records.
- Seeded graph second: read `team_model.graph` and mirrored graph collections.
- Demo fallback third: return a grounded demo graph when live data is empty or
  unavailable.
- Reachability uses MongoDB `$graphLookup` over `graph_edges`.

## What Is Intentionally Cut

- A graph database migration.
- Whole-history rendering as the default view.
- Claims that seeded graph data is live learning.

## Source Data

Graph discovery reads:

- `pods`
- `engineer_states`
- `observations`
- `collisions`
- `interventions`
- `outcomes`
- `team_model`
- `graph_nodes`
- `graph_edges`
- optional `memory_vectors`
- optional `agent_runs`
- optional `strategy_versions`

## UI Graph Contract

```text
PodGraph
  podId
  generatedAt
  nodes
  edges
  metrics
  loop?
  activity?
```

Node kinds:

```text
engineer, feature, file, collision, intervention
```

Edge kinds:

```text
owns, editing, touches, collides, warns, learned_from
```

## Discovery Rules

### Engineer nodes

Create from pod roster, recent observations, git state, or collision membership.

### File nodes

Create only from normalized real file paths. Reject noise such as URLs, env
values, scratch names, and non-file strings.

### Collision nodes

Create from distinct collision signatures. Collapse repeats. Prioritize
collisions referenced by accepted outcomes.

### Intervention nodes

Create one visible intervention per surviving collision unless whole-graph mode
explicitly expands history.

### Learned paths

Create `learned_from` only when an accepted real outcome links an intervention
to a durable memory update.

## Path Modes

### Risk path

Default mode. Highlight the clearest current chain:

```text
engineer -> file -> collision -> intervention -> learned owner
```

Dim unrelated graph material.

### Learning edges

Highlight `learned_from`, `owns`, and the outcomes that produced them.

### Whole graph

Show all materialized nodes and edges with de-emphasized non-critical edges.

## MongoDB Traversal

Use `graph_edges` for reachability:

```text
source -> target -> next target
```

Primary traversal questions:

- What risks does this engineer reach?
- Which files feed this collision?
- Which intervention came from this collision?
- Which learned owner came from this intervention?

## Metrics

Minimum metrics:

- Learned owners.
- Open risk paths.
- Accept rate.

Optional metrics:

- Observations.
- Interventions.
- Memory vectors.
- Strategy versions.

## Acceptance Criteria

- Default graph is not a hairball.
- Every visible learned edge has outcome evidence.
- Every selected node can explain why it matters.
- Activity stream matches graph events.
- Graph can be rebuilt from MongoDB source records.
