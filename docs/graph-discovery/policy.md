# Graph Discovery Policy

Status: demo-backed / active
Scope: graph hygiene, evidence thresholds, and UI truthfulness

## Prime Rule

The graph must be sparse enough to explain the learning loop and truthful enough
to audit from MongoDB.

## Node Policy

Create nodes only when they add explanation value.

Allowed:

- Current engineers.
- Real files.
- Current or recent collisions.
- Interventions tied to surviving collisions.
- Learned ownership paths.

Avoid:

- Test engineers.
- Scratch files.
- URLs or environment values misread as files.
- Repeated identical intervention diamonds.
- Orphan nodes with no story value.

## Edge Policy

Edges need evidence.

| Edge | Required evidence |
| --- | --- |
| `editing` | observation or git state |
| `touches` | file involved in collision |
| `collides` | collision prediction |
| `warns` | intervention record |
| `learned_from` | accepted real outcome |
| `owns` | learned or configured ownership |

## De-Hairball Policy

Default mode must not show every relationship equally.

Rules:

- Default to risk path.
- Collapse repeated collision signatures.
- Cap files and collisions.
- Dim non-risk edges.
- Bundle or curve dense edges.
- Hide low-priority labels until hover or select.
- Prefer selected-node explanation over labels everywhere.

## Truthfulness Policy

- Do not show `learned_from` for orphaned or dismissed outcomes.
- Do not label vector similarity as learned memory.
- Do not show demo seed as live learning unless labeled.
- Do not hide false positives from activity or memory.

## Privacy Policy

Graph labels should not expose secrets, raw terminal output, or sensitive file
contents. File paths are acceptable when they are repo paths and not secret
values.

## Visual Policy

Semantic colors stay stable:

- Engineer: blue.
- File: slate.
- Feature: amber.
- Collision: red.
- Intervention: violet.
- Learned: violet dashed edge.

Chrome should use the app's light shadcn tokens.
