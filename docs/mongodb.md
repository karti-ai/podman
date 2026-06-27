# MongoDB Atlas Integration Spec

MongoDB Atlas is PodMan's shared memory. It stores live engineer state, the ownership map that enables continual learning, coordination events, and nudge history.

---

## Collections

### `engineer_states`

Latest context per engineer. Two writers, one collection — vision pipeline upserts vision fields, git watcher script upserts git fields independently. Hermes reads the merged document for event detection.

```ts
{
  _id: string,                       // engineerId (stable across sessions)
  podId: string,
  name: string,                      // display name

  // --- Vision fields (written by Hermes via POST /ingest) ---
  currentFile: string | null,        // active file inferred from screen
  inferredTask: string | null,       // what engineer appears to be doing
  terminalVisible: boolean,
  recentTerminalOutput: string | null,
  confidence: number,                // Gemini Vision confidence (0–1)
  visionUpdatedAt: Date,

  // --- Git fields (written directly by scripts/podman-agent.mjs) ---
  changedFiles: string[],            // files with uncommitted changes (git status)
  diffStat: string | null,           // e.g. "auth/middleware.ts | 24 +++++"
  recentCommit: string | null,       // most recent commit message
  branch: string | null,             // current branch name
  gitUpdatedAt: Date,

  // --- Shared ---
  updatedAt: Date                    // most recent write from either source
}
```

**Index:** `{ podId: 1, updatedAt: -1 }`

**Two writers, no conflict:** vision upsert uses `$set` on vision fields only; git upsert uses `$set` on git fields only. MongoDB upsert semantics merge them cleanly.

**Usage:** Hermes reads all documents for a given `podId` after each update to run event detection. Both vision and git context are available in the same document — `changedFiles` provides ground truth, `currentFile` provides screen context.

---

### `ownership_map`

Tracks who works on which files. Built up over the session. **Persists across sessions** — this is the continual learning artifact.

```ts
{
  _id: string,                    // `${podId}:${file}`
  podId: string,
  file: string,
  primaryOwner: string,           // engineerId with most recent activity on this file
  contributors: string[],         // all engineerIds observed on this file
  observationCount: number,       // total frames where this file was seen
  lastSeenAt: Date
}
```

**Index:** `{ podId: 1, file: 1 }` (unique)

**Upsert logic:**
- On each context update where `currentFile` is non-null:
  - Increment `observationCount`
  - Update `primaryOwner` to the engineer with the most recent `lastSeenAt` on this file
  - Add engineerId to `contributors` if not present
  - Update `lastSeenAt`

**Continual learning:** Hermes loads this collection on startup for the pod. If history exists, it pre-populates the in-memory ownership cache before the first frame arrives.

---

### `events`

Every coordination event detected by Hermes.

```ts
{
  _id: ObjectId,
  podId: string,
  type: 'DEPENDENCY_READY' | 'BLOCKER_DETECTED' | 'DUPLICATE_WORK',
  involvedEngineers: string[],
  file: string | null,
  reason: string,                 // 1-sentence explanation from Gemini
  nudgeSent: boolean,             // false if suppressed by cooldown
  detectedAt: Date
}
```

**Index:** `{ podId: 1, detectedAt: -1 }`

---

### `nudges`

Every voice nudge sent to the room.

```ts
{
  _id: ObjectId,
  podId: string,
  eventId: ObjectId,             // ref to events collection
  targetEngineers: string[],
  message: string,               // the spoken text
  sentAt: Date
}
```

**Index:** `{ podId: 1, sentAt: -1 }`

**Cooldown check:** before sending a nudge, Hermes queries this collection for any nudge in the last 3 minutes for the same `podId`. If found, suppresses the new nudge and marks the event as `nudgeSent: false`.

---

## Hermes startup sequence

```
1. Connect to Atlas using MONGODB_URI
2. Load ownership_map for this podId
3. Build in-memory cache: Map<file, { primaryOwner, contributors }>
4. Begin accepting /ingest requests
```

---

## Atlas configuration

- **Cluster tier:** M0 (free) is sufficient for hackathon scale
- **Region:** same as DigitalOcean deployment (e.g. NYC1)
- **Auth:** connection string in `MONGODB_URI` env var
- **Collections created automatically** on first write (no schema migration needed)

---

## What MongoDB does NOT store

- Raw screenshot frames (too large — frames are processed in-memory by Hermes and discarded)
- Full Gemini response objects (only extracted fields are stored)
- Session recordings
