# Graph Discovery Plan

Status: draft  
Goal: make MongoDB graph discovery visible as a dynamic learning observatory

## Must-Have

1. Keep live materializer as source of graph truth.
2. Add optional loop and activity fields.
3. Build a dynamic graph layout.
4. Default to risk path.
5. Make selected-node detail explain the story.

## Build Order

### R1: Stabilize discovered graph

- Keep file and engineer noise filters.
- Keep collision collapse.
- Keep priority for accepted-outcome paths.
- Keep graph size capped.

### R2: Add observatory data

- Compute learning-loop snapshot.
- Compute activity stream.
- Preserve current graph contract.

### R3: Improve path selection

- Pick one primary risk path.
- Include learned path when present.
- Dim unrelated collisions and repeated interventions.

### R4: Render dynamically

- Use `d3-force` or animated layered layout.
- Make nodes draggable.
- Curve or bundle edges.
- Animate `learned_from`.

### R5: Verify with real data

- Fetch live `demo-pod` graph.
- Confirm labels do not collide badly.
- Confirm red edges do not dominate.
- Confirm activity and loop explain the graph.

## Nice-to-Have

- Reachability panel using `$graphLookup`.
- Hover path previews.
- Edge bundling by file or collision.
- Time scrubber for graph snapshots.

## Cut

- Generic analytics dashboard.
- Large graph database migration.
- Rendering every historical event.
- Static fixed-column final layout.

## Acceptance Criteria

- Risk path is obvious in 10 seconds.
- Learned path is visible when data exists.
- Whole graph mode exists but is not the default.
- The graph remains backed by MongoDB, not hardcoded mock data.

