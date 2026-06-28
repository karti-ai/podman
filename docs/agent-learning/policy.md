# Agent Learning Policy

Status: draft  
Scope: guardrails for recursive self-improvement

## Prime Rule

PodMan may improve its agent behavior only when the improvement is narrow,
evidence-backed, versioned, and reversible.

## Allowed Learning

PodMan may learn:

- Which prompt version produces clearer interventions.
- Which detector threshold reduces false positives.
- Which routing channel gets accepted without being intrusive.
- Which verifier best predicts user acceptance.
- Which graph-discovery rule produces cleaner risk paths.

## Disallowed Learning

PodMan must not:

- Promote a strategy because the model says it is better.
- Rewrite broad system behavior from one example.
- Hide failures, dismissals, or rejected candidates.
- Learn from raw screenshots, secrets, or private terminal content.
- Turn voice into the default route.
- Create irreversible actions without human approval.

## Promotion Rules

A candidate strategy can become active only when all are true:

1. It has a parent strategy version.
2. It describes one concrete behavior change.
3. It has a verifier plan.
4. It has evidence from a run, outcome, or test.
5. It improves or fixes the target metric.
6. It does not increase user interruption without payoff.

## Rejection Rules

Reject and retain the candidate when:

- The verifier regresses.
- The change is too broad.
- The evidence is missing.
- The candidate conflicts with privacy rules.
- The candidate makes the demo less stable.

## Evidence Strength

| Evidence | Strength | Use |
| --- | --- | --- |
| Model opinion | Weak | Proposal only |
| Trace observation | Medium | Candidate rationale |
| Human accepted outcome | Strong | Promotion candidate |
| Human dismissed outcome | Strong | Suppression or rejection |
| Automated verifier | Strong | Promotion or rejection |
| Repeated accepted exact signature | Strong | Policy confidence increase |

## Versioning Rules

- Strategy versions are immutable after promotion or rejection.
- There is one active version per `podId + kind`.
- A rollback activates the previous version; it does not edit history.
- Parent-child lineage must be preserved.

## Safety Rules

- Store summaries, not raw sensitive content.
- Prefer deterministic checks over model judgment.
- Use exact MongoDB recall before vector recall.
- Ask for approval before changing code or data with external effects.
- Treat hackathon demo stability as a hard constraint.

## Demo Honesty

Seeded strategy versions are acceptable when labeled as demo-backed. Do not claim
a strategy was learned live unless a run and outcome actually created the
promotion evidence.

