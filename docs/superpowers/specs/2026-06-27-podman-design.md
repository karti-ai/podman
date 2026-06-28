---
name: podman-design
description: Full system design for PodMan — real-time AI team coordination agent using Gemini Vision, Gemini Live 2.5, LiveKit, and MongoDB Atlas
metadata:
  type: project
---

# PodMan — System Design

## Concept

PodMan is a real-time AI team coordination agent for software teams. Engineers join a LiveKit room with earbuds. Each engineer's browser PWA captures their screen every 30s and sends it to Hermes (server-side orchestrator on DigitalOcean). Hermes uses Gemini Vision to extract structured context per engineer, detects coordination events, and speaks proactive nudges into the room via Gemini Live 2.5 through LiveKit. MongoDB Atlas stores team state and an ownership map that persists across sessions.

**Track:** Continual Learning — the ownership map makes PodMan faster and smarter each session with no user configuration.

---

## Architecture

```
┌──────────────── Engineer laptop (Browser PWA) ──────────────────┐
│  getDisplayMedia → frame every 30s                               │
│  HTTP POST /ingest → { screenshot, engineerId, podId }           │
│  LiveKit room joined → receives voice audio from Hermes          │
│  Earbuds: hears PodMan proactive nudges                          │
└──────────────────────────────────────────────────────────────────┘
                          │ POST /ingest
                          ▼
┌────────────────── HERMES (DigitalOcean) ─────────────────────────┐
│  1. Receive frame → Gemini Vision → EngineerContext              │
│  2. Write context to MongoDB (per-user state)                    │
│  3. Update ownership map (file → engineer)                       │
│  4. Run event detector over all active contexts                  │
│  5. If event detected → Gemini generates voice message           │
│  6. Push audio into LiveKit room via Gemini Live 2.5             │
└──────────────────────────────────────────────────────────────────┘
                          │ read/write
                          ▼
                   MongoDB Atlas
         (engineer_states, ownership_map,
          events, nudges)
```

---

## Components

### PWA (local agent)

- Joins LiveKit room via existing `joinPod` flow
- Captures frame every 30s via `getDisplayMedia`, compresses to JPEG (1280×720, quality 0.7)
- POSTs `{ engineerId, podId, screenshotBase64, capturedAt }` to `POST /ingest`
- Receives Hermes audio track (automatic via LiveKit)
- Listens for data channel messages → renders nudge feed
- Two screens: join screen (built), active session screen (to build)

### Hermes (orchestrator)

- Express server + LiveKit Agent on DigitalOcean
- `POST /ingest`: receives frame, queues for vision
- Vision pipeline: Gemini 2.0 Flash → `EngineerContext`
- Confidence gate: discard frames with confidence < 0.6
- State writer: upsert `engineer_states` + `ownership_map` in MongoDB
- Event detector: Gemini text prompt over all active states
- Nudge generator: Gemini text → 1–2 sentence spoken message
- Voice publisher: Gemini Live 2.5 via LiveKit Agents → audio into room
- Data channel: sends structured nudge payload alongside audio
- Cooldown: 3 min between nudges per pod

### Gemini usage

- **Vision:** `gemini-2.0-flash` — screen → `{ currentFile, inferredTask, terminalVisible, recentTerminalOutput, confidence }`
- **Event detection:** `gemini-2.0-flash` — all engineer states → `{ event, involvedEngineers, file, reason }`
- **Nudge generation:** `gemini-2.0-flash` — event → spoken message text
- **Voice:** `gemini-live-2.5-flash` via LiveKit Agents — text → streaming audio

### MongoDB Atlas (4 collections)

- `engineer_states`: latest context per engineer, upserted each ingest
- `ownership_map`: file → primaryOwner + contributors, persists across sessions (continual learning)
- `events`: all detected coordination events
- `nudges`: all voice nudges sent + cooldown history

### LiveKit

- One room per pod
- Engineers publish screen track (used client-side for capture — Hermes does not subscribe)
- Hermes joins as `podman-hermes`, publishes audio + data channel messages
- Engineers receive audio automatically

---

## Event types

| Event              | Trigger                                                                    | Example nudge                                                                           |
| ------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `BLOCKER_DETECTED` | Engineer stuck (error in terminal, same file N frames) + teammate can help | "Carol, looks like you're waiting on auth. Alice is actively building it — hang tight." |
| `DEPENDENCY_READY` | Engineer A completes work that Engineer B was waiting on                   | "Carol, Bob — Alice just got the auth endpoint running. You're clear to integrate."     |
| `DUPLICATE_WORK`   | 2+ engineers on same file simultaneously                                   | "Alice and Bob — you're both in login.tsx. Coordinate before pushing."                  |

---

## Continual learning story

The `ownership_map` collection persists across sessions. On Hermes startup:

1. Load ownership map for this pod from Atlas
2. Build in-memory cache: `Map<file, { primaryOwner, contributors }>`
3. Event detection uses priors immediately — no ramp-up phase

**Demo:** Session 1 takes 3 min to first nudge. Session 2 fires in < 30 seconds. That is the learning, visible on stage.

---

## Demo flow (3 min)

1. **(0:00)** Three engineers join pod. PodMan greets by voice.
2. **(0:20)** Alice opens `auth/middleware.ts`. Hermes infers ownership.
3. **(0:45)** Bob opens `frontend/login.tsx`. Carol's terminal shows connection refused.
4. **(1:20) BLOCKER_DETECTED:** "Carol, looks like you're waiting on auth. Alice is actively building it — hang tight."
5. **(2:00) DEPENDENCY_READY:** "Carol, Bob — Alice just got the auth endpoint running. You're clear to integrate."
6. **(2:20)** Optional: session 2 warm-start comparison.
7. **(2:45)** Close: "PodMan — the teammate that sees what Slack can't."

---

## Key risks

| Risk                                         | Mitigation                                        |
| -------------------------------------------- | ------------------------------------------------- |
| Gemini Vision accuracy                       | Large font, single editor window, confidence gate |
| Gemini Live 2.5 + LiveKit Agents integration | Build together hour 5–7, have TTS fallback        |
| Frame POST latency                           | JPEG compression, target < 500ms                  |
| Event false positives                        | 3-min cooldown, pre-staged demo                   |
| DO deploy failure                            | Hermes runs local, PWA defaults to localhost:8787 |
