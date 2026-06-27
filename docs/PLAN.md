# PodMan — Implementation Plan (12 hours)

> Architecture locked. See `docs/idea.md` for concept, integration specs for details.
> Tasks ordered by dependency and demo criticality. Never cut items above the cut line.

---

## What we are building

Engineers join a LiveKit room with earbuds. The PodMan agent (`backend/src/agent.ts`) subscribes to each engineer's screen-share track, samples frames at ~1fps, calls Gemini Vision, detects collisions, and publishes interventions via LiveKit data channel + voice. MongoDB Atlas stores observations, collisions, interventions, and outcomes — persisting across sessions for continual learning.

**Actual architecture (differs from original spec):** Screen frames flow through the LiveKit room (agent subscribes to screen tracks), not via HTTP POST /ingest from the PWA. The agent runs as a separate process (`pnpm dev:agent`). The HTTP server handles token minting, pods CRUD, memory stats, and outcome recording.

**Demo:** Alice builds auth endpoint. Carol is blocked. PodMan notices, warns Carol. Alice's server starts. PodMan tells Carol and Bob they're clear to integrate. No Slack. No asking.

---

## Status legend
- ✅ Done and deployed on server
- ⚠️ Partial — code exists, needs work
- ❌ Not started

---

## Critical path — must ship for demo

### 1. Environment + health check
**Status: ✅ Done**

- [x] `GET /health` returns `{ ok: true }` — live at `http://165.22.129.249:8787/health`
- [x] MongoDB connection established in `backend/src/memory/db.ts` — `collections()` export
- [x] Pods CRUD: `GET/POST /api/pods`, `GET/DELETE /api/pods/:id`, `POST/DELETE /api/pods/:id/members`
- [x] Backend running in tmux on DO droplet (`pnpm dev` via `tsx watch src/server.ts`)
- [ ] Root `.env` not present — `backend/.env` has creds, sufficient for current setup

**Actual files:** `backend/src/memory/db.ts`, `backend/src/server.ts`, `backend/src/env.ts`

---

### 2. PWA frame capture
**Status: ✅ Done (different approach than originally planned)**

Original plan: PWA captures JPEG every 30s → POST /ingest. Actual: PWA publishes screen as LiveKit video track → agent subscribes and samples at ~1fps using `livekit-client-node` + `sharp`.

- [x] `frontend/src/lib/pod.ts` — `joinPod()` connects to LiveKit, publishes screen + mic
- [x] `backend/src/agent.ts` — subscribes to `SOURCE_SCREENSHARE` tracks, throttles at `SAMPLE_INTERVAL_MS`
- [x] Resize to max 1280px wide, JPEG quality 70 via `sharp`
- [x] Dev mock-join fallback when LiveKit unconfigured
- [x] `frontend/src/livekit/useScreenPublish.ts` — React hook for screen track

**Actual files:** `backend/src/agent.ts`, `frontend/src/lib/pod.ts`, `frontend/src/livekit/useScreenPublish.ts`

---

### 2b. Local git watcher script
**Status: ❌ Not started**

- [ ] `scripts/podman-agent.mjs` — CLI script polling git every 15s, writing to MongoDB
- [ ] Args: `--name alice --pod demo-pod`
- [ ] Every 15s: `git status --short`, `git diff --stat HEAD`, `git log --oneline -1`, `git branch --show-current`
- [ ] Upsert into `observations` collection — update only git fields, leave vision fields untouched
- [ ] Graceful exit on Ctrl+C

**Usage:**
```bash
node scripts/podman-agent.mjs --name alice --pod demo-pod
```

**Files:** `scripts/podman-agent.mjs` (new)

---

### 3. MongoDB state layer
**Status: ✅ Done (different collection names than originally planned)**

- [x] `observations` — `recordObservation(ctx: EngineerContext)` 
- [x] `collisions` — `recordCollision(collision: Collision)`
- [x] `interventions` — `recordIntervention(intervention: Intervention)`
- [x] `outcomes` — `recordOutcome(outcome: InterventionOutcome)`
- [x] `memoryStats()` — count per collection, exposed via `GET /api/memory/stats`
- [x] Vector recall: `recallSimilar(collision)` in `backend/src/memory/vectors.ts`
- [x] Policy gate: `shouldIntervene(collision, prior)` in `backend/src/memory/policy.ts`

**Actual files:** `backend/src/memory/db.ts`, `backend/src/memory/store.ts`, `backend/src/memory/policy.ts`, `backend/src/memory/vectors.ts`

---

### 4. Gemini Vision pipeline
**Status: ✅ Done**

- [x] `analyzeFrame(engineerId, podId, jpeg)` calls `gemini-2.0-flash` with structured JSON schema
- [x] Extracts: `currentFile`, `currentSymbol`, `activity`, `hasUnpushedChanges`, `confidence`
- [x] Low media resolution for speed, zero thinking budget
- [x] Called from `agent.ts` → `podman.onScreenFrame()` → `analyzeFrame()` → `recordObservation()`
- [x] Collision detection runs after every frame: `detectCollisions([...contexts], github)`

**Actual files:** `backend/src/vision/gemini.ts`, `backend/src/agent/podman.ts`

---

### 5. Event detector + nudge generator
**Status: ✅ Done (collision-based, not Gemini-event-detection-based)**

- [x] `detectCollisions()` — groups engineers by normalized file path, flags when 2+ editing same file with unpushed changes
- [x] `shouldIntervene()` + `preferredAction()` policy gate (prevents spam)
- [x] `recallSimilar()` — vector recall elevates severity if prior collision on same file
- [x] Generates intervention message string (inline, not via Gemini call)
- [x] Publishes `{ type: 'COLLISION', collision, intervention }` via data channel
- [x] Calls `speak(room, message)` (currently stub — just logs)
- [ ] Cooldown per pod not yet implemented (policy gate provides some protection)

**Actual files:** `backend/src/collision/detector.ts`, `backend/src/agent/podman.ts`, `backend/src/memory/policy.ts`

---

### 6. Voice via LiveKit
**Status: ⚠️ Partial — agent structure done, voice is a stub**

- [x] `backend/src/agent.ts` — full LiveKit agent: joins room, subscribes to screen tracks, 1fps sampling
- [x] `backend/src/voice/live.ts` — `speak(room, message)` function wired into pipeline
- [x] `room.localParticipant.publishData()` — data channel publish working
- [ ] `speak()` is a stub — logs message but does NOT produce audio
- [ ] Gemini Live 2.5 audio streaming not implemented
- [ ] **Agent not started on server** — `start-podman.sh` has it commented out; needs `pnpm dev:agent` + real LiveKit creds

**To unblock:** Implement real TTS in `speak()` (Gemini TTS → WAV → publish audio track), then uncomment agent window in `start-podman.sh`.

**Actual files:** `backend/src/voice/live.ts`, `backend/src/agent.ts`, `backend/src/agent/podman.ts`

---

### 7. PWA active session UI
**Status: ❌ Not started**

- [ ] `frontend/src/components/SessionView.tsx` — active session screen post-join
- [ ] Teammate status cards (name, inferred file, inferred task)
- [ ] `RoomEvent.DataReceived` listener for collision/intervention messages from agent
- [ ] Nudge feed: last 5 interventions, timestamped
- [ ] "PodMan is watching" indicator

**Depends on:** Task 6 (agent producing data channel messages — working even without voice)

**Files:** `frontend/src/components/SessionView.tsx` (new), `frontend/src/App.tsx` (wire post-join)

---

## Cut line — below here only if tasks 1–7 done before hour 10

### 8. Ownership warm-start demo
**Status: ⚠️ Partial — memory persists, no warm-start logging**
- [ ] On agent startup: log "Loading session memory for pod X — N collisions known"
- [ ] Demo: session 1 cold, session 2 faster — visible in logs

---

### 9. GitHub-enriched collision detection
**Status: ⚠️ Exists but may not be needed for demo**
- `backend/src/github/client.ts` exists — fetches PR state as `GithubStateSnapshot`
- Not required for the demo since screen-based `hasUnpushedChanges` is sufficient

---

### 10. Backend state endpoint
**Status: ✅ Done (as pods API)**
- `GET /api/pods` — returns all pods
- `GET /api/pods/:id` — returns pod with members
- No per-engineer state endpoint yet (frontend uses data channel instead)

---

## What needs to happen next (priority order)

1. **Voice (Task 6)** — implement real `speak()` with Gemini TTS → WAV → LiveKit audio track
2. **Session UI (Task 7)** — `SessionView.tsx` with data channel listener + nudge feed
3. **Start agent on server** — uncomment agent window in `start-podman.sh`, ensure LiveKit creds in `backend/.env`
4. **Git watcher (Task 2b)** — `scripts/podman-agent.mjs` for demo terminals

---

## Server state (165.22.129.249)

- Backend: ✅ running on `:8787` (tmux `podman:backend`)
- Frontend: ✅ running on `:81` (tmux `podman:prod`, port 80 taken)
- Agent: ❌ NOT running — needs LiveKit creds + `pnpm dev:agent`
- To start agent: `tmux new-window -t podman -n agent && tmux send-keys -t podman:agent 'cd /root/podman && pnpm --filter @podman/backend dev:agent' C-m`
- To attach: `ssh root@165.22.129.249` → `tmux attach -t podman`

---

## Cut immediately

- Mic transcription or voice input from engineers
- Manual task input fields on PWA
- Multilingual voice
- Slack / Linear / Jira integrations
- Webcam tracks
- Always-on raw screen surveillance (1fps sampling is by design)
- Full task management features
- User auth / accounts

---

## Risk table

| Risk | Mitigation |
|---|---|
| Gemini Vision accuracy on screens | Large font (18pt+), single editor window, file tab fully visible. |
| Gemini Live TTS not implemented | Fallback: `@google/genai` TTS → WAV buffer → publish as audio track manually. |
| Agent needs HTTPS for screen capture | Demo from localhost or ngrok. PWA has dev mock-join fallback. |
| Event detection false positives | Policy gate in `shouldIntervene()`. Demo is pre-staged so collisions fire cleanly. |
| DO deploy: frontend on :81 not :80 | Port 80 taken — either kill the process or update DNS/proxy to :81. |
| Multiple collisions fire at once | Policy gate prevents spam; same-collision dedup via file+engineers key. |

---

## Demo script (3 min)

**(0:00)** Three laptops visible. Alice, Bob, Carol join `demo-pod` via PWA. Agent logs `[agent] PodMan joined room demo-pod`.

**(0:20)** Alice opens `auth/middleware.ts` (18pt font, clearly visible). First frame processed. `[vision] currentFile: auth/middleware.ts`.

**(0:45)** Bob opens `auth/middleware.ts` too. Carol runs `curl http://localhost:3001/auth` → `connection refused`.

**(1:20) MONEY MOMENT 1 — COLLISION_DETECTED:**
PodMan data channel message fires: *"alice and bob are both editing auth/middleware.ts and one has unpushed changes."*
Voice says it aloud in the room.

**(1:50)** Alice pushes. Bob pulls. Carol's integration unblocks.

**(2:20)** Show `GET /api/memory/stats` → `{ observations: 47, collisions: 1, interventions: 1, outcomes: 0 }`. Session 2 warm-start: collision detected in 12s vs 3min cold.

**(2:45)** Close: *"PodMan — the teammate that sees what Slack can't."*

---

## Pre-demo checklist (day of)

See `docs/demo-setup.md` for full laptop setup. Key items:

- [ ] All laptops: font 18pt+, single editor window, file tab visible
- [ ] `demo-pod` created in LiveKit Cloud, creds in `backend/.env`
- [ ] Agent running: `tmux attach -t podman` → check `agent` window
- [ ] `GET /health` returns OK on deployed URL
- [ ] Earbuds tested — voice audible through browser
- [ ] Backup video recorded and on separate device
- [ ] Demo rehearsed 3×
