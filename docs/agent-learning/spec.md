# Agent Learning Spec

Status: draft  
Scope: how PodMan agents improve their own prompts, policies, detectors, and routing behavior  
Owner: agent learning / recursive self-improvement

## Purpose

Agent learning is the recursive self-improvement layer. It is not the same as
team memory. Team memory learns about engineers and work. Agent learning learns
which agent strategies produce better outcomes.

The demo claim:

1. PodMan tries a coordination strategy.
2. The run is traced in MongoDB.
3. A verifier or human outcome scores it.
4. Gemini or another agent proposes a narrow strategy change.
5. The new strategy is versioned.
6. A later run uses the improved strategy and shows a better result.

## Core Objects

### Agent run

One attempt to execute a goal.

```text
agent_runs
  runId
  podId
  goal
  trigger
  strategyVersionId
  status
  startedAt
  completedAt
  score
  verifierSummary
  inputRefs
  outputRefs
```

Allowed `status` values:

```text
running, succeeded, failed, improved, regressed, abandoned
```

### Trace event

Append-only event log for a run.

```text
agent_trace_events
  runId
  podId
  step
  phase
  eventType
  inputSummary
  outputSummary
  toolName
  error
  metrics
  createdAt
```

### Strategy version

Versioned prompt, detector rule, policy, verifier, or routing strategy.

```text
strategy_versions
  strategyVersionId
  podId
  kind
  name
  parentVersionId
  status
  summary
  promptText
  policy
  verifier
  metrics
  createdAt
  promotedAt
```

Allowed `kind` values:

```text
prompt, policy, detector, verifier, routing
```

Allowed `status` values:

```text
candidate, active, retired, rejected
```

### Learning proposal

A candidate change before promotion.

```text
learning_proposals
  proposalId
  podId
  sourceRunId
  targetKind
  parentVersionId
  proposedChange
  rationale
  verifierPlan
  status
  createdAt
  resolvedAt
```

Allowed `status` values:

```text
open, accepted, rejected, superseded
```

## MongoDB Indexes

| Collection | Index | Purpose |
| --- | --- | --- |
| `agent_runs` | `{ podId: 1, startedAt: -1 }` | Recent run history |
| `agent_runs` | `{ podId: 1, strategyVersionId: 1 }` | Compare strategy performance |
| `agent_trace_events` | `{ runId: 1, step: 1 }` | Reconstruct run |
| `strategy_versions` | `{ podId: 1, kind: 1, status: 1 }` | Find active strategy |
| `strategy_versions` | `{ podId: 1, createdAt: -1 }` | Version history |
| `learning_proposals` | `{ podId: 1, status: 1 }` | Open candidate changes |

## Learning Loop

```text
observe run -> score run -> propose change -> test candidate -> promote or reject
```

Agent learning must always connect these records:

```text
agent_run -> trace_events -> verifier result -> learning_proposal -> strategy_version
```

## Verifier Contract

Every promoted strategy needs a verifier signal.

Allowed verifier types:

- Human accepted or dismissed outcome.
- Test pass or fail result.
- Reduced false positive rate.
- Reduced intervention count with same or better accepted outcomes.
- Faster successful run.
- Better graph discovery precision.
- Explicit demo operator approval.

Self-evaluation alone is not enough to promote a strategy.

## Relationship to Team Graph

Agent learning can appear in the Team memory graph as activity and loop status,
but it should not clutter the main risk graph by default.

Graph discovery may show:

- `agent_run` activity in the stream.
- `strategy_versions` count in the learning loop.
- A selected-node detail saying a policy changed because a prior outcome was
  dismissed or accepted.

## Acceptance Criteria

- Every strategy change has a parent.
- Every promoted strategy cites evidence.
- Rejected strategies are retained with a reason.
- Agent traces are append-only.
- The system can answer: "What changed, why, and did it help?"

