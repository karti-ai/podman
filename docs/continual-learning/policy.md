# Continual Learning Policy

Status: demo-backed / active
Scope: what PodMan may learn about a team

## Prime Rule

PodMan learns coordination patterns, not personal surveillance profiles.

## Allowed Memory

PodMan may store:

- File and symbol ownership.
- Active file overlap.
- Repeated collision signatures.
- Intervention history.
- Accepted and dismissed outcomes.
- Routing preferences by event type and severity.
- Summaries of decisions relevant to future coordination.

## Forbidden Memory

PodMan must not store:

- Raw screenshots.
- Screen recordings.
- Secrets or credentials.
- Full terminal logs.
- Personal performance judgments.
- Private content unrelated to the coding task.

## Evidence Policy

| Evidence | Can predict? | Can adapt memory? |
| --- | --- | --- |
| Vision only | Yes, low confidence | No |
| Git watcher | Yes | No, unless repeated |
| GitHub state | Yes | No, unless verified |
| Accepted real outcome | Yes | Yes |
| Dismissed outcome | Yes, for suppression | Yes, as negative signal |
| Verifier result | Yes | Yes |

## Intervention Policy

Use the least intrusive channel:

1. Watch quietly.
2. Card.
3. Hermes message.
4. Voice.

Voice is only for urgent, high-confidence, time-sensitive risks.

## Adaptation Policy

Allowed adaptations:

- Add learned ownership after accepted real outcome.
- Raise confidence for repeated accepted signatures.
- Lower confidence for dismissed signatures.
- Prefer the previously accepted intervention kind.
- Suppress repeated low-value warnings.

Disallowed adaptations:

- Broad threshold changes from one example.
- Treating vector similarity as proof.
- Hiding dismissals.
- Making interruption more aggressive without evidence.

## Retention Policy

Keep:

- Outcomes.
- Signatures.
- Team model memory.
- Strategy metrics.

Summarize or expire:

- Old observations.
- Low-confidence vision-only events.
- Detailed trace text.

Delete immediately:

- Secrets.
- Accidental raw sensitive captures.

## Demo Policy

Seeded data is acceptable only if the demo script is honest about it. Live
learning requires a live or staged outcome write that visibly updates the graph
or future decision.
