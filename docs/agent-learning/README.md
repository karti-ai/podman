# Agent Learning

Status: planned / narrow v1

Agent learning owns how PodMan can improve its own prompts, detector rules,
policies, verifier choices, and routing strategies. This is deliberately
narrower than team memory: it is a versioned strategy layer, not autonomous code
rewriting.

The constraints in [`../../CLAUDE.md`](../../CLAUDE.md) still govern this track:
one visible self-improving loop, demo stability, no broad platform rewrite, no
dashboard-first product, and no overclaiming.

## Files

| File | Purpose |
| --- | --- |
| [`spec.md`](spec.md) | Read-only data contract for runs, traces, strategies, and proposals |
| [`policy.md`](policy.md) | Promotion, rejection, evidence, and safety rules |
| [`prompt.md`](prompt.md) | Evaluator prompt for narrow strategy improvements |
| [`plan.md`](plan.md) | v1 implementation order if this track is added |

## What Is Implemented Now

- Shared TypeScript contracts for `AgentRun`, `AgentTraceEvent`,
  `StrategyVersion`, and `LearningProposal`.
- Exact signature recall and accepted/dismissed outcomes that can later feed
  strategy decisions.
- Documentation of future collections and indexes.

## What Is Intentionally Cut

- Full autonomous strategy promotion.
- Autonomous code rewriting.
- Multi-agent strategy debates.
- Claims that PodMan trains or rewrites itself from live usage today.

## Demo Proof Path

Observe screen/git state -> detect collision -> send intervention -> accept or
dismiss outcome -> recall similar event -> show changed graph or changed
behavior. In the current demo, this proof is team-memory learning; agent
strategy promotion remains planned unless records are added.
