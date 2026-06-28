# PodMan — A Pair Programmer for Engineering Teams

[LiveKit](https://livekit.io/)
[MongoDB](https://www.mongodb.com/)
[Gemini](https://ai.google.dev/)
[DigitalOcean](https://www.digitalocean.com/)

## The bottleneck moved

Models keep getting better, and more people can build software than ever before.
Writing the code is no longer the hard part — engineering ability is not the
ceiling anymore.

What slows teams down now is everything *around* the code: manually checking each
other's work, re-planning when two people drift into the same change, and
constantly asking "what are you working on?" just to stay in sync. People
naturally want to build together — so as more people start coding, there will be
thousands of teams bottlenecked not by skill, but by the **speed of human
coordination.**

**PodMan is a pair programmer for the whole team.** It watches what every member
is doing in real time, learns your team's decisions and working dynamics, and
gives everyone a live picture of where the others are — without anyone having to
stop and ask.

### The five-minute meeting that isn't

<img width="800" height="705" alt="image" src="https://github.com/user-attachments/assets/4d26bd7a-177b-4650-8c99-bc2ef551d6bb" />


> **What people assume:** "Quick question, five minutes."
> **What actually happens:** the interrupted developer loses their place and needs
> 15–25 minutes to climb back into deep focus. That five-minute ask quietly costs
> half an hour — for *two* people.

Multiply that by every teammate, every day, and coordination overhead — not
engineering skill — becomes the real ceiling on how fast a team ships.

PodMan removes the reason to interrupt. Because it already knows who is touching
which file, what's still unpushed, and what each person is in the middle of, any
teammate can see another's status instantly — no tap on the shoulder, no standup,
no recovery tax. And it gets better as it goes: every accept or dismiss teaches
it what your team actually cares about, so it nudges less and helps more over
time.

> GitHub sees pushed work. PodMan sees work while it is still happening — and
> remembers what helped.

---



## How it learns

The learning loop is the product, not a side feature. It runs with almost no
extra work from anyone — the only human signal is a single accept/dismiss tap on
a card.

```
observe → detect → RECALL prior outcomes → policy gate → act → record outcome
  └──────────────────────────── feeds next recall ───────────────────────────┘
```


| Stage                     | What happens                                                                                                            | Code                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Observe**               | Gemini Vision turns each screen frame into structured work context (file, symbol, activity, unpushed hints)             | `backend/src/vision/gemini.ts`      |
| **Detect**                | Same file touched by 2+ engineers with unpushed work → a coordination event                                             | `backend/src/collision/detector.ts` |
| **Recall (memory)**       | Embed the event, query MongoDB Atlas `$vectorSearch` for similar past events, attach their prior intervention + outcome | `backend/src/memory/vectors.ts`     |
| **Policy gate (adapt)**   | A dismissed false alarm stays silent; a confirmed real catch escalates to critical; a per-pod cooldown prevents nagging | `backend/src/memory/policy.ts`      |
| **Act (least intrusive)** | Reuse the action kind that was accepted before; default to a card, escalate to a Hermes message, voice only when urgent | `backend/src/action/hermes.ts`      |
| **Record (feedback)**     | Accept/dismiss + "was it real?" is written back to memory, closing the loop for next time                               | `backend/src/memory/store.ts`       |


A few things make this real learning rather than a static prompt:

- It adapts from real teammate behavior during a real session, not an offline
dataset.
- It gets more useful as the `outcomes` collection grows — better recall, fewer
false alarms.
- It needs one tap. No labeling, no config, no retraining.
- The mechanism is memory: Atlas vector recall plus an outcome-conditioned
policy, with an exact-signature fallback when vector search isn't available.

In practice: a false alarm gets dismissed once, and the same pattern stays quiet
next time. A real conflict gets accepted once, and when it recurs PodMan recalls
it and escalates straight to a spoken "seen before" cue.

---



## Architecture

A browser PWA, an HTTP API service, LiveKit agent workers, and a
memory/action layer. The screen signal flows through LiveKit, never a manual
screenshot upload.

### Infrastructure: LiveKit · Hermes · MongoDB · DigitalOcean

How the real-time, action, memory, and hosting layers wire together. Everything
under the droplet boundary is one systemd-supervised DigitalOcean box; LiveKit
and Mongo Atlas are managed clouds it talks to.

```mermaid
flowchart LR
  Dev["Engineer browser<br/>React PWA + screen share"]

  subgraph DO["DigitalOcean droplet — systemd-supervised"]
    Caddy["Caddy<br/>serves static frontend · proxies /api"]
    API["API service<br/>/api/token · /api/pods · /api/outcome"]
    Agent["Vision agent worker<br/>@livekit/rtc-node"]
    Detector["Coordination detector<br/>collisions + blockers"]
    Hermes["Hermes action layer<br/>cards · messages · urgent voice"]
    PyAgent["Live conversation agent<br/>LiveKit Agents (Python)"]
  end

  subgraph LK["LiveKit room — managed cloud"]
    Tracks["Screen-share video tracks"]
    DataCh["Data topic<br/>podman.intervention"]
    AudioCh["Audio tracks<br/>TTS + Lyria music"]
  end

  Mongo[("MongoDB Atlas<br/>observations · collisions<br/>interventions · outcomes · vectors")]

  Dev -->|static assets| Caddy
  Dev -->|"POST /api/*"| Caddy --> API
  API -->|LiveKit JWT| Dev
  Dev -->|publish screen| Tracks

  Agent -->|subscribe frames| Tracks
  Agent --> Detector --> Hermes
  Hermes -->|cards / messages| DataCh
  Hermes -->|urgent voice| AudioCh
  PyAgent <-->|join room · speak| AudioCh
  DataCh --> Dev
  AudioCh --> Dev
  Dev -->|"POST /api/outcome"| Caddy

  API <--> Mongo
  Agent -->|write observations| Mongo
  Detector -->|read recall · write collisions| Mongo
  Hermes -->|write interventions| Mongo
  PyAgent -->|tool reads| Mongo
```

> Mongo connectivity is **required at boot** — the API and both agents ping Atlas
> on startup and exit loudly rather than degrade silently.

### Gemini: roles, models, and triggers

Five distinct Gemini surfaces, each fired by a specific event in the pod and
mapped to the file that calls it.

```mermaid
flowchart LR
  subgraph Triggers["Trigger (event in the pod)"]
    Frame["Sampled IDE frame<br/>from LiveKit screen track"]
    NewEvent["New observation<br/>or collision"]
    Talk["Engineer speaks<br/>in the room"]
    Urgent["Hermes raises an<br/>urgent intervention"]
    Session["Pod session<br/>active"]
  end

  subgraph G["Gemini surface · model · code"]
    Vision["Vision<br/>gemini-2.0-flash<br/>backend/src/vision/gemini.ts"]
    Embed["Embeddings<br/>gemini-embedding-001<br/>backend/src/memory/vectors.ts"]
    Live["Live voice agent<br/>gemini-3.1-flash-live-preview<br/>agents/podman-live-conversation/agent.py"]
    TTS["Urgent TTS<br/>gemini-3.1-flash-tts-preview<br/>backend/src/voice/live.ts"]
    Lyria["Background music<br/>lyria-3-clip-preview<br/>backend/src/voice/music.ts"]
  end

  subgraph Out["Output"]
    Ctx["Structured work context<br/>{file, symbol, activity, mode, research}"]
    Recall["$vectorSearch recall<br/>prior intervention + outcome"]
    Answer["Spoken answer over<br/>repo / git / memory tools"]
    Voice["Spoken alert<br/>in the room"]
    Score["Per-pod ambient<br/>score"]
  end

  Frame --> Vision --> Ctx
  NewEvent --> Embed --> Recall
  Talk --> Live --> Answer
  Urgent --> TTS --> Voice
  Session --> Lyria --> Score
```





### Runtime shape


| Layer                   | Runtime                                   | Responsibility                                                                          |
| ----------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Frontend PWA            | React + Vite                              | Join pods, publish screen share, render interventions, play audio                       |
| Backend API             | Express                                   | Mint LiveKit tokens, manage pods, record outcomes, expose memory stats, create sync PRs |
| Vision agent            | `@livekit/rtc-node`                       | Subscribe to screen-share tracks, sample frames, publish intervention data              |
| Live conversation agent | LiveKit Agents (Python) + Gemini Live API | Real-time voice Q&A with function tools over repo, git, and memory                      |
| Perception              | Gemini Vision (`gemini-2.0-flash`)        | Sampled IDE frames → structured work context                                            |
| Team memory             | MongoDB Atlas                             | Observations, collisions, interventions, outcomes, vector embeddings                    |
| Git watcher             | Node script                               | Report each laptop's dirty/unpushed state as ground truth                               |
| Action layer            | Hermes                                    | Cards, teammate messages, Gemini TTS urgent voice, Lyria background score               |
| Deployment              | DigitalOcean                              | Static frontend, API service, agent workers                                             |




### Data flow

```mermaid
sequenceDiagram
  autonumber
  participant Dev as Engineer PWA
  participant API as Backend API
  participant LK as LiveKit Room
  participant Agent as PodMan Agent
  participant Gemini as Gemini Vision
  participant Mongo as MongoDB Memory
  participant Hermes as Hermes / Action Layer

  Dev->>API: POST /api/token
  API-->>Dev: LiveKit URL + JWT
  Dev->>LK: Join pod room + publish screen share
  Agent->>LK: Subscribe to screen-share video
  Agent->>Gemini: Sampled JPEG frame
  Gemini-->>Agent: Structured work context
  Agent->>Mongo: Record observation
  Agent->>Mongo: Recall prior patterns (vector search)
  Mongo-->>Agent: Prior intervention + outcome
  Agent->>Hermes: Create intervention (gated by policy)
  Hermes->>LK: Publish card / message / Gemini TTS voice
  LK-->>Dev: Render intervention
  Dev->>API: POST /api/outcome (accept / dismiss)
  API->>Mongo: Store learning signal
```



---



## Built with

Everything below maps to code in this repo.

**Gemini** does the perception, the voice, and the memory:


| Use                                                                         | Model                           | Where                                      |
| --------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------ |
| Real-time voice agent (talk to PodMan, answered with repo/git/memory tools) | `gemini-3.1-flash-live-preview` | `agents/podman-live-conversation/agent.py` |
| Spoken urgent alerts over LiveKit                                           | `gemini-3.1-flash-tts-preview`  | `backend/src/voice/live.ts`                |
| Screen understanding → structured work context                              | `gemini-2.0-flash`              | `backend/src/vision/gemini.ts`             |
| Per-pod background music (Interactions API)                                 | `lyria-3-clip-preview`          | `backend/src/voice/music.ts`               |
| Embeddings for memory recall                                                | `gemini-embedding-001`          | `backend/src/memory/vectors.ts`            |


**LiveKit** is the real-time layer: screen-share tracks are the input, a typed
data channel (`podman.intervention`) carries cards and messages, audio tracks
carry the spoken alerts and music, and a Python LiveKit Agents worker runs the
live conversation agent in the room.

**MongoDB Atlas** is the memory: `$vectorSearch` recalls similar past events
(exact-signature fallback when needed), and the `outcomes` collection drives the
policy that decides whether and how to act.

**DigitalOcean** hosts it: a static frontend, the API service, and the agent
workers, supervised by systemd. Mongo connectivity is required at boot — services
fail loudly rather than degrade silently.

---



## How it works

1. Engineers open the PWA and join a pod room.
2. The API mints a LiveKit token via `POST /api/token`.
3. The PWA publishes screen share into the room on "Share my screen".
4. The PodMan vision agent subscribes to the screen-share tracks.
5. The agent samples frames, sends them to Gemini Vision, records structured
  observations in MongoDB.
6. Each engineer runs the git watcher so PodMan has deterministic
  dirty/unpushed truth.
7. The detector fuses live screen context, git truth, GitHub state, and recalled
  memory.
8. The policy gate decides whether and how to act — card, Hermes message, or
  urgent voice — reusing what worked before.
9. Urgent escalations are spoken via Gemini TTS over a LiveKit audio track.
10. The teammate's accept/dismiss is saved as an outcome, closing the
  continual-learning loop.

Separately, any teammate can start a **live voice conversation** with PodMan
(Gemini Live API) to ask about current work, git state, or where something lives
in the repo — answered with real tool calls, not guesses.

---



## Public interfaces


| Interface                                                   | Purpose                                           |
| ----------------------------------------------------------- | ------------------------------------------------- |
| `GET /health`                                               | API health check                                  |
| `POST /api/token`                                           | Mint LiveKit room tokens                          |
| `POST /api/sync-pr`                                         | Create a visible sync PR artifact                 |
| `POST /api/outcome`                                         | Store accepted/dismissed intervention outcomes    |
| `GET /api/memory/stats`                                     | Memory collection counts (live learning evidence) |
| `GET/POST/PATCH/DELETE /api/pods`                           | Pod CRUD                                          |
| `POST/DELETE /api/pods/:id/members`                         | Pod membership                                    |
| LiveKit topic `podman.intervention`                         | Intervention data channel                         |
| Wire messages `COLLISION`, `ACK`, `GIT_REPORT`, `VOICE_CUE` | Agent/PWA contract                                |


---



## Monorepo layout


| Folder      | What                                                                       |
| ----------- | -------------------------------------------------------------------------- |
| `frontend/` | React + Vite PWA — pods, LiveKit room UI, screen share, intervention cards |
| `backend/`  | Express API plus the LiveKit vision agent worker                           |
| `agents/`   | Python LiveKit Agents worker for the Gemini Live conversation agent        |
| `shared/`   | Shared TypeScript types and LiveKit data message contracts                 |
| `database/` | MongoDB setup and seed utilities                                           |
| `infra/`    | DigitalOcean specs, Caddyfile, systemd units                               |
| `scripts/`  | Local git watcher + deploy/verify tooling                                  |
| `docs/`     | Integration specs and the demo script                                      |


---



## Quick start

```bash
cp .env.example .env
# fill in LIVEKIT_*, GEMINI_*, GITHUB_*, MONGODB_URI

pnpm install
pnpm --filter @podman/backend dev       # API on :8787
pnpm --filter @podman/backend dev:agent # PodMan LiveKit vision agent
pnpm --filter @podman/frontend dev      # PWA on :5173
```

The live conversation agent (Gemini Live API) runs from `agents/podman-live-conversation/`.

---



## Git watcher — run on every demo laptop

Each engineer runs this before the demo. It polls the local git working tree
every 15 seconds and writes git state to MongoDB so PodMan has deterministic
dirty/unpushed truth that vision alone cannot reliably infer.

```bash
# from the repo root
node scripts/podman-agent.mjs --name <yourname> --pod <podId>
```

**Demo setup:**

```bash
node scripts/podman-agent.mjs --name alice --pod demo-pod
node scripts/podman-agent.mjs --name bob   --pod demo-pod
node scripts/podman-agent.mjs --name carol --pod demo-pod
```

**Requirements:** `MONGODB_URI` exported (or in `backend/.env`), `pnpm install`
run first, launched from the repo root.
