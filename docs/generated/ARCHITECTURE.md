# PodMan — Architecture (workflow synthesis)

## Overview
PodMan is an ambient "Jarvis for engineering teams" — a Chrome PWA + Node agent that watches every pod member's shared screen in realtime, understands the work with Gemini 3.5 Flash vision, fuses that live (pre-push) signal with GitHub state, and proactively interrupts by voice + card to prevent merge collisions BEFORE anyone pushes. Track: Continual Learning — PodMan accumulates a persistent team world-model (who owns what, what's in-flight, recurring conflict hotspots) in MongoDB Atlas + Voyage vectors and refines its own intervention policy from outcomes, getting measurably better the longer it runs.

The monorepo is already scaffolded at /Users/karti/Desktop/Podman as a pnpm (v10.32) workspace, ESM, Node 22+, strict TS, with three packages (@podman/frontend, @podman/backend, @podman/shared). Shared types already exist and are good (Pod, Engineer, EngineerContext, Collision, GithubStateSnapshot, Intervention, SuggestedAction) — my design EXTENDS these rather than rewriting them. Everything below aligns with the existing tsconfig.base.json (moduleResolution: Bundler, verbatimModuleSyntax, isolatedModules — so all relative imports MUST use .js extensions and type-only imports MUST use `import type`).

THE ONE LOAD-BEARING ARCHITECTURE DECISION: the backend splits into TWO process entry points, not one. (1) backend/src/server.ts = a publicly-routable Express + ws service that mints LiveKit tokens and relays collision/intervention events to the PWA. (2) backend/src/agent.ts = an OUTBOUND LiveKit worker (no HTTP port) that joins each pod room via @livekit/rtc-node, subscribes to screen-share video tracks, grabs+throttles frames, runs Gemini vision, fuses with GitHub, detects collisions, and speaks back. This split exactly matches DigitalOcean App Platform's service-vs-worker model (research lane 4) and is THE thing that makes the DO deploy succeed instead of hanging on a health check.

The realtime vision path uses @livekit/rtc-node directly (NOT @livekit/agents) because Agents-JS integrated live-video input is Python-only as of June 2026 — this is the single biggest LiveKit gotcha and the design is built around it. gemini-3.5-flash with responseJsonSchema does per-frame screen->structured-context (throttled to ~1 fps); gemini-3.1-flash-live-preview does PodMan's voice (general voice — NOT the translate-only model); Octokit does deterministic git state + the real sync-PR creation (MCP has no compare tool); MongoDB Atlas + Voyage is the continual-learning memory + policy store.

## Realtime data flow
End-to-end, one frame's journey from an engineer's laptop to PodMan speaking:

1) CAPTURE (frontend, livekit-client). Each engineer's PWA calls createLocalScreenTracks({audio:true}) then setMicrophoneEnabled / setCameraEnabled, tagging the screen video with Track.Source.ScreenShare so the agent can distinguish it from the webcam. Tracks publish into ONE LiveKit room per pod. A consent gate + "PodMan is watching" indicator is shown before any track publishes (privacy-by-design, defuses the recording optics risk).

2) TOKEN (backend service, livekit-server-sdk). The PWA fetched a JWT from POST /api/token on server.ts; the engineer token carries canPublish+canSubscribe+canPublishData and metadata={githubLogin} for collision attribution. The agent has its own token with the same grants (it must canPublish to speak).

3) INGEST + FRAME GRAB (backend worker, @livekit/rtc-node — THE critical path). agent.ts joins the room (autoSubscribe:true). On RoomEvent.TrackSubscribed it filters pub.source===TrackSource.SOURCE_SCREENSHARE, wraps the RemoteVideoTrack in a VideoStream, async-iterates frames, THROTTLES to ~1 fps (frames arrive at up to 30fps — sending all of them blows cost/latency), converts each VideoFrame to RGBA (frame.convert(VideoBufferType.RGBA)), and encodes to downscaled JPEG with sharp (Gemini wants encoded bytes, not raw RGBA).

4) VISION -> STRUCTURED CONTEXT (gemini-3.5-flash). The JPEG goes to generateContent with responseMimeType:'application/json' + responseJsonSchema, returning a schema-valid EngineerContext-shaped object: { currentFile, currentSymbol, activity, hasUnpushedChanges, confidence }. mediaResolution 'low' (~280 tok/img) + thinkingConfig minimal keeps it cheap (~$0.05/min for 4 engineers) and fast. The per-engineer context is upserted into an in-memory map keyed by engineerId, and also persisted as an observation to MongoDB.

5) GITHUB FUSION (Octokit). In parallel, a cached GitHub poller keeps listCommits/listBranches and, on demand, compareCommitsWithBasehead (branch-vs-branch diff) and getContent (does the remote already have this file?). This is the deterministic half PodMan can trust.

6) COLLISION DETECTION (collision/detector.ts). The detector builds a map normalize(filePath) -> Set<engineerId> from live vision contexts. A collision fires when >=2 engineers point at the same file/feature AND >=1 has local-but-unpushed work — proven by EITHER Tier-1 vision (hasUnpushedChanges, or the file is absent from the remote branch per Octokit) OR an optional Tier-2 local git-reporter sidecar (git rev-list @{u}..HEAD count over the data channel). The "anyUnpushed" predicate is the crux the GitHub API alone literally cannot answer — the moat.

7) POLICY + MEMORY (continual learning). Before intervening, PodMan queries Atlas Vector Search (Voyage embedding of the collision signature) for "have we seen this pattern before?" and reads the learned policy (per-pattern confidence threshold + acceptance history). This both raises confidence ("I've seen session/webhook conflicts here, 0.93") and tunes whether/how to intervene (lead with the action the team accepted last time).

8) INTERVENTION OUT (voice + card). If policy says fire: (a) the agent composes an Intervention message and publishData(JSON, {reliable:true, topic:'podman.intervention', destination_identities:[...]}) so the PWA renders the card with the would-be diff; (b) gemini-3.1-flash-live-preview generates spoken audio that the agent publishes as a mic-source AudioTrack via AudioSource.captureFrame (engineers hear PodMan in the room). The card offers "Open sync PR" -> server calls Octokit createRef+pulls.create on the PUBLIC repo (real artifact). Optional flourish: re-render the same warning through gemini-3.5-live-translate-preview for a Spanish-speaking remote member.

9) OUTCOME ACK -> LOOP CLOSES. The engineer's accept/dismiss flows back over publishData; server.ts records {collisionId, wasRealCollision, acceptedPR} to MongoDB, which updates both the world-model and the policy weights — closing the continual-learning loop within the demo.

## Continual-learning loop
PodMan has TWO stacked learning loops so judges see "it gets smarter" twice in 3 minutes — this is the entire Continual Learning thesis made concrete and demonstrable.

LOOP A — TEAM WORLD-MODEL (knowledge accumulation, minimal supervision). Every vision observation is persisted to the `observations` collection in MongoDB Atlas: {engineerId, file, symbol, activity, hasUnpushedChanges, confidence, observedAt}. From these PodMan derives and continuously updates an `ownership` model (which engineer touches which files/dirs most -> de-facto owners) and a `conflict_hotspots` model (file-pairs that historically co-occur in collisions, e.g. auth/session.ts <-> auth/middleware.ts). Each collision signature (normalized files + symbols + involved roles) is embedded with Voyage AI (voyage-3 family) and stored in Atlas with a Vector Search index. At detection time PodMan runs $vectorSearch over past signatures: a near-neighbor hit RAISES detection confidence and lets PodMan explain WHY ("I've seen session and webhook handlers conflict in this repo"). The longer a session runs, the denser this memory, the earlier+more confident the catch — the literal "more useful the more it watches" track requirement, with no human labeling.

LOOP B — INTERVENTION POLICY (self-improvement from outcomes — the recursive-self-improvement flourish). Every intervention writes an `interventions` record; the engineer ACK (accepted / dismissed / "false alarm") flows back over the LiveKit data channel and is appended as the outcome. A lightweight policy in `memory/policy.ts` maintains, per collision-pattern cluster: (1) a confidence THRESHOLD that adapts up when interventions are dismissed (nag less) and down when they were real+accepted (catch earlier); (2) an action PREFERENCE (if the team accepted sync-PRs before, lead with that; if they prefer a ping, lead with that); (3) phrasing/verbosity. This is a simple, robust online update (running acceptance rate per cluster + threshold nudge) — deliberately NOT a fragile RL training job, so it's reliable on stage while still being a true outcome-driven self-improving policy. Optionally, the heavier "draft the merged sync patch + run tests" step runs OFF the realtime path in the Antigravity managed-agent sandbox (interactions API), kept off the latency-critical loop.

WHAT'S STORED (Atlas collections): pods, observations (TTL-indexed, high volume), collisions, interventions (with outcome), team_model (ownership + hotspots, one doc per pod, continuously upserted), memory_vectors (Voyage embeddings + Vector Search index for pattern recall), policy (per-pattern thresholds/preferences). The demo's "watch it get smarter" beat literally shows a memory_vectors doc written in beat 1 being retrieved in beat 2, plus the policy record reflecting the prior accepted PR.

## Components

### `frontend/` — React 19 + Vite 6 + TypeScript, installable PWA (vite-plugin-pwa), Tailwind, livekit-client
The engineer-facing Chrome PWA. Pod join (password/QR, mockable), consent gate + 'PodMan is watching' indicator, screen+mic+cam capture and publish via a useScreenPublish hook, receive interventions over the LiveKit data channel and render the proactive PodMan card (warning + would-be diff + 'Open sync PR' button), play PodMan's voice from its published audio track, and send accept/dismiss ACKs back. The pod grid is intentionally a small collapsed corner widget, never the hero.

Key libs: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `vite-plugin-pwa`, `livekit-client`, `@podman/shared`

### `backend/` — Node 22 + TypeScript (ESM), split into TWO entry points: an Express+ws SERVICE (token mint + collision relay + PR action) and an OUTBOUND WORKER (LiveKit room subscriber + Gemini vision + collision detector + voice out)
server.ts (service, has http_port): POST /api/token (livekit-server-sdk), ws relay to the PWA, POST /api/sync-pr (Octokit createRef+pulls.create), outcome-ACK ingestion. agent.ts (worker, no port): join each pod room via @livekit/rtc-node, subscribe to SCREENSHARE tracks, throttle+grab frames (VideoStream/VideoFrame.convert -> sharp JPEG), gemini-3.5-flash vision -> EngineerContext, fuse with cached GitHub state, run the collision detector, query memory/policy, publishData the intervention card + publish gemini-3.1-flash-live-preview voice as an audio track. Submodules: vision/gemini.ts, github/client.ts, collision/detector.ts, agent/podman.ts (orchestrator loop), memory/{store,vectors,policy}.ts, voice/live.ts.

Key libs: `@livekit/rtc-node`, `livekit-server-sdk`, `@google/genai`, `octokit`, `sharp`, `express`, `ws`, `mongodb`, `@podman/shared`, `dotenv`

### `shared/` — TypeScript types only, compiled to dist, consumed by both frontend and backend as @podman/shared
Single source of truth for cross-cutting types. ALREADY contains Pod, Engineer, EngineerContext, Collision, CollisionSeverity, GithubStateSnapshot, Intervention, InterventionKind, InterventionStatus, SuggestedAction, SuggestedActionKind. Design EXTENDS this with: data-channel wire messages (DataMessage union: COLLISION / VOICE_CUE / ACK), an InterventionOutcome record, a TeamModel (ownership + hotspots) shape, and a LocalGitReport (optional Tier-2 sidecar payload). Keep it dependency-free.

Key libs: `typescript`

### `database/` — MongoDB Atlas (free Sandbox) + Voyage AI embeddings + Atlas Vector Search
Persistence + the continual-learning memory layer. Collections: pods, observations (TTL), collisions, interventions (with outcome), team_model, memory_vectors (Voyage vectors + $vectorSearch index), policy. Holds an init script that creates indexes including the vector index. This is what makes the Continual Learning claim TRUE, not hand-wavy.

Key libs: `mongodb`, `voyageai (or REST)`

### `infra/` — DigitalOcean App Platform (single app spec: static_site + service + worker), doctl, optional DO Gradient inference for a secondary LLM call
.do/app.yaml deploying all three components from the GitHub repo with deploy_on_push; auto-TLS + wss; secrets wired as RUN_TIME env. The LiveKit agent is a WORKER (no http_port/route) so the deploy doesn't hang on a health check; the token/relay API is a SERVICE; the PWA is a static_site. Optional: route the collision-summary/policy LLM call through DO Gradient (https://inference.do-ai.run/v1/) to legitimately claim DO inference for the Best DigitalOcean prize while keeping load-bearing vision on Gemini.

Key libs: `doctl`, `openai (for DO Gradient, OpenAI-compatible)`

### `docs/` — Markdown
PLAN.md (north star, already present) + this v2 architecture, the 3-minute demo script, the architecture slide, and the privacy/consent note. Read first by all teammates.

## File tree
```
Podman/
├── package.json                      # pnpm workspace root (EXISTS — add no deps here)
├── pnpm-workspace.yaml               # frontend/backend/shared (EXISTS)
├── pnpm-lock.yaml                    # (EXISTS)
├── tsconfig.base.json                # strict, Bundler res, verbatimModuleSyntax (EXISTS)
├── .nvmrc / .npmrc / .editorconfig   # (EXIST)
├── eslint.config.mjs / .prettierrc   # (EXIST)
├── .env.example                      # (EXISTS — extend per env-vars section)
├── README.md                         # (EXISTS)
│
├── shared/                           # @podman/shared (types only)
│   ├── package.json  tsconfig.json   # (EXIST)
│   └── src/
│       ├── index.ts                  # barrel (EXISTS — extend exports)
│       ├── pod.ts  engineer.ts       # (EXIST)
│       ├── collision.ts intervention.ts  # (EXIST)
│       └── messages.ts               # NEW: DataMessage wire union, InterventionOutcome, TeamModel, LocalGitReport
│
├── frontend/                         # @podman/frontend (React + Vite PWA)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts                # + vite-plugin-pwa
│   ├── index.html
│   └── src/
│       ├── main.tsx                  # React entry
│       ├── App.tsx                   # join -> capture -> PodMan card host
│       ├── livekit/
│       │   ├── useRoom.ts            # connect + token fetch
│       │   ├── useScreenPublish.ts   # screen+mic+cam publish hook (STARTER)
│       │   └── useInterventions.ts   # DataReceived -> card state, voice playback
│       ├── components/
│       │   ├── ConsentGate.tsx       # opt-in + "PodMan is watching"
│       │   ├── PodGridCorner.tsx     # collapsed peripheral-vision widget (NOT hero)
│       │   └── InterventionCard.tsx  # warn + diff + Open-sync-PR (the hero)
│       └── lib/api.ts                # POST /api/token, /api/sync-pr
│
├── backend/                          # @podman/backend (Node agent + service)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── env.ts                    # typed env loader (zod-lite)
│       ├── server.ts                 # SERVICE: token + ws relay + sync-PR + ACK (STARTER)
│       ├── agent.ts                  # WORKER: room subscribe + frame grab loop (STARTER)
│       ├── agent/
│       │   └── podman.ts             # orchestrator: vision->fuse->detect->intervene (STARTER)
│       ├── vision/
│       │   └── gemini.ts             # gemini-3.5-flash frame -> EngineerContext (STARTER)
│       ├── voice/
│       │   └── live.ts              # gemini-3.1-flash-live voice -> PCM -> AudioFrame
│       ├── github/
│       │   └── client.ts             # Octokit: state + compare + create sync PR (STARTER)
│       ├── collision/
│       │   └── detector.ts           # fusion rule: same file + >=1 unpushed (STARTER)
│       └── memory/
│           ├── store.ts              # Mongo collections + writes
│           ├── vectors.ts            # Voyage embed + Atlas $vectorSearch
│           └── policy.ts             # outcome-driven threshold/preference learning
│
├── database/
│   └── init.ts                       # create collections + indexes + vector index (STARTER)
│
├── infra/
│   └── .do/app.yaml                  # DO App Platform: static_site + service + worker (STARTER)
│
├── tools/
│   └── git-reporter.mjs              # OPTIONAL Tier-2 local sidecar (git status -> agent)
│
└── docs/
    ├── PLAN.md                       # (EXISTS)
    ├── ARCHITECTURE.md               # this v2 design
    └── DEMO.md                       # 3-min script + architecture slide
```

## Env vars

- `LIVEKIT_URL` — wss URL of your LiveKit Cloud project (e.g. wss://podman-xxx.livekit.cloud). Used by both the agent (to join rooms) and returned to the PWA with each token.
- `LIVEKIT_API_KEY` — LiveKit API key for minting JWTs (server) and authing the agent worker.
- `LIVEKIT_API_SECRET` — LiveKit API secret paired with the key. Server-side only; never ship to the PWA.
- `GEMINI_API_KEY` — Google AI Studio key for @google/genai. Backend-only — must NOT be exposed in the Vite frontend. Powers vision (3.5-flash) and voice (3.1-flash-live).
- `GEMINI_VISION_MODEL` — Vision model id for per-frame screen understanding. Default gemini-3.5-flash (GA, supports responseJsonSchema).
- `GEMINI_LIVE_MODEL` — General voice model for PodMan speaking. Default gemini-3.1-flash-live-preview. NOT the translate-only gemini-3.5-live-translate-preview (reserve that for the optional Spanish flourish).
- `GITHUB_TOKEN` — Fine-grained PAT for the PUBLIC demo repo. Scopes: Contents R, Pull requests R+W, Metadata R. Used by Octokit for state, compare, and creating the real sync PR.
- `GITHUB_REPO` — Target repo as owner/name. MUST be public per hackathon rules; show its github.com URL during the demo.
- `MONGODB_URI` — MongoDB Atlas Sandbox connection string. Holds the continual-learning memory: observations, collisions, interventions+outcomes, team_model, memory_vectors, policy.
- `VOYAGE_API_KEY` — Voyage AI key for embedding collision signatures (voyage-3, 1024-dim) used by Atlas Vector Search for pattern recall. Optional but needed for the 'it got smarter' beat.
- `PORT` — Port the backend SERVICE binds (default 8787). On DO App Platform this is http_port and must bind 0.0.0.0, not localhost.
- `POD_ROOM` — Room name the agent worker joins (default demo-pod). One room per pod; for the demo a single fixed room is fine.
- `VITE_BACKEND_URL` — Frontend-only: base URL of the backend service for token/sync-pr/outcome calls. Must be VITE_ prefixed to reach the client bundle.
- `VITE_LIVEKIT_URL` — Frontend-only fallback LiveKit URL (the token response also returns url; this is for display/dev). VITE_ prefixed.
- `MODEL_ACCESS_KEY` — OPTIONAL — DigitalOcean Gradient inference key (OpenAI-compatible, https://inference.do-ai.run/v1/). Route a secondary call (collision summary / policy reasoning) through DO to legitimately claim Best DigitalOcean inference; keep load-bearing vision on Gemini.

## MVP build order

1. **0. Verify plumbing + add deps (30 min, Karti)** — Repo already scaffolds with pnpm. Add deps per package: backend (@livekit/rtc-node, livekit-server-sdk, @google/genai, octokit, sharp, express, ws, mongodb, dotenv, @types/ws); frontend (react, react-dom, vite, @vitejs/plugin-react, vite-plugin-pwa, livekit-client). Add shared/src/messages.ts and wire its exports into index.ts. Confirm `pnpm -r build` and `pnpm -r typecheck` pass with the existing strict/Bundler tsconfig (remember .js import extensions + import type).
2. **1. Token + join skeleton (1h, Karti + Zander)** — Stand up backend/src/server.ts (token endpoint + /health + ws relay) and the frontend join flow with useScreenPublish. Prove an engineer can join a LiveKit room and publish a screen track tagged Source.ScreenShare. Smoke test against LiveKit Cloud locally over https/localhost (getDisplayMedia needs secure context).
3. **2. THE CRITICAL PATH — frame grab (2-3h, Ramis) — DE-RISK FIRST** — Build agent.ts: join the room with @livekit/rtc-node, filter SCREENSHARE, VideoStream -> throttle 1fps -> VideoFrame.convert(RGBA) -> sharp JPEG. Just log that frames arrive and are encoded. This is the single hardest/riskiest piece (Agents-JS video is Python-only) so build it before anything else depends on it.
4. **3. Eyes — Gemini vision (1-2h, Ramis)** — Wire vision/gemini.ts: JPEG -> gemini-3.5-flash responseJsonSchema -> EngineerContext. Log structured context per engineer. Tune mediaResolution low + thinkingBudget 0 for latency. This is the on-screen 'live inference caption' for the demo.
5. **4. Brain + collision (2h, Yahya)** — Implement collision/detector.ts (pure fusion rule) + github/client.ts (state + compare + remoteHasFile). Wire agent/podman.ts to fuse vision contexts with GitHub state and emit a Collision when 2 engineers + >=1 unpushed. Unit-test the detector with two hardcoded contexts so the money moment is reproducible.
6. **5. Intervention out — card + voice + PR (2-3h, Yahya + Zander)** — Agent publishData the COLLISION DataMessage; frontend useInterventions renders the hero card with the would-be diff. Add voice/live.ts (gemini-3.1-flash-live -> PCM -> AudioFrame.captureFrame) so PodMan speaks in-room. Wire the card's 'Open sync PR' to POST /api/sync-pr -> Octokit creates a real PR on the public repo. This is the hero beat end-to-end.
7. **6. Continual learning — memory + policy (2-3h, Karti)** — memory/store.ts (Mongo writes), memory/vectors.ts (Voyage embed + Atlas $vectorSearch recall), memory/policy.ts (outcome-driven threshold/preference). Run database/init.ts. Make the 'it got smarter' beat real: write a memory_vectors doc in collision 1, retrieve it in collision 2 to raise confidence + lead with the previously-accepted action.
8. **7. Deploy on DO + rehearse (2-3h, all)** — doctl apps create --spec infra/.do/app.yaml (static_site + service + worker). Set secrets. Confirm wss + /health. Show the public DO URL + the github.com repo URL on screen. Rehearse the 3-min demo 3x with a recorded fallback of the money moment. Keep a hot local fallback in case venue wifi dies, but run live.

## Team split (max 4)

- **Karti** — Principal/infra: monorepo + deps + shared/messages.ts, backend service (server.ts: token + ws relay + sync-PR + outcome), the continual-learning memory layer (memory/store.ts, vectors.ts, policy.ts + database/init.ts), and the DigitalOcean deploy (infra/.do/app.yaml, doctl, secrets). Owns the 'it got smarter' proof.
- **Ramis** — Realtime vision critical path: agent.ts (LiveKit room subscribe + frame grab via @livekit/rtc-node, throttle, sharp encode) and vision/gemini.ts (gemini-3.5-flash -> EngineerContext). This is the hardest, highest-risk piece — owned start to finish, de-risked first.
- **Yahya** — PodMan brain + action: collision/detector.ts (fusion rule), github/client.ts (Octokit state/compare/sync-PR), agent/podman.ts orchestrator, voice/live.ts (gemini-3.1-flash-live voice into the room). Owns the money-moment logic and the real PR artifact.
- **Zander** — Frontend PWA: join + consent gate + 'PodMan is watching' indicator, useScreenPublish/useInterventions hooks, the hero InterventionCard (warn + diff + Open-sync-PR), voice playback, and the collapsed PodGridCorner (kept off-hero). Drives the demo UX and PWA install.

## Risks

- **LiveKit Agents-JS integrated live-VIDEO input is Python-only — architecting the screen-vision around the Node AgentSession video helper would dead-end the whole project.** → Design already uses @livekit/rtc-node's VideoStream/VideoFrame directly (see agent.ts), which is fully supported in Node. Build and prove this path in step 2 before anything depends on it. Fallback: run ONLY the vision worker in Python (Agents-JS Python has the integrated path) while keeping the rest of the backend in Node.
- **Realtime vision cost/latency blows up if every frame (up to 30fps x 4 engineers) is sent to Gemini.** → Hard throttle to ~1fps per engineer in agent.ts, downscale to 1280px JPEG via sharp, use mediaResolution LOW (~280 tok/img) and thinkingBudget 0. ~$0.05/min for 4 engineers. Buffer latest frame; only re-infer on interval.
- **'Unpushed local changes' is the moat but is fuzzy from vision alone — a flaky read undercuts the hero beat and the Technicality score.** → Two-tier: Tier-1 vision hasUnpushedChanges + remoteHasFile() inference; Tier-2 optional local git-reporter sidecar (tools/git-reporter.mjs) posting `git rev-list @{u}..HEAD` over the data channel for ground truth. Ship Tier-2 for demo reliability; the detector accepts either signal.
- **Dashboard-as-hero DQ: the pod grid of live screen tiles is on the explicit banned list.** → Grid is a small collapsed corner widget (PodGridCorner), shown for ~3-5s then collapsed; the hero is the proactive InterventionCard + voice. Say 'PodMan is an agent, not a dashboard — screens are just its eyes' out loud. Demo opens on a single IDE, not the grid.
- **DO App Platform deploy hangs if the LiveKit agent is configured as a service (health check on a port nothing listens on); or wss fails via ws:// mixed content.** → app.yaml puts the agent as a WORKER (no http_port/route) and the API as a service binding 0.0.0.0:8787; frontend selects wss when location.protocol is https. Both are baked into the starter files.
- **Wrong Gemini model ids: using the translate-only model as general voice, or assuming Computer Use needs a separate model.** → Voice = gemini-3.1-flash-live-preview (general); translate model reserved for the optional Spanish flourish only; vision/PR action use 3.5-flash + Octokit (no Computer Use on the hot path). Model ids are env-driven so they're swappable if previews move.
- **On-stage wifi failure or LiveKit/Gemini hiccup kills the live run.** → Rehearse 3x; keep a recorded backup of the money moment; keep a hot local fallback (localhost room + cached frame -> deterministic detector) but run live primarily. The detector is a pure function, so a scripted-but-real fallback is trivial and honest.
- **Sponsor-padding credibility hit if claiming tools not really integrated (MiniMax/Modular).** → Claim only DO (deploy + optional Gradient secondary call), LiveKit (transport), Gemini (3 surfaces: vision + voice + translate), MongoDB Atlas + Voyage (memory). Drop MiniMax/Modular from the pitch.
- **Consent/recording optics with screen+mic+cam of teammates.** → ConsentGate opt-in + persistent 'PodMan is watching' indicator; observations TTL-expire in 6h; mention privacy-by-design in one breath. Turns a red flag into a maturity signal.

## Canonical starter files (staged in `docs/generated/files/`)

- `shared/src/messages.ts` — NEW shared types: the LiveKit data-channel wire protocol (one discriminated union both sides parse), the InterventionOutcome that closes the learning loop, the TeamModel the world-model loop maintains, and the optional Tier-2 LocalGitReport. Dependency-free; uses existing types via .js relative imports per the repo's verbatimModuleSyntax/Bundler config.
- `backend/src/env.ts` — Typed, fail-fast env loader shared by both backend entry points. Loads .env in dev, throws early if a required var is missing so deploys fail loud, not silently.
- `backend/src/server.ts` — The publicly-routable SERVICE (DO App Platform `service`, has http_port). Mints LiveKit tokens, exposes a ws relay so the PWA gets collision/intervention events, creates the real sync PR via Octokit on demand, and ingests outcome ACKs into memory. Binds 0.0.0.0 (App Platform requirement).
- `backend/src/agent.ts` — The OUTBOUND WORKER (DO App Platform `worker`, NO http_port). Joins a pod's LiveKit room with @livekit/rtc-node, subscribes ONLY to screen-share video, throttles to ~1fps, converts each VideoFrame to a downscaled JPEG with sharp, and hands it to the PodMan orchestrator. This is the moat path. Uses VideoStream directly because Agents-JS live-video is Python-only.
- `backend/src/agent/podman.ts` — The orchestrator that ties the whole loop together: receive a frame -> Gemini vision -> EngineerContext -> fuse with GitHub state -> run the collision detector -> consult memory/policy -> publish the intervention card over the data channel + speak. Holds the live per-engineer context map.
- `backend/src/vision/gemini.ts` — The load-bearing screen-understanding call: one JPEG -> schema-valid EngineerContext via gemini-3.5-flash with responseJsonSchema. Uses minimal thinking + structured output for cheap, fast, reliable ambient watching.
- `backend/src/collision/detector.ts` — The fusion rule that is the heart of the moat: a collision fires when >=2 engineers point at the same normalized file AND >=1 has local-but-unpushed work (proven by vision hasUnpushedChanges, optional Tier-2 report, or absence from remote per GitHub state). Pure function, easy to unit-test and demo deterministically.
- `backend/src/github/client.ts` — Octokit wrapper for the deterministic git half: cached state poll (branches/commits), branch-vs-branch compare (REST has it, MCP does not), remote-file existence check, and the real sync-PR creation that is the demo's clickable artifact.
- `frontend/src/livekit/useScreenPublish.ts` — The frontend capture hook: connect to the pod room with a server-minted token, publish screen-share (+system audio) tagged as Source.ScreenShare so the agent finds it, then mic + cam. This is the engineer side of the realtime spine.
- `frontend/src/livekit/useInterventions.ts` — Receives PodMan's interventions over the LiveKit data channel and exposes them as React state for the hero card; also sends the accept/dismiss ACK that closes the learning loop. PodMan's voice plays automatically because the agent publishes it as a normal audio track the room subscribes to.
- `database/init.ts` — One-shot Atlas setup: create collections and the indexes the continual-learning loop depends on, including the Voyage vector-search index used for pattern recall. Run once after creating the cluster.
- `infra/.do/app.yaml` — DigitalOcean App Platform single-app spec deploying all three components: the PWA (static_site), the token/relay API (service, has http_port + route), and the LiveKit agent (worker, NO port — so the deploy doesn't hang on a health check). This split is the key to a successful DO deploy and the Best DigitalOcean prize story.