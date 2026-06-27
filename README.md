# PodMan — Real-time AI Team Coordination Agent

**2026 AI Engineer World's Fair Hackathon** — Track: **Continual Learning**

PodMan is an ambient AI teammate. Engineers join a pod room with earbuds in. Each engineer's browser PWA captures their screen every 30 seconds. PodMan watches, understands what each person is working on, detects coordination gaps — blockers, dependencies, duplicate work — and speaks up proactively before anyone has to ask.

> "Carol, looks like you're waiting on auth. Alice is actively building it — hang tight."
> "Carol, Bob — Alice just got the auth endpoint running. You're clear to integrate."

Nobody sent a message. Nobody pinged on Slack. PodMan just knew.

---

## How it works

1. Engineers open the PWA in their browser and join a pod room
2. PWA captures a screen frame every 30s via `getDisplayMedia`, POSTs it to Hermes
3. **Hermes** (server-side orchestrator) calls Gemini Vision to extract structured context per engineer — current file, inferred task, terminal state
4. Hermes writes context to MongoDB Atlas, updates the ownership map
5. Hermes runs event detection across all engineers — dependency ready, blocker, duplicate work
6. When an event fires, Hermes generates a spoken nudge and publishes it into the LiveKit room via Gemini Live 2.5
7. Engineers hear PodMan through their earbuds

The ownership map persists across sessions — making PodMan faster and smarter each time the team works together.

---

## Monorepo layout

| Folder | What |
|---|---|
| `frontend/` | React + Vite PWA — join pod, screen capture, nudge feed, live teammate status |
| `backend/` | Hermes orchestrator: `/ingest` endpoint, Gemini vision pipeline, event detector, LiveKit agent |
| `database/` | MongoDB Atlas schema — engineer states, ownership map, events, nudges |
| `infra/` | DigitalOcean App Platform deploy spec + Dockerfile |
| `shared/` | Shared TypeScript types |
| `docs/` | Full specs — read these first |

---

## Docs

| File | What |
|---|---|
| [`docs/idea.md`](docs/idea.md) | Full concept, value prop, demo moment |
| [`docs/PLAN.md`](docs/PLAN.md) | 12-hour build plan, team assignments, build order |
| [`docs/gemini.md`](docs/gemini.md) | Gemini Vision + event detection + Gemini Live 2.5 voice |
| [`docs/livekit.md`](docs/livekit.md) | LiveKit room structure, Hermes agent, voice delivery |
| [`docs/mongodb.md`](docs/mongodb.md) | MongoDB collections, schemas, continual learning hook |
| [`docs/digitalocean.md`](docs/digitalocean.md) | DO deploy config, env vars, fallback plan |
| [`docs/demo-setup.md`](docs/demo-setup.md) | Demo laptop setup, pre-staging checklist |

---

## Prizes targeted

- **Best Gemini** — Gemini Vision (screen understanding) + Gemini Live 2.5 (voice output via LiveKit Agents)
- **Best LiveKit** — LiveKit is the real-time backbone for room presence and voice delivery
- **Best DigitalOcean** — Hermes deployed on DigitalOcean App Platform

---

## Quick start

```bash
cp .env.example .env
# fill in LIVEKIT_*, GEMINI_API_KEY, MONGODB_URI

pnpm install
pnpm --filter backend dev   # Hermes on :8787
pnpm --filter frontend dev  # PWA on :5173
```

---

## Git watcher — run this on every demo laptop

Each engineer runs this in a terminal before the demo. It polls the local git working tree every 15 seconds and writes git state to MongoDB so PodMan has deterministic dirty/unpushed truth that vision alone cannot reliably infer.

```bash
# from the repo root
node scripts/podman-agent.mjs --name <yourname> --pod <podId>
```

**Demo setup (one command per laptop):**

```bash
# Alice's laptop
node scripts/podman-agent.mjs --name alice --pod demo-pod

# Bob's laptop
node scripts/podman-agent.mjs --name bob --pod demo-pod

# Carol's laptop
node scripts/podman-agent.mjs --name carol --pod demo-pod
```

The script logs one line per cycle — branch, changed file count, and latest commit. Leave it running in a background terminal tab throughout the session. Stop with `Ctrl+C`.

**Requirements:**
- `MONGODB_URI` must be set — either exported in the shell or present in `backend/.env`
- Run `pnpm install` first so `mongodb` is in workspace `node_modules`
- Must be run from the repo root (the script resolves `backend/.env` relative to its own path)
