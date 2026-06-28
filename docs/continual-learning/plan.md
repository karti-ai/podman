# Continual Learning Plan

Status: draft  
Goal: prove PodMan learns from outcomes in the hackathon demo

## Must-Have Demo Loop

1. Observe two engineers touching the same file.
2. Store the observation and git state in MongoDB.
3. Predict a collision.
4. Send a card or Hermes message.
5. Record accept or dismiss outcome.
6. Adapt `team_model`.
7. Show the learned graph edge or changed future behavior.

## Build Order

### R1: Make exact recall reliable

- Normalize file paths.
- Build stable memory signatures.
- Look up prior accepted and dismissed outcomes.
- Prefer exact recall over vector recall.

### R2: Make outcomes update memory

- Accepted real collision creates or strengthens ownership.
- Accepted real collision creates `learned_from`.
- Dismissed outcome lowers confidence or suppresses route.

### R3: Expose loop data to the graph

- Add optional loop snapshot.
- Add optional activity stream.
- Keep existing `PodGraph` fields stable.

### R4: Show the observatory

- Render observe/store/predict/outcome/adapt.
- Show recent activity.
- Make selected-node detail explain why memory changed.

### R5: Prepare a clean demo chain

- Ensure one collision -> intervention -> accepted outcome exists.
- Ensure repeated signature recalls prior memory.
- Verify graph shows learned ownership.

## Nice-to-Have

- Atlas Vector Search over memory summaries.
- Confidence scoring per ownership edge.
- Per-file memory timeline.
- Strategy promotion tied to outcomes.

## Cut

- Raw screenshot storage.
- Full autonomous training.
- Broad dashboard metrics.
- Multi-pod learning generalization.

## Acceptance Criteria

- A judge can see what changed in memory.
- The second similar event behaves differently.
- Exact MongoDB records prove the loop.
- The graph remains legible with real data.

