# database

Persistent memory for PodMan: **MongoDB Atlas** stores live engineer state, the ownership map (continual learning), coordination events, and nudge history.

This is what makes PodMan "more useful the more you use it" — the ownership map persists across sessions, so PodMan already knows who owns what when the team comes back.

## Collections

| Collection        | Holds                                                                             | Notes                                                      |
| ----------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `engineer_states` | Latest `EngineerContext` per engineer                                             | Upserted on every `/ingest` call                           |
| `ownership_map`   | File → primary owner + contributors                                               | Persists across sessions — the continual learning artifact |
| `events`          | Detected coordination events (DEPENDENCY_READY, BLOCKER_DETECTED, DUPLICATE_WORK) | Append-only                                                |
| `nudges`          | Every voice nudge sent to the room                                                | Used for cooldown checks (3 min between nudges)            |

Full schemas with indexes in [`docs/mongodb.md`](../docs/mongodb.md).

## Continual learning loop

1. **Observe** — engineer POSTs frame → Hermes calls Gemini Vision → `EngineerContext`
2. **Store** — upsert `engineer_states`, upsert `ownership_map`
3. **Detect** — Hermes runs event detection over all active states
4. **Nudge** — voice nudge sent into LiveKit room, written to `nudges`
5. **Improve** — next session: Hermes loads `ownership_map` on startup, skips cold-start inference

## Setup

Create a free Atlas M0 cluster, then set `MONGODB_URI` in `.env`.

Collections are created automatically on first write — no migration needed.

```bash
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/podman
```
