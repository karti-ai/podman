---
name: podman-design
description: Full system design for PodMan — real-time AI team coordination agent using Gemini Vision, Gemini Live 2.5, LiveKit, and MongoDB Atlas
metadata:
  type: project
---

# PodMan — System Design

Status: historical reference. Current implementation truth lives in
[`../../PLAN.md`](../../PLAN.md), [`../../mongodb.md`](../../mongodb.md),
[`../../continual-learning/`](../../continual-learning/), and
[`../../graph-discovery/`](../../graph-discovery/).

## Concept

PodMan is a real-time AI team coordination agent for software teams. Engineers join a consented LiveKit room and publish screen share when they want PodMan to observe active work. The backend agent samples the LiveKit screen track, uses Gemini Vision to extract structured context, detects coordination risks, and sends intervention cards, Hermes messages, or urgent voice cues through LiveKit. MongoDB Atlas stores observations, collisions, interventions, outcomes, latest engineer state, and the Team memory graph.

**Track:** Continual Learning — accepted and dismissed outcomes make later exact-signature recall and graph memory more useful.

---

## Architecture

```
┌──────────────── Engineer laptop (Browser PWA) ──────────────────┐
│  getDisplayMedia → LiveKit screen-share track                    │
│  Local git watcher → MongoDB engineer_states                     │
│  LiveKit room joined → receives cards, messages, voice cues      │
│  Earbuds: hears PodMan urgent voice cues                         │
└──────────────────────────────────────────────────────────────────┘
                          │ LiveKit media + data
                          ▼
┌────────────────── HERMES (DigitalOcean) ─────────────────────────┐
│  1. Subscribe to screen-share track → Gemini Vision              │
│  2. Write observations and per-user state to MongoDB             │
│  3. Fuse local git truth from engineer_states                    │
│  4. Run collision detector over active contexts                  │
│  5. If risk detected → card/message first, voice only if urgent  │
│  6. Push data and optional audio into LiveKit room               │
└──────────────────────────────────────────────────────────────────┘
                          │ read/write
                          ▼
                   MongoDB Atlas
         (engineer_states, observations,
          collisions, interventions, outcomes,
          team_model, graph_nodes, graph_edges)
```

---

## Components

### PWA (local agent)

- Joins LiveKit room via existing `joinPod` flow
- Publishes screen share through LiveKit after explicit user action
- Receives Hermes audio track through LiveKit when voice is urgent
- Listens for data channel messages → renders intervention feed
- Two screens: join screen (built), active session screen (to build)

### Hermes (orchestrator)

- Express server + LiveKit Agent on DigitalOcean
- LiveKit agent worker receives sampled screen-share frames and queues them for vision
- Vision pipeline: Gemini 2.0 Flash → `EngineerContext`
- Confidence gate: discard frames with confidence < 0.6
- State writer: write `observations`, `collisions`, `interventions`, `outcomes`, and `engineer_states`
- Event detector: Gemini text prompt over all active states
- Message generator: Gemini text → short intervention message
- Voice publisher: Gemini TTS via LiveKit audio into room for urgent escalation
- Data channel: sends structured intervention payload
- Cooldown: 3 min between voice cues per pod

### Gemini usage

- **Vision:** `gemini-2.0-flash` — screen → `{ currentFile, inferredTask, terminalVisible, recentTerminalOutput, confidence }`
- **Event detection:** `gemini-2.0-flash` — all engineer states → `{ event, involvedEngineers, file, reason }`
- **Message generation:** `gemini-2.0-flash` — risk → intervention text
- **Voice:** `gemini-3.1-flash-tts-preview` via LiveKit audio publication — text → audio

### MongoDB Atlas

- `engineer_states`: latest context per engineer
- `observations`: structured perception records
- `collisions`: detected coordination risks
- `interventions`: cards, messages, and voice cues sent or suggested
- `outcomes`: accepted and dismissed learning signals
- `team_model`: durable per-pod summary and seeded graph
- `graph_nodes` / `graph_edges`: normalized graph records for `$graphLookup`

### LiveKit

- One room per pod
- Engineers publish screen-share tracks
- PodMan joins as an agent participant, subscribes to screen share, and publishes audio + data channel messages
- Engineers receive audio automatically

---

## Event types

| Event              | Trigger                                                                    | Example intervention                                                                    |
| ------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `BLOCKER_DETECTED` | Engineer stuck (error in terminal, same file N frames) + teammate can help | "Carol, looks like you're waiting on auth. Alice is actively building it — hang tight." |
| `DEPENDENCY_READY` | Engineer A completes work that Engineer B was waiting on                   | "Carol, Bob — Alice just got the auth endpoint running. You're clear to integrate."     |
| `DUPLICATE_WORK`   | 2+ engineers on same file simultaneously                                   | "Alice and Bob — you're both in login.tsx. Coordinate before pushing."                  |

---

## Continual learning story

The `team_model` graph and accepted outcomes persist across sessions. On graph
load:

1. Materialize from live MongoDB records when real activity exists.
2. Fall back to seeded `team_model.graph`.
3. Fall back to a labeled demo graph for stage stability.
4. Exact signature recall uses accepted and dismissed outcomes before vector recall.

**Demo:** The first collision writes an outcome. The second similar collision
recalls that memory and changes the graph or behavior. That is the learning
visible on stage.

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
