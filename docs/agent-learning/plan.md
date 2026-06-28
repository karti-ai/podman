# Agent Learning Plan

Status: draft  
Goal: ship a visible recursive self-improvement loop without overbuilding

## Must-Have

1. Store agent runs.
2. Store trace summaries.
3. Store active and candidate strategy versions.
4. Attach verifier or outcome evidence.
5. Show one strategy improvement in the demo narrative.

## Build Order

### R1: Trace the run

Write one `agent_runs` record for an important coordination decision and append
trace events for:

- observation
- recall
- prediction
- intervention
- outcome
- adaptation

### R2: Version the strategy

Create an active strategy version for one of:

- collision detector threshold
- intervention routing
- graph discovery filter
- card wording prompt

### R3: Score the outcome

Use the simplest verifier:

- accepted real collision = useful
- dismissed = noisy
- no response after cooldown = uncertain

### R4: Propose a narrow change

Examples:

- "For this exact signature, prefer sync PR card."
- "For dismissed docs-only overlaps, suppress voice escalation."
- "For repeated auth.ts collisions, raise severity."

### R5: Promote or reject

Promote only when evidence is strong enough. Otherwise keep the candidate as
rejected or open.

## Demo Path

1. Show baseline strategy.
2. Trigger a collision.
3. Accept or dismiss the intervention.
4. Store outcome.
5. Show a candidate strategy update.
6. Promote it.
7. Trigger a similar event.
8. Show changed behavior.

## Nice-to-Have

- Strategy comparison panel.
- Model-generated prompt patch with verifier.
- Vector recall over strategy history.
- Rollback UI.

## Cut

- Full autonomous code rewriting.
- Multi-agent strategy debates.
- Long-term benchmark suite.
- Training a model.

## Acceptance Criteria

- The demo can point to a MongoDB record proving the agent changed behavior.
- The changed behavior is visible.
- The strategy has a parent and evidence.
- Rejected or failed changes are not deleted.

