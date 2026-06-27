# PodMan — Implementation Plan (12 hours)

> Architecture locked. See `docs/idea.md` for concept, integration specs for details.
> Tasks ordered by dependency and demo criticality. Never cut items above the cut line.

---

## What we are building

Engineers join a LiveKit room with earbuds. Each engineer's browser PWA captures their screen every 30s and POSTs it to **Hermes** (server-side orchestrator on DigitalOcean). Hermes calls Gemini Vision to extract structured context per engineer, detects coordination events, generates a spoken nudge, and publishes it into the LiveKit room via Gemini Live 2.5. MongoDB Atlas stores state and an ownership map that persists across sessions.

**Demo:** Alice builds auth endpoint. Carol is blocked. PodMan notices, warns Carol. Alice's server starts. PodMan tells Carol and Bob they're clear to integrate. No Slack. No asking.

---

## Critical path — must ship for demo

### 1. Environment + health check
**Owner:** Karti | **Est:** 1h | **Blocks:** everything

- [ ] All `.env` vars populated: `LIVEKIT_*`, `GEMINI_API_KEY`, `MONGODB_URI`
- [ ] `GET /health` returns `{ ok: true, service: 'podman-backend' }` *(already implemented)*
- [ ] MongoDB connection established in `backend/src/db.ts` — export `db` instance
- [ ] `POST /ingest` stub returns `{ ok: true }` (no logic yet — unblocks parallel work)

**Files:** `backend/src/db.ts` (new), `backend/src/index.ts` (add `/ingest` stub)

---

### 2. PWA frame capture
**Owner:** Shakthi | **Est:** 1.5h | **Depends on:** task 1 stub

- [ ] After joining pod, start capture loop: `setInterval` every 30s
- [ ] `getDisplayMedia` already running — grab frame from existing screen track via `ImageBitmap` → `OffscreenCanvas` → `toBlob('image/jpeg', 0.7)`
- [ ] Downscale to max 1280×720 before encoding
- [ ] `POST /ingest` with `{ engineerId, podId, screenshotBase64, capturedAt }`
- [ ] Stop loop on disconnect

**Files:** `frontend/src/lib/capture.ts` (new), `frontend/src/lib/pod.ts` (start capture after connect)

---

### 2b. Local git watcher script
**Owner:** Ramis | **Est:** 1.5h | **Depends on:** task 1, task 3 (schema)

A tiny Node.js script each engineer runs once in a terminal on their machine. Writes git signals **directly to MongoDB Atlas** every 15s — no HTTP to Hermes. Hermes reads merged state (vision + git) from Atlas when running event detection.

- [ ] `scripts/podman-agent.mjs` — CLI script, no extra dependencies beyond Node.js + `mongodb` driver
- [ ] Args: `--name alice --pod demo-pod` (reads `MONGODB_URI` from env or `.env` in repo root)
- [ ] Every 15s: shell out to `git status --short`, `git diff --stat HEAD`, `git log --oneline -1`, `git branch --show-current`
- [ ] Upsert into `engineer_states` (same collection as vision pipeline) — update only git fields, leave vision fields untouched:
  ```ts
  { $set: { changedFiles, diffStat, recentCommit, branch, gitUpdatedAt } }
  ```
- [ ] On startup: log `[podman-agent] alice connected to demo-pod — watching git every 15s`
- [ ] Graceful exit on Ctrl+C

**Usage:**
```bash
node scripts/podman-agent.mjs --name alice --pod demo-pod
```

**Why MongoDB-direct (not POST /ingest):** git signals and vision signals update at different rates and from different sources. MongoDB is the shared state bus — Hermes reads merged state, not two separate streams.

**Files:** `scripts/podman-agent.mjs` (new)

---

### 3. MongoDB state layer
**Owner:** Karti | **Est:** 1.5h | **Depends on:** task 1

- [ ] `engineer_states` upsert: `db.collection('engineer_states').updateOne({ _id: engineerId }, { $set: ctx }, { upsert: true })`
- [ ] `ownership_map` upsert: called after each state write where `currentFile` is non-null
- [ ] `events` insert function
- [ ] `nudges` insert function + cooldown query (find any nudge for same `podId` in last `NUDGE_COOLDOWN_MS`)
- [ ] Load `ownership_map` on Hermes startup → build `Map<file, { primaryOwner, contributors }>`

**Files:** `backend/src/db/states.ts`, `backend/src/db/ownership.ts`, `backend/src/db/events.ts`, `backend/src/db/nudges.ts` (all new)

---

### 4. Gemini Vision pipeline
**Owner:** Ramis | **Est:** 2h | **Depends on:** tasks 1, 3

Wire `POST /ingest` fully:

- [ ] Receive `{ engineerId, podId, screenshotBase64, capturedAt }`
- [ ] Call `gemini-2.0-flash` with vision prompt (see `docs/gemini.md`) — inline image as base64
- [ ] Parse JSON response into `EngineerContext`
- [ ] Apply confidence gate: if `confidence < 0.6` → log and return early, no DB write
- [ ] On pass: call state upsert (task 3) → upsert `engineer_states` + `ownership_map`
- [ ] Trigger event detection (task 5) after every successful write

**Files:** `backend/src/vision/gemini.ts` (implement — currently stubbed), `backend/src/index.ts` (wire `/ingest` fully)

---

### 5. Event detector + nudge generator
**Owner:** Yahya | **Est:** 2h | **Depends on:** tasks 3, 4

- [ ] After each state write, fetch all `engineer_states` for the pod (only docs updated in last 2 min — stale engineers ignored)
- [ ] Call `gemini-2.0-flash` with event detection prompt (see `docs/gemini.md`) — pass all states + ownership map as JSON
- [ ] Parse `{ event, involvedEngineers, file, reason }` — if `event` is null, stop
- [ ] Check cooldown: query `nudges` for any sent in last `NUDGE_COOLDOWN_MS` for this pod — if found, skip
- [ ] Call `gemini-2.0-flash` with nudge generation prompt → get 1–2 sentence message
- [ ] Write event to `events` collection
- [ ] Pass message to voice publisher (task 6)
- [ ] Write nudge to `nudges` collection after sent
- [ ] Also publish data channel message for frontend card

**Files:** `backend/src/event/detector.ts` (new), `backend/src/intervention/engine.ts` (implement — currently stubbed)

---

### 6. Gemini Live 2.5 voice via LiveKit Agents
**Owner:** Everyone | **Est:** 2h | **Depends on:** tasks 1, 5

Highest integration risk — do as a team.

- [ ] Add LiveKit Agents SDK to backend (`@livekit/agents` or `livekit-server-sdk` agent support — confirm package)
- [ ] Hermes joins each active pod room as `podman-hermes` on first `/ingest` for that pod
- [ ] Wire Gemini Live 2.5 as voice provider (confirm model ID: `gemini-live-2.5-flash`)
- [ ] On nudge ready: pass text to Gemini Live → stream audio into room
- [ ] Also call `room.localParticipant.publishData(nudgePayload, { reliable: true })` for frontend card
- [ ] Fallback if Gemini Live fails: `@google/genai` TTS → WAV buffer → publish as audio track manually

**Files:** `backend/src/livekit/agent.ts` (new), `backend/src/intervention/engine.ts` (wire voice out)

---

### 7. PWA active session UI
**Owner:** Shakthi | **Est:** 1.5h | **Depends on:** tasks 2, 6

- [ ] Active session screen (post-join — replace current "Connected" placeholder)
- [ ] Teammate status cards: name, inferred file, inferred task — polled from backend via `GET /pods/:podId/state` or updated via data channel
- [ ] Data channel listener: on `RoomEvent.DataReceived` from `podman-hermes` → parse nudge → append to feed
- [ ] Nudge feed: last 5 nudges, timestamped, engineer names highlighted
- [ ] "PodMan is watching" indicator + frame capture active badge

**Files:** `frontend/src/components/SessionView.tsx` (new), `frontend/src/App.tsx` (render SessionView post-join)

---

## Cut line — below here only if hours 1–7 done before hour 10

### 8. Ownership warm-start demo
**Owner:** Karti | **Est:** 1h | **Depends on:** task 3

- [ ] On Hermes startup: log "Loading session memory for pod X — N files known"
- [ ] Ownership cache pre-populated before first frame arrives
- [ ] Demo: session 1 cold (3 min), session 2 warm (< 30s) — visible in logs + timing

---

### 9. `DUPLICATE_WORK` event type
**Owner:** Yahya | **Est:** 0.5h | **Depends on:** task 5

- [ ] Add to event detection prompt — already supported, just needs testing + nudge template

---

### 10. Backend state endpoint
**Owner:** Karti | **Est:** 0.5h | **Depends on:** task 3

- [ ] `GET /pods/:podId/state` → returns all `engineer_states` for the pod
- [ ] Used by PWA to populate teammate status cards (alternative to data channel push)

---

## Cut immediately

- VS Code extension
- Mic transcription or voice input
- Manual task input fields on PWA
- Multilingual voice
- GitHub API integration
- Slack / Linear / Jira integrations
- Webcam tracks
- Voyage vector embeddings (plain MongoDB lookups sufficient for v1)
- Always-on raw screen surveillance (30s sampling is by design)
- Full task management features
- User auth / accounts

---

## Team assignments summary

| Person | Primary tasks | Hours |
|---|---|---|
| **Karti** | 1 (env + health), 3 (MongoDB layer), 10 (state endpoint) | ~3–4h |
| **Ramis** | 4 (Gemini Vision pipeline), part of 2 (capture help) | ~3h |
| **Yahya** | 5 (event detector + nudge generator), 9 (duplicate work) | ~3h |
| **Shakthi** | 2 (PWA frame capture), 7 (active session UI) | ~3h |
| **Everyone** | 6 (Gemini Live + LiveKit Agents voice) | ~2h |

---

## Risk table

| Risk | Mitigation |
|---|---|
| Gemini Vision accuracy on screens | Large font (18pt+), single editor window, file tab fully visible. Confidence gate drops bad frames. |
| Gemini Live 2.5 + LiveKit Agents unknown territory | Build together (task 6). Fallback: Gemini TTS → WAV → publish manually as audio track. |
| Frame POST latency | JPEG quality 0.7, max 1280×720. Target < 500ms round trip. |
| Event detection false positives | 3-min cooldown per pod. Demo is pre-staged so events fire cleanly. |
| DO deploy fails on stage | Run Hermes local. PWA defaults to `localhost:8787` automatically. |
| Multiple events fire at once | Cooldown + event deduplication: same file + same engineers within 1 min → skip |

---

## Demo script (3 min)

**(0:00)** Three laptops visible. Alice, Bob, Carol join `demo-pod` via PWA. PodMan: *"PodMan online. I see Alice, Bob, and Carol. Let's build."*

**(0:20)** Alice opens `auth/middleware.ts` (18pt font, clearly visible). First frame processed. Ownership map: Alice → auth.

**(0:45)** Bob opens `frontend/login.tsx`. Carol runs `curl http://localhost:3001/auth` → `connection refused`.

**(1:20) MONEY MOMENT 1 — BLOCKER_DETECTED:**
PodMan: *"Carol, looks like you're waiting on the auth endpoint. Alice is actively building it in middleware.ts — hang tight."*

**(1:50)** Alice starts her server. Terminal shows `Server running on :3001`.

**(2:00) MONEY MOMENT 2 — DEPENDENCY_READY:**
PodMan: *"Carol, Bob — Alice just got the auth endpoint running. You're clear to integrate."*

**(2:20)** Optional: show session 2 — Hermes logs "Session memory loaded — 3 files known." First nudge in 28s vs 3min in session 1.

**(2:45)** Close: *"PodMan — the teammate that sees what Slack can't."*

---

## Pre-demo checklist (day of)

See `docs/demo-setup.md` for full laptop setup. Key items:

- [ ] All 3 laptops: font 18pt+, single editor window, file tab visible
- [ ] `demo-pod` created in LiveKit Cloud
- [ ] Hermes `/health` returns OK on deployed URL
- [ ] Earbuds tested — voice audible through browser
- [ ] Backup video recorded and on separate device
- [ ] Demo rehearsed 3×
