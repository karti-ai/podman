# Codex Handoff: MongoDB Cleanup, Team Memory Graph, and RSI Learning Docs

Date: 2026-06-28  
Repo state checked: `main` at `1d097b1`  
Database checked: MongoDB Atlas database named `podman`  
Scope: docs/spec handoff, live Team memory graph verification, and safe DB cleanup path

## Current Repo State

The local checkout was moved to `main` and fast-forwarded to `origin/main`.
Working tree was clean after inspection.

The learning and graph specification docs are present on `main`:

- `docs/agent-learning/README.md`
- `docs/agent-learning/spec.md`
- `docs/agent-learning/policy.md`
- `docs/agent-learning/plan.md`
- `docs/agent-learning/prompt.md`
- `docs/continual-learning/README.md`
- `docs/continual-learning/spec.md`
- `docs/continual-learning/policy.md`
- `docs/continual-learning/plan.md`
- `docs/continual-learning/prompt.md`
- `docs/graph-discovery/README.md`
- `docs/graph-discovery/spec.md`
- `docs/graph-discovery/policy.md`
- `docs/graph-discovery/plan.md`
- `docs/graph-discovery/prompt.md`

These docs describe the intended architecture, but only some pieces are backed
by live Atlas collections today.

## Verification Summary

Atlas connection is valid through local `.env` `MONGODB_URI`. No secrets were
printed during verification.

Public API checks:

- `https://165-22-129-249.sslip.io/health` returned `200` with `{ "ok": true }`.
- `GET /api/pods` returned one real pod: `demo-pod`.
- `GET /api/pods/demo-pod/graph` returned a live materialized Team memory graph.

Live graph response for `demo-pod`:

- Nodes: `31`
- Edges: `59`
- Learned owners metric: `2`
- Open risk paths metric: `2`
- Accept rate metric: `39%`
- Learning loop active step: `adapt`
- Learned edges: `2` `learned_from` edges
- Activity stream populated from real records

Important conclusion:

The main Team memory graph endpoint is real and backed by Atlas live
materialization. It is not merely returning the demo fallback.

## Atlas Collection Snapshot

Approximate counts observed:

| Collection | Count / status |
| --- | ---: |
| `pods` | 1 |
| `engineer_states` | 9 |
| `observations` | 2318 |
| `collisions` | 451 |
| `interventions` | 362 |
| `outcomes` | 107 |
| `team_model` | 65 |
| `graph_nodes` | 715 |
| `graph_edges` | 845 |
| `hermes_jobs` | 29 |
| `hermes_job_events` | 337 |
| `memory_vectors` | missing |
| `agent_runs` | missing |
| `agent_trace_events` | missing |
| `strategy_versions` | missing |
| `learning_proposals` | missing |

Real pod:

```text
demo-pod
  name: demo pod
  members: ram, Karti, yahya, shakthi
```

Noise observed:

- Many `verify-pod-*` records.
- Many `verify-graph-*` records.
- `Verify ...` observations inside `demo-pod`.
- Orphaned verify outcomes in `demo-pod`.
- Some stale or duplicate engineer state casing, e.g. `Shakthi` and `shakthi`.
- `frontend-pod` outcomes with no corresponding active pod.

## What Is Real Today

The following are real and active:

- Atlas connectivity.
- `demo-pod` pod record.
- Real `engineer_states` for demo members.
- Real observation/collision/intervention/outcome collections.
- Live graph materialization from source collections.
- Graph response `loop` and `activity` fields.
- Real `learned_from` edges produced by accepted real outcomes that still join
  back to surviving intervention/collision records.

The following are not yet real:

- `memory_vectors` collection.
- `agent_runs` collection.
- `agent_trace_events` collection.
- `strategy_versions` collection.
- `learning_proposals` collection.

That means the continual-learning story is currently supported by exact MongoDB
records and graph edges. The richer agent-learning spec is documented but not
implemented in Atlas yet.

## Claude Code Review Addendum

Source: pasted Claude Code review text approved for Codex to read. The review
was treated as input, then reconciled against current `main` and the Atlas check
above. Do not copy the review blindly; a few findings were from an older repo
state or have since been superseded.

### Still Material Findings

The review correctly identifies the main mismatch:

```text
The docs describe a broader self-improving platform, while the shipped product
currently has a narrower but real recall-and-policy loop.
```

The shipped loop lives in code, not in the aspirational agent-learning docs:

- `backend/src/agent/podman.ts`
  - Calls `recallSimilar(collision)`.
  - If prior memory exists, bumps severity to `critical`.
  - Calls `shouldIntervene(collision, prior)`.
  - Calls `preferredAction(collision, prior)`.
  - Adds the visible message suffix `Seen before.` when prior memory exists.
- `backend/src/memory/policy.ts`
  - Suppresses known false-positive prior outcomes.
  - Enforces pod cooldown.
  - Reuses a prior accepted intervention action when available.
- `backend/src/memory/vectors.ts`
  - Stores `memorySignature`, `memoryText`, and optional `embedding` on
    `collisions`.
  - `recallSimilar` tries vector recall first, then signature/file fallback.

This is the real recursive/self-improving asset today:

```text
new collision -> recall prior collision -> adjust severity/action/message ->
record outcome -> future collision changes behavior
```

The current docs should eventually be reconciled around this loop instead of
implying the full agent-learning platform already exists.

### Confirmed Aspirational Areas

The following are documented but not live in Atlas/code yet:

- `agent_runs`
- `agent_trace_events`
- `strategy_versions`
- `learning_proposals`
- `memory_vectors`

The `agent-learning` docs should be treated as future architecture unless a
small, explicit slice is implemented. For demo purposes, do not build a broad
strategy-versioning platform. If time allows, the smallest credible slice is one
stored policy/strategy row that explains a concrete behavior change.

### Outcome Write Caveat

`backend/src/memory/store.ts` `recordOutcome` currently:

- inserts the outcome into `outcomes`;
- updates the intervention status to `accepted` or `dismissed`.

It does not currently persist `team_model.ownership`. The live graph can still
derive `owns` and `learned_from` from accepted real outcomes at read time, but a
literal "before/after MongoDB ownership write" does not exist yet.

If the demo needs a concrete durable ownership diff, add a small explicit write
on accepted real outcomes:

```text
accepted && wasRealCollision -> team_model.ownership[normalizedFile] = learnedOwner
```

That should be a separate code task, not part of the DB cleanup unless the user
explicitly asks.

### Vector Recall Caveat

The docs often say "exact recall first." Current code does the reverse:

```text
recallSimilar = vector recall first, then signature/file fallback
```

Also:

- Embeddings live on `collisions`, not `memory_vectors`.
- Atlas vector index name in code is `collision_embedding`.
- Gemini embedding calls request `outputDimensionality: 768`.
- Voyage embeddings may have a different dimensionality depending on model.

For the hackathon demo, exact/signature/file fallback is the reliable story.
Vector recall should remain nice-to-have unless Atlas index configuration is
verified.

### Demo Script Caveat

`docs/demo-setup.md` is stale relative to the Team memory observatory demo. It
still describes an older Hermes/voice/blocker flow and does not script:

- graph observatory;
- collision -> intervention -> outcome;
- `learned_from`;
- run 1 vs run 2 changed behavior.

Before stage rehearsal, rewrite `docs/demo-setup.md` around the actual
observatory path.

### Superseded Review Findings

The pasted review included two findings that must be treated carefully:

- It claimed the current `shared/src/graph.ts` had an older `LearningStage` /
  `ActivityEvent.text` contract. Current `main` uses `PodLearningLoop` with
  `activeStep`, step `status`, and `PodGraphActivity` with `title` / `detail`.
  Always check `shared/src/graph.ts` before editing specs.
- It claimed the hero `learned_from` edge did not render on `demo-pod`. The
  current Atlas/public API check returned two live `learned_from` edges. The
  risk is still real if cleanup deletes accepted real outcomes or their joined
  collision/intervention records. Preserve the intact accepted chains.

### Priority Reconciliation Tasks

After the DB cleanup script, the next documentation/code priorities should be:

1. Rewrite `docs/demo-setup.md` as the canonical graph observatory demo script.
2. Add a short `docs/recursive-loop.md` or equivalent section that names the
   real shipped loop in `podman.ts`, `policy.ts`, and `vectors.ts`.
3. Mark agent-learning collections and strategy versioning as not-yet-built
   unless implemented.
4. Reconcile vector-recall language in docs with current `vectors.ts`.
5. Optionally add the `recordOutcome` ownership write if a durable ownership
   diff is needed for judging.

## Main Data Issue

The live graph and the normalized graph mirror are out of sync.

Live materializer for `demo-pod`:

```text
31 nodes
59 edges
2 learned_from edges
```

Normalized mirror in `graph_nodes` / `graph_edges` for `demo-pod`:

```text
11 seeded/demo-style nodes
13 seeded/demo-style edges
```

Impact:

- `GET /api/pods/demo-pod/graph` is good and real.
- `GET /api/pods/demo-pod/graph/reach/:nodeId` uses `graph_edges`, so it can
  return stale seeded paths.
- Example observed:
  - `/graph/reach/engineer:karti` returned a seeded path.
  - `/graph/reach/engineer:ram` returned `0`, even though Ram is present in the
    live graph.

The cleanup should therefore include a mirror rebuild after deleting test data.

## Relevant Code Paths

Graph and MongoDB:

- `backend/src/graph/live.ts`
  - Live materializer.
  - Reads `pods`, `engineer_states`, `observations`, `collisions`,
    `interventions`, `outcomes`, and `team_model`.
  - Produces `nodes`, `edges`, `metrics`, `loop`, and `activity`.
- `backend/src/graph/store.ts`
  - `loadPodGraph`: live materializer first, then seeded `team_model.graph`,
    then demo fallback.
  - `seedGraph`: writes seeded graph into `team_model`, `graph_nodes`,
    `graph_edges`.
  - `reachFrom`: uses `$graphLookup` over `graph_edges`.
- `backend/src/memory/db.ts`
  - MongoDB connection and core collection helpers.
- `shared/src/graph.ts`
  - Public graph contract including optional `loop` and `activity`.

Docs:

- `docs/mongodb.md`
- `docs/graph.md`
- `docs/graph-discovery/`
- `docs/continual-learning/`
- `docs/agent-learning/`

## DB Cleanup Goal

Get Atlas into a demo-stable state:

1. Preserve real `demo-pod` learning history.
2. Remove verification/orphan/test records.
3. Rebuild `graph_nodes` and `graph_edges` from the live materialized graph.
4. Keep cleanup repeatable and reversible.
5. Avoid ad hoc shell deletes.

## Required Safety Rule

Take a backup before deleting anything.

```bash
mongodump "$MONGODB_URI" --archive=podman-before-cleanup.archive --gzip
```

Do not commit the archive.

## Cleanup Keep Set

Start with this conservative keep set:

```js
const keepPods = ["demo-pod"];
```

Records with `podId` outside this set are cleanup candidates unless there is a
specific reason to preserve them.

## Phase 1: Dry-Run Counts

Write a script that defaults to dry-run. It should print counts only.

Candidate file:

```text
scripts/db-cleanup.mjs
```

Default behavior:

```bash
node scripts/db-cleanup.mjs --dry-run
```

Apply behavior:

```bash
node scripts/db-cleanup.mjs --apply
```

The script must not delete anything unless `--apply` is present.

## Phase 2: Remove Orphan/Test Pod Data

Delete records whose `podId` is not in `keepPods`.

Collections:

- `engineer_states`
- `observations`
- `collisions`
- `interventions`
- `outcomes`
- `team_model`
- `graph_nodes`
- `graph_edges`
- `hermes_jobs`
- `hermes_job_events`

Filter:

```js
{ podId: { $nin: ["demo-pod"] } }
```

Note:

Some `pods` documents may use `id` instead of `podId`. For `pods`, do not use
the filter above. Keep the document with `id: "demo-pod"` and delete obvious
test pods only if they exist.

## Phase 3: Clean Demo-Pod Verification Artifacts

Within `demo-pod`, delete only obvious verification records.

### Observations

```js
{
  podId: "demo-pod",
  $or: [
    { engineerId: /^Verify\b/ },
    { currentFile: /^PodMan verification screen$/ },
    { currentFile: /^frame \d+$/ }
  ]
}
```

### Outcomes

```js
{
  podId: "demo-pod",
  $or: [
    { interventionId: /^int-verify-/ },
    { collisionId: /^col-verify-/ }
  ]
}
```

### Collisions and Interventions

Be more conservative. Delete only records that clearly have verify IDs or no
matching counterpart.

Safe candidate filters:

```js
// collisions
{
  podId: "demo-pod",
  id: /^col-verify-/
}

// interventions
{
  podId: "demo-pod",
  id: /^int-verify-/
}
```

Optional orphan cleanup:

- Delete interventions whose `collisionId` does not exist in `collisions`.
- Delete outcomes whose `interventionId` does not exist in `interventions` and
  whose `collisionId` does not exist in `collisions`.

Run orphan cleanup only after dry-run prints exact IDs and counts.

## Phase 4: Normalize Demo-Pod Engineer State

Keep canonical active engineers:

```text
ram
Karti
yahya
shakthi
```

Cleanup candidates:

```js
{
  podId: "demo-pod",
  $or: [
    { name: /^Verify\b/ },
    { name: /^codex-check$/i },
    { name: /^testrepo/i },
    { name: "Shakthi" }
  ]
}
```

Only delete `Shakthi` if `shakthi` is confirmed as the canonical current record.

## Phase 5: Rebuild Graph Mirror

This is the most important post-cleanup step.

The live graph endpoint is real, but reachability uses stale mirrored records.
After cleanup:

1. Materialize the live graph for `demo-pod`.
2. Delete mirrored rows for `demo-pod`.
3. Insert live graph nodes into `graph_nodes`.
4. Insert live graph edges into `graph_edges`.
5. Update `team_model.graph` and `team_model.updatedAt`.

Pseudocode:

```js
const graph = await materializePodGraph("demo-pod");

await db.collection("graph_nodes").deleteMany({ podId: "demo-pod" });
await db.collection("graph_edges").deleteMany({ podId: "demo-pod" });

await db.collection("graph_nodes").insertMany(
  graph.nodes.map((node) => ({ ...node, podId: "demo-pod" }))
);

await db.collection("graph_edges").insertMany(
  graph.edges.map((edge) => ({ ...edge, podId: "demo-pod" }))
);

await db.collection("team_model").updateOne(
  { podId: "demo-pod" },
  { $set: { podId: "demo-pod", graph, updatedAt: new Date().toISOString() } },
  { upsert: true }
);
```

Important:

Use `materializePodGraph`, not `createDemoPodGraph`, for this rebuild.
`seedGraph` currently writes a demo graph and would recreate the stale mismatch.

## Phase 6: Add Helpful Indexes

Current `initMemory` creates the core indexes, but cleanup/reachability benefits
from these as well:

```js
db.graph_nodes.createIndex({ podId: 1, id: 1 }, { unique: true });
db.graph_edges.createIndex({ podId: 1, id: 1 }, { unique: true });
db.graph_edges.createIndex({ podId: 1, source: 1 });
db.graph_edges.createIndex({ podId: 1, target: 1 });
db.graph_edges.createIndex({ podId: 1, kind: 1 });
db.team_model.createIndex({ podId: 1 }, { unique: true });
db.collisions.createIndex({ podId: 1, memorySignature: 1 });
db.outcomes.createIndex({ podId: 1, interventionId: 1 });
db.interventions.createIndex({ podId: 1, collisionId: 1 });
```

Make index creation idempotent.

## Validation After Cleanup

Run these checks after `--apply`.

### Atlas counts

Confirm:

- No `verify-pod-*` pod data remains.
- No `verify-graph-*` team models or graph rows remain.
- `demo-pod` still has meaningful observations, collisions, interventions, and
  outcomes.

### Public API

```bash
curl https://165-22-129-249.sslip.io/health
curl https://165-22-129-249.sslip.io/api/pods
curl https://165-22-129-249.sslip.io/api/pods/demo-pod/graph
```

Expected:

- Health is `ok`.
- `demo-pod` still exists.
- Graph has nodes, edges, metrics, loop, activity.
- Graph includes `learned_from` if accepted real outcomes remain.

### Reachability

After mirror rebuild, these should reflect the live graph, not old seed data:

```bash
curl "https://165-22-129-249.sslip.io/api/pods/demo-pod/graph/reach/engineer%3Aram"
curl "https://165-22-129-249.sslip.io/api/pods/demo-pod/graph/reach/engineer%3Ayahya"
curl "https://165-22-129-249.sslip.io/api/pods/demo-pod/graph/reach/engineer%3Akarti"
```

Expected:

- At least engineers present in the live graph should have reachable edges when
  they have outbound graph edges.

## Known Tooling Caveat

One `pnpm exec` verification attempt was blocked by supply-chain policy:

```text
prettier@3.9.0 was within the minimumReleaseAge cutoff
```

This did not indicate a MongoDB or graph failure. Direct MongoDB reads and the
existing local `backend/node_modules/.bin/tsx` binary were used instead.

Do not run broad dependency cleanup during DB cleanup unless explicitly asked.

## Recommended Cleanup Script Shape

The script should:

- Load `.env` with `dotenv`.
- Require `MONGODB_URI`.
- Print the database name.
- Refuse to run against a DB whose name is not `podman` unless `--force-db` is
  passed.
- Default to `--dry-run`.
- Require `--apply` for deletes.
- Print every collection and matched count before deleting.
- Never print `MONGODB_URI`.
- Rebuild graph mirror only after delete phase succeeds.
- Print before/after counts.

Suggested flags:

```text
--dry-run
--apply
--skip-mirror-rebuild
--keep-pod demo-pod
--force-db
```

## Do Not Do

- Do not run `seedGraph("demo-pod")` as the fix; that writes the demo graph.
- Do not delete all `outcomes`; accepted and dismissed outcomes are learning
  signals.
- Do not delete all `team_model`; preserve or rebuild the `demo-pod` document.
- Do not print secrets or raw terminal/screenshot content.
- Do not rely on vector collections for the current demo; they are absent.
- Do not treat seeded graph mirror data as proof of current live learning.

## Suggested Next Codex Prompt

Use this prompt for the implementation pass:

```text
Create a safe MongoDB cleanup script for PodMan.

Read docs/handoff/README.md, docs/mongodb.md, docs/graph.md,
docs/continual-learning/spec.md, backend/src/graph/live.ts,
backend/src/graph/store.ts, backend/src/memory/store.ts,
backend/src/memory/policy.ts, backend/src/memory/vectors.ts, and
backend/src/agent/podman.ts before coding.

Implement scripts/db-cleanup.mjs with --dry-run default and --apply required for
deletes. Keep demo-pod, remove verify/orphan pod data, remove obvious demo-pod
verification artifacts, and rebuild graph_nodes/graph_edges/team_model.graph for
demo-pod from materializePodGraph, not createDemoPodGraph. Do not print secrets.
Run dry-run first and show counts before applying.

Do not implement broad agent-learning infrastructure in this task. The real
shipped RSI loop today is recallSimilar -> shouldIntervene/preferredAction ->
outcome -> future recall. Preserve accepted real outcome chains so learned_from
continues to render.
```
