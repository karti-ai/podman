# Graph Discovery

Status: demo-backed / active

Graph discovery owns how MongoDB records become the Team memory graph. It
materializes a sparse, auditable graph from real records first, seeded graph
second, and demo fallback third.

## Files

| File | Purpose |
| --- | --- |
| [`spec.md`](spec.md) | Source data, graph contract, and discovery rules |
| [`policy.md`](policy.md) | Graph hygiene, evidence thresholds, and truthfulness |
| [`prompt.md`](prompt.md) | Graph materialization and review prompt |
| [`plan.md`](plan.md) | Risk-path and observatory build plan |

## What Is Implemented Now

- `GET /api/pods/:podId/graph`.
- `GET /api/pods/:podId/graph/reach/:id` backed by MongoDB `$graphLookup`.
- Live graph materialization from `pods`, `engineer_states`, `observations`,
  `collisions`, `interventions`, and `outcomes`.
- Seeded graph in `team_model.graph` and mirrored `graph_nodes` / `graph_edges`.
- Demo graph fallback so the stage never shows an empty canvas.

## What Is Intentionally Cut

- A separate graph database.
- A broad analytics dashboard.
- Showing every historical event by default.
- Treating seeded demo data as live learning.

## Demo Proof Path

Observe screen/git state -> detect collision -> send intervention -> accept or
dismiss outcome -> recall similar event -> show changed graph or changed
behavior.
