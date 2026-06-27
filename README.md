# 🛰️ PodMan — Jarvis for engineering teams

Ambient AI teammate for the **2026 AI Engineer World's Fair Hackathon** (track: **Continual Learning**).

Engineers join a **pod** and share their screen + mic. PodMan watches every screen in
**realtime**, understands what each person is working on, fuses that with the team's
GitHub state, and **proactively prevents collisions before code is even pushed** —
speaking up like Jarvis: _"Karti and Yahya are both editing `auth.ts`, Yahya has unpushed
changes — here's the diff, want a sync PR?"_

> **The moat:** unpushed local code is invisible to the GitHub API. The realtime
> screen-vision layer is the *only* way to catch a collision before the push. That is the
> whole product — and the reason this is an ambient agent, not a dashboard.

## Monorepo layout

| Folder | What |
|---|---|
| `frontend/` | React + Vite PWA — join pod, screen/mic/cam capture, PodMan voice + intervention cards |
| `backend/` | PodMan agent: LiveKit room subscriber, Gemini vision, GitHub fusion, collision detector, voice out |
| `infra/` | DigitalOcean deploy (App Platform / Droplet), IaC, Dockerfiles |
| `database/` | MongoDB Atlas schema + Voyage vector memory for continual learning |
| `shared/` | Shared TypeScript types (pod, engineer context, intervention) |
| `docs/` | `PLAN.md` (the north star), demo script |

## Prizes we're stacking

- 🏆 **Best Gemini 3.5** — $5,000 cash (realtime vision + Live API voice)
- 🏆 **Best LiveKit** — Keychron keyboards (realtime transport is the core)
- 🏆 **Best DigitalOcean** — credits (deploy target)

👉 **Read [`docs/PLAN.md`](docs/PLAN.md) first.**
