# PodMan - Canonical Master Plan

> Source of truth for PodMan product intent, current implementation truth, demo
> strategy, public interfaces, risks, sponsor story, and next build order.
>
> If this file conflicts with `README.md`, `docs/idea.md`, `docs/livekit.md`,
> `docs/gemini.md`, `docs/mongodb.md`, `docs/digitalocean.md`,
> `docs/demo-setup.md`, or `docs/superpowers/specs/*`, follow this file and
> treat the older docs as reference material to reconcile later.

---

## 1. Product thesis

**PodMan sees active work before it becomes visible to GitHub, remembers how the
team works, researches better paths in the background, and coordinates teammates
without being intrusive.**

GitHub knows pushed branches, PRs, issues, and comments. It cannot see the most
expensive coordination failures while they are still forming on laptops: two
engineers editing the same unpushed file, someone blocked on an endpoint a
teammate is nearly done with, duplicated work starting silently, or a team
walking into a dead-end implementation path.

PodMan puts engineers in a consented LiveKit pod, watches live IDE/screen
context, fuses that with scheduled local git reports, GitHub state, MongoDB team
memory, and background research, then routes only useful interventions through
Hermes. The default is a small visual card. Hermes can message teammates when
the team needs coordination. Voice is reserved for urgent escalation.

**One-line product definition:** PodMan is a non-intrusive, continual-learning
team assistant for active coding.

**One-line demo promise:** PodMan notices live work, finds a better path,
remembers a previous intervention, and escalates only when the team actually
needs it.

---

## 2. Product contract

### Inputs

- **Live IDE/screen context:** engineers join a LiveKit room and publish screen
  share so the backend agent can sample real work in progress.
- **Scheduled local git state:** each laptop should report dirty files,
  unpushed commits, branch, and latest commit about every minute. This is the
  deterministic fallback for facts vision cannot reliably infer.
- **MongoDB team memory:** ownership, current tasks, blockers, repeated
  mistakes, preferred tools, decisions, intervention history, and outcomes.
- **GitHub repo state:** public repo metadata, branches, PR artifacts, and
  issue/PR state when it exists.
- **Background research signals:** tool, repo, skill, package, docs, and
  dead-end evidence discovered while teammates are working.

### Outputs

- **Default:** small visual intervention card in the PodMan frontend.
- **Coordination:** Hermes message to the right teammate(s) or project channel.
- **Urgent escalation:** voice only when timing or risk justifies interruption.
- **Action path:** optional sync PR, research recommendation, summary, fix
  suggestion, or teammate notification.

### Memory rules

- Remember team-level work patterns, not raw screen recordings.
- Store structured observations, collisions, interventions, outcomes, and pod
  state.
- Add exact-signature recall before vector recall: normalized file, symbol,
  engineer pair, event type, and accepted/dismissed outcome.
- Privacy must stay explicit: engineers consent by joining the pod and sharing
  screen context; do not store raw screenshots, full recordings, or secrets.

### Non-goals

- Not a dashboard as the product center.
- Not a screenshot analyzer with no action loop.
- Not sponsor-padding; every sponsor technology must be load-bearing or clearly
  marked as optional polish.
- Not a task manager, Slack clone, full auth system, or general surveillance
  tool.

---

## 3. Track fit: Continual Learning

PodMan fits **Continual Learning** because the system gets more useful from team
history and intervention outcomes.

- **Team model:** observations build ownership, hotspot, blocker, tool, and
  decision memory per pod.
- **Outcome loop:** accepted, dismissed, and confirmed interventions become
  supervision for future thresholds and routing.
- **Session compounding:** a later similar situation should reference prior
  memory, choose a better action sooner, or lower the noise level.
- **Visible demo proof:** the first intervention writes memory; the second
  similar situation retrieves it and says, in effect, "I have seen this pattern
  before."

The learning proof should not depend on Atlas Vector Search being finished.
Exact MongoDB recall is enough for the MVP learning beat.

---

## 4. Current implementation truth

Verified on `2026-06-27` from local repo inspection, authenticated `gh`, and
the current remote plan commit.

### GitHub state

- Repo: <https://github.com/karti-ai/podman>
- Visibility: public
- Default branch: `main`
- Current local branch: `main`
- Local branch state during this rewrite: behind `origin/main` by two commits
- Issues: none
- PRs: none
- `origin/main` latest relevant commits:
  - `8271188 feat(frontend): live room view, beat connectivity test, session resume`
  - `65a0791 docs(plan): audit server state + mark tasks 1-5 done, reflect actual arch`

### Working / started

- Monorepo packages exist: `frontend`, `backend`, `shared`, `database`, and
  `infra`.
- Backend is split into two processes:
  - API service in `backend/src/server.ts`.
  - LiveKit agent worker in `backend/src/agent.ts`.
- Backend API exposes:
  - `GET /health`
  - `POST /api/token`
  - `POST /api/sync-pr`
  - `POST /api/outcome`
  - `GET /api/memory/stats`
  - `GET /api/pods`
  - `POST /api/pods`
  - `GET /api/pods/:id`
  - `PATCH /api/pods/:id`
  - `DELETE /api/pods/:id`
  - `POST /api/pods/:id/members`
  - `DELETE /api/pods/:id/members/:name`
- Remote API health check returned `{"ok":true}` at
  `http://165.22.129.249:8787/health` during verification.
- The LiveKit agent uses `@livekit/rtc-node` to join as `podman-agent`, subscribe
  to `TrackSource.SOURCE_SCREENSHARE`, sample frames near 1 fps, convert frames
  to RGBA, and encode downscaled JPEGs with `sharp`.
- Gemini vision is wired in `backend/src/vision/gemini.ts` with JSON structured
  output, response schema, low media resolution, and model ID from env.
- Collision detection exists and groups engineer contexts by normalized file,
  then fires when 2+ engineers touch the same file and at least one unpushed or
  dirty signal exists.
- Shared LiveKit data topic and wire messages exist:
  - topic: `podman.intervention`
  - messages: `COLLISION`, `VOICE_CUE`, `ACK`, `GIT_REPORT`
- MongoDB persistence groundwork exists for observations, collisions,
  interventions, outcomes, and pods.
- Frontend has pod selection, pod join, post-join pod view, LiveKit join helper,
  and dev-mode fallback.
- `origin/main` adds live room participants, active-speaker state, session
  resume, a "Play beat" audio connectivity test, and a deliberate "Share my
  screen" button that publishes with `Track.Source.ScreenShare`. Merge that
  remote commit before doing more frontend work on the local checkout.
- DigitalOcean infra scaffolding exists:
  - `infra/.do/app.yaml` is the split App Platform direction.
  - `infra/app.yaml` is an older single-service backend spec and should be
    treated as legacy until reconciled.

### Server snapshot

From the remote plan snapshot and health check on `2026-06-27`:

- Backend API: running on `http://165.22.129.249:8787` and `/health` returned
  `{"ok":true}`.
- Frontend: reported running on `:81`; port `80` was already taken.
- Agent worker: reported not running; it still needs LiveKit credentials and
  `pnpm --filter @podman/backend dev:agent`.
- Treat this as operational evidence, not architecture truth. Reverify before
  demo.

### Partial / stubbed

- `backend/src/voice/live.ts` logs only; it does not publish real voice/audio
  into LiveKit yet.
- Hermes is a product/action/messaging layer in the plan, but the current repo
  does not yet implement a complete Hermes notification bridge.
- `backend/src/memory/vectors.ts` is not a real Voyage/Atlas Vector Search
  implementation yet.
- Exact-signature recall is the required MVP fallback before vectors.
- `backend/src/memory/policy.ts` is a simple gate; it does not learn thresholds
  from outcomes yet.
- `POST /api/sync-pr` creates a PR artifact path but does not yet build a
  meaningful sync diff.
- Frontend `PodView` has only a placeholder intervention area unless/until live
  intervention rendering is wired.
- Browser screen publishing exists, but the active join path must be proven to
  tag tracks as screen share so the backend agent can filter them correctly. The
  `origin/main` screen-share button appears to address this; local code remains
  behind until that commit is merged.
- `GIT_REPORT` exists in shared types and agent handling. `scripts/podman-agent.mjs`
  is the finished per-laptop git sidecar — polls every 15 s, upserts git fields
  to `engineer_states` collection. Not yet wired to publish a `GIT_REPORT` data
  channel message into the LiveKit room (agent fusion step still needed).
- Background research recommendations are a product requirement and demo goal,
  not an implemented research agent yet.
- Deployment reliability is partial; API health is reachable, but API/static
  site/worker together must still be reverified before demo.
- Env docs now align on `gemini-3.5-flash` for vision and
  `gemini-3.1-flash-tts-preview` for voice. The backend still preserves a Gemini
  Live path for future available Live models.

### Not yet proven

- Real browser -> LiveKit room -> backend agent screen-frame capture end to end.
- Real Gemini inference from a live shared IDE frame using the stage key/model.
- Real data-channel intervention card rendering in the active frontend.
- Hermes message routing to teammates.
- Voice escalation heard by participants through LiveKit.
- A meaningful real sync PR flow with correct GitHub scopes and artifact.
- Atlas Vector Search / Voyage recall path.
- DigitalOcean static site + API service + LiveKit agent worker all running
  together.
- Background research recommendation that is both timely and evidence-backed.

---

## 5. Architecture to build toward

```
Engineer browser PWA
  - joins a pod room
  - publishes screen share and optional mic
  - receives intervention cards and voice
        |
        v
LiveKit room
  - one room per pod
  - screen-share tracks are the live work signal
  - small reliable data packets carry interventions
        |
        v
PodMan backend agent worker
  - @livekit/rtc-node room participant
  - screen-track subscription
  - frame throttle and JPEG encode
  - Gemini structured vision
  - scheduled GIT_REPORT fusion
  - GitHub state fusion
  - collision, blocker, duplicate-work, and dead-end detection
  - MongoDB memory recall and policy
        |
        v
Hermes action layer
  - visual card routing
  - teammate messages
  - urgent voice escalation
  - optional research/action/sync PR workflows
        |
        v
Backend API + MongoDB + GitHub
  - token minting, pod CRUD, outcomes, memory stats
  - observations, collisions, interventions, outcomes, pod memory
  - public repo state and PR artifacts
```

The backend must remain split:

- **API service:** routable HTTP process with `/api/*` endpoints and health
  checks.
- **Agent worker:** outbound LiveKit participant with no HTTP health-check port
  requirement.

This split matters for DigitalOcean App Platform: the LiveKit agent should be a
worker, not a web service that App Platform expects to health-check over HTTP.

---

## 6. Public interfaces to preserve

Do not rename or reshape these without updating frontend, backend, docs, and demo
scripts together.

### Backend HTTP

- `GET /health`
- `POST /api/token`
- `POST /api/sync-pr`
- `POST /api/outcome`
- `GET /api/memory/stats`
- `GET /api/pods`
- `POST /api/pods`
- `GET /api/pods/:id`
- `PATCH /api/pods/:id`
- `DELETE /api/pods/:id`
- `POST /api/pods/:id/members`
- `DELETE /api/pods/:id/members/:name`

### LiveKit data channel

- Topic: `podman.intervention`
- Core messages:
  - `COLLISION`: agent -> PWA; contains `collision` and `intervention`.
  - `ACK`: PWA -> agent/API; intervention response.
  - `GIT_REPORT`: local git sidecar -> agent; dirty/unpushed ground truth.
  - `VOICE_CUE`: text cue/fallback for voice escalation.

### Required environment

```bash
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

GEMINI_API_KEY=
GEMINI_VISION_MODEL=
GEMINI_LIVE_MODEL=

GITHUB_TOKEN=
GITHUB_REPO=karti-ai/podman

MONGODB_URI=
VOYAGE_API_KEY=
POD_ROOM=demo-pod
PORT=8787

VITE_BACKEND_URL=http://localhost:8787
VITE_LIVEKIT_URL=
```

Keep all non-`VITE_` secrets server-side.

---

## 7. Critical implementation callouts

### LiveKit

- Screen share is a video track. The backend agent should consume raw screen
  frames through `@livekit/rtc-node`.
- The agent must filter screen share, not webcam:
  `pub.source === TrackSource.SOURCE_SCREENSHARE`.
- Frontend publishing must tag the track as screen share; otherwise the agent can
  miss it.
- Throttle aggressively. Screens can arrive near video frame rate; Gemini should
  receive sampled frames only.
- Keep reliable data packets small. Use them for intervention metadata, not
  screenshots, large diffs, or research dumps. Treat reliable payloads as
  roughly 15 KiB max.
- A historical closed `livekit/node-sdks` issue reported high memory use when
  consuming video; run memory checks during agent frame tests and stop if the
  loop leaks.

### Gemini

- Use structured output for vision: JSON mime type plus response schema.
- Use low media resolution for ambient screen watching; reserve higher
  resolution for debugging or targeted inspection.
- Never expose `GEMINI_API_KEY` to the browser.
- Gemini Live API is still a risk for the first demo path. Use card + Hermes
  message first; add browser TTS or pre-generated voice fallback before relying
  on Gemini Live for stage audio.
- Keep model IDs in env so preview/availability changes do not require code
  changes.

### MongoDB

- Local MongoDB is fine for dev CRUD and memory counts.
- Atlas or Atlas Local is needed for the sponsor-grade Vector Search story.
- Build exact-signature recall first:
  normalized file + symbol + engineer pair + event type + outcome.
- Writes from the agent should be best-effort. Mongo hiccups should degrade
  memory, not kill live detection.
- Do not store raw screenshots or recordings.

### GitHub

- The repo is public and currently has no issue/PR backlog, so do not make the
  plan issue-driven yet.
- GitHub cannot see local dirty files or unpushed commits. That is still a core
  product moat.
- Sync PRs should use deterministic GitHub REST/Octokit flows, not browser
  automation.
- Verify token scopes and demo repo permissions before stage time.

### DigitalOcean

- Use App Platform as:
  - static site for frontend,
  - HTTP service for API,
  - worker for the LiveKit agent.
- Do not model the agent worker as a health-checked HTTP service.
- Keep a local and recorded fallback even if deployment works; venue network is a
  stage risk.

### Hermes

- Treat Hermes as the action and messaging layer, not as a replacement for the
  current implemented backend agent until code changes make that real.
- Hermes should choose the least intrusive channel:
  card -> message -> voice.
- Hermes can own research summaries, teammate notification, sync PR initiation,
  and urgent escalation once those workflows exist.

---

## 8. Build ladder

Do not mark a rung done until it is proven in logs, UI, or a visible external
artifact.

### P0 - make the live loop undeniable

1. **Preserve and reconcile the plan**
   - Merge local `docs/PLAN.md` with `origin/main:docs/PLAN.md`.
   - Keep both the broad product thesis and concrete server/current-state facts.
   - After the docs are safe, merge or rebase the two newer `origin/main` commits
     before implementing frontend work.

2. **Browser publish proof**
   - Start backend API and frontend.
   - Join a real LiveKit room from the browser.
   - Confirm the browser publishes a screen-share track with the correct source.

3. **Agent frame proof**
   - Start `pnpm --filter @podman/backend dev:agent`.
   - Confirm room join, screen-track subscription, frame sampling, and JPEG
     encode logs.
   - Watch process memory while consuming frames.

4. **Gemini vision proof**
   - Send one live sampled IDE frame to Gemini.
   - Log parsed JSON with `currentFile`, `currentSymbol`, `activity`,
     `hasUnpushedChanges`, and `confidence`.
   - Add a confidence/logging gate if noisy frames cause bad reads.

5. **Scheduled git truth** ✅ partial
   - `scripts/podman-agent.mjs` polls every 15 s: `git status --short`,
     `git diff --stat HEAD`, `git log --oneline -1`, `git branch --show-current`.
   - Upserts `changedFiles`, `diffStat`, `recentCommit`, `branch`, `gitUpdatedAt`
     to `engineer_states` collection in MongoDB (upsert by `podId::name` key).
   - **Still needed:** fuse `engineer_states` git fields into the collision
     detector, and/or publish `GIT_REPORT` data channel messages so the agent
     worker can incorporate git truth into vision-based decisions.

6. **Intervention card + Hermes notification**
   - Publish a real intervention on `podman.intervention`.
   - Render it as a small card in the frontend.
   - Route a Hermes message to the affected teammate(s) or project channel once
     the bridge exists.

7. **Background research recommendation**
   - When the team is heading into a poor tool/repo/skill choice or dead end,
     produce a recommendation card with short evidence.
   - Minimum evidence: why it matters, what to use instead, and who should act.

8. **Learning proof**
   - First intervention writes observation/collision/recommendation/outcome
     memory.
   - Second similar situation retrieves exact prior memory and changes the
     message: "I have seen this pattern before."

9. **Urgency routing**
   - Default to card.
   - Escalate to Hermes message when coordination involves other teammates.
   - Escalate to voice only when urgent.

10. **Action artifact**
    - If demo uses same-file collision, click the card to open a real draft sync
      PR or visible GitHub artifact.
    - If demo uses research recommendation, show the accepted recommendation and
      memory outcome instead.

11. **Deployment or fallback proof**
    - Prove API/static/worker deployment together, or explicitly run local with a
      recorded backup.
    - Keep backup video on a separate device.

### P1 - polish the money moment

- Add visible live inference captions in the PWA.
- Add a small memory stats panel backed by `/api/memory/stats`.
- Add browser-side TTS or pre-generated voice fallback for urgent interventions.
- Add Hermes notification bridge once the target channel is chosen.
- Improve research cards with compatibility, install effort, docs quality, repo
  health, and security/trust signals.

### P2 - sponsor and scale polish

- Implement Voyage embedding + Atlas Vector Search recall.
- Improve policy learning from outcomes.
- Deploy DigitalOcean static site + API service + worker as the submission path.
- Add optional GitHub issue/PR backlog integration after issues/PRs actually
  exist.

### Cut if behind

- Webcam grid.
- Mic transcription.
- Full auth/accounts.
- Slack/Linear/Jira integrations unless Hermes requires one immediately.
- Complex dashboards.
- Server-published audio if browser/pre-generated voice proves escalation.
- Vector Search if exact Mongo recall demonstrates the learning beat.

---

## 9. Critical 3-minute demo script

**Rule:** open on one active IDE, not a grid. PodMan is an agent, not a
dashboard.

1. **0:00 - Set the scene**
   - One engineer is actively coding in the IDE.
   - The presenter says: "This work is not pushed yet. GitHub cannot see it."

2. **0:20 - Show the live signal**
   - Show a compact caption: current file, inferred task, git dirty/unpushed
     state.
   - Show that PodMan is watching consented screen context, not stored
     recordings.

3. **0:40 - Introduce the better-tool moment**
   - A teammate starts down a weak path: wrong package, dead repo, bad API,
     duplicated effort, or risky implementation.
   - PodMan has been researching in the background.

4. **1:05 - Money moment**
   - PodMan shows a small card:
     "This path is likely a dead end. Use X instead; it matches our stack and is
     actively maintained."
   - The card names the affected teammate and the suggested action.

5. **1:25 - Hermes coordination**
   - Hermes notifies the right teammate(s), not the whole room.
   - No voice yet unless the situation is urgent.

6. **1:50 - Learning beat**
   - A similar issue appears.
   - PodMan references memory:
     "I have seen this pattern before. Last time the team accepted the X
     recommendation."
   - Show `/api/memory/stats` or the visible memory indicator.

7. **2:20 - Urgency escalation**
   - Raise the severity with a same-file collision, blocking dependency, failing
     test, or imminent bad push.
   - Hermes escalates to voice only now.

8. **2:40 - Close**
   - Show the public repo, deployed/local URL, and memory stats.
   - Closing line: "PodMan coordinates work while it is still happening."

### Reliable fallback demo

If the research recommendation is not reliable by stage time, use the same-file
collision fallback:

1. Two engineers open the same visible file.
2. `GIT_REPORT` or vision marks one as dirty/unpushed.
3. Agent publishes `COLLISION` on `podman.intervention`.
4. Frontend renders the card.
5. The card opens a sync PR artifact.
6. A second similar collision retrieves prior memory.

---

## 10. Sponsor strategy

### Gemini

Gemini must be load-bearing for the vision loop:

- live IDE/screen frame -> structured work context,
- optional message/recommendation generation,
- optional Live voice only after card/Hermes routing is stable.

Do not overclaim voice if it is using browser/pre-generated TTS. Say plainly that
it is the reliability fallback.

### LiveKit

LiveKit is the real-time spine:

- engineers join one pod room,
- screen-share tracks carry active work context,
- PodMan joins as a participant,
- data packets carry interventions,
- voice can be added as urgent escalation.

Pitch line: "Unpushed work is invisible to GitHub, so real-time presence is the
only way to coordinate before the push."

### MongoDB + Voyage

MongoDB is the learning proof:

- observations, collisions, recommendations, interventions, and outcomes persist,
- prior memory changes a later intervention,
- exact recall is the MVP,
- Voyage + Atlas Vector Search is the stronger sponsor-grade version after exact
  recall works.

### DigitalOcean

DigitalOcean earns its place when:

- frontend runs as a static site,
- API runs as an HTTP service,
- LiveKit agent runs as a worker,
- public URL is shown in submission or demo.

Local fallback is acceptable for stage reliability, but the submission should
include the deployment URL if possible.

---

## 11. Risks and mitigations

| Risk                                   | Mitigation                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Looks like a dashboard                 | Keep the UI quiet. Hero is card/message/action, not a grid.                                                                      |
| Looks like a screenshot analyzer       | Always show screen signal + git truth + memory + action.                                                                         |
| Interrupts too much                    | Default to cards, escalate to Hermes messages, reserve voice for urgency.                                                        |
| Overclaims implemented features        | Mark voice, Hermes bridge, vectors, adaptive policy, research agent, real sync PR, and DO worker deploy incomplete until proven. |
| Vision misses unpushed state           | Use scheduled `GIT_REPORT` for deterministic dirty/unpushed truth.                                                               |
| Research recommendation lacks evidence | Show only concise evidence: stack fit, repo/tool health, install effort, docs/trust signal.                                      |
| No visible learning                    | Build exact Mongo recall before vector search.                                                                                   |
| LiveKit frame loop leaks memory        | Monitor agent memory during video consumption; throttle hard.                                                                    |
| GitHub issue/PR backlog absent         | Do not invent issue-driven backlog; repo currently has no issues or PRs.                                                         |
| Venue network failure                  | Rehearse on hotspot and keep recorded backup.                                                                                    |
| DO worker deploy hangs                 | Deploy agent as worker, not health-checked service.                                                                              |

---

## 12. Documentation reconciliation tasks

After this plan is accepted, update the supporting docs so they stop conflicting
with this file:

- `README.md`: replace POST-screenshot-first language with LiveKit screen-track
  agent architecture and Hermes action-layer wording.
- `docs/idea.md`: broaden from blocker/dependency voice demo to card/message/
  urgent-voice coordination plus research and memory.
- `docs/livekit.md`: remove "Hermes does NOT subscribe to engineer screen
  tracks"; current architecture uses backend agent screen subscription.
- `docs/gemini.md`: keep structured vision, but mark Gemini Live as P1 and avoid
  claiming voice is implemented.
- `docs/mongodb.md`: align collection names with current code
  (`observations`, `collisions`, `interventions`, `outcomes`, `pods`) and add
  exact-signature recall.
- `docs/digitalocean.md`: split API service and agent worker; do not deploy the
  worker as a health-checked HTTP service; mark `infra/app.yaml` legacy or
  reconcile it with `infra/.do/app.yaml`.
- `docs/demo-setup.md`: update the script to include better-tool research,
  learning recall, Hermes notification, and urgency-based voice.

---

## 13. Acceptance checklist

Before saying PodMan is demo-ready:

- [ ] `pnpm format:check` passes or all failures are documented as unrelated.
- [ ] `pnpm typecheck` passes.
- [ ] Browser joins a real LiveKit room.
- [ ] Browser publishes a screen-share track with the correct source.
- [ ] Backend agent subscribes to the screen-share track.
- [ ] Agent logs at least one parsed Gemini context from a real IDE screen.
- [x] Local git report supplies dirty/unpushed truth on a schedule (`scripts/podman-agent.mjs` — 15 s poll → MongoDB `engineer_states`). Agent fusion still needed.
- [ ] Frontend renders a real intervention card.
- [ ] Hermes notification path works for teammate messages.
- [ ] Voice is heard only for urgent escalation or a fallback is declared.
- [ ] Outcome ACK writes to MongoDB.
- [ ] `/api/memory/stats` shows counts increasing.
- [ ] Second similar situation uses prior memory in the message.
- [ ] Research recommendation card is evidence-backed, or fallback collision demo
      is used.
- [ ] Sync PR action creates a visible GitHub artifact if used in demo.
- [ ] DigitalOcean deployment or local fallback is rehearsed.
- [ ] Backup recording is ready on a separate device.

---

## 14. Evidence appendix

### Repo and GitHub state

- Public repo: <https://github.com/karti-ai/podman>
- Verified with authenticated `gh` on `2026-06-27`.
- Default branch: `main`.
- No GitHub issues or PRs existed at verification time.

### Hackathon / event

- AI Engineer World's Fair: <https://www.ai.engineer/worldsfair/2026>
- Cerebral Valley hackathon page:
  <https://cerebralvalley.ai/e/aiewf-hackathon-2026>

### LiveKit

- Screen share docs: <https://docs.livekit.io/transport/media/screenshare/>
- Data packets docs: <https://docs.livekit.io/transport/data/packets/>
- Node SDK reference: <https://docs.livekit.io/reference/client-sdk-node/>
- Node SDK releases: <https://github.com/livekit/node-sdks/releases>
- Node SDK issue risk: <https://github.com/livekit/node-sdks/issues/444>

### Gemini

- Structured output:
  <https://ai.google.dev/gemini-api/docs/structured-output>
- Media resolution: <https://ai.google.dev/gemini-api/docs/media-resolution>
- Live API: <https://ai.google.dev/gemini-api/docs/live-api>

### DigitalOcean

- App Platform app spec:
  <https://docs.digitalocean.com/products/app-platform/reference/app-spec/>

### MongoDB

- Vector Search index type:
  <https://www.mongodb.com/docs/vector-search/index/vector-search-type/>
- Node driver Atlas Vector Search:
  <https://www.mongodb.com/docs/drivers/node/current/atlas-vector-search/>
