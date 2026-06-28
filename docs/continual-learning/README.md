# Continual Learning

Status: demo-backed / active

PodMan's continual-learning track owns team memory: what the system learns about
files, collisions, interventions, outcomes, and future routing for a pod.

## Files

| File | Purpose |
| --- | --- |
| [`spec.md`](spec.md) | Data model and observe/store/predict/outcome/adapt loop |
| [`policy.md`](policy.md) | What PodMan may and may not remember |
| [`prompt.md`](prompt.md) | Memory-agent prompt for outcome-backed learning |
| [`plan.md`](plan.md) | Demo build order and acceptance criteria |

## What Is Implemented Now

- MongoDB-backed `observations`, `collisions`, `interventions`, `outcomes`,
  `engineer_states`, and `team_model` records.
- Exact signature recall for prior accepted and dismissed outcomes.
- Outcome writes through `POST /api/outcome`.
- Team memory graph edges from accepted real outcomes.
- No raw screenshots or recordings are stored.

## What Is Intentionally Cut

- Autonomous model training.
- Broad cross-pod generalization.
- Raw screen capture retention.
- Vector recall as a dependency for the demo proof.

## Demo Proof Path

Observe screen/git state -> detect collision -> send intervention -> accept or
dismiss outcome -> recall similar event -> show changed graph or changed
behavior.
