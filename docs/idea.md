# PodMan — Idea

## One-line value prop

PodMan is a real-time AI team coordination agent that watches consented work signals, maintains live project memory, and proactively notifies collaborators when dependencies, blockers, or handoffs emerge — before anyone has to ask.

---

## Problem

Teams working on the same project lose time because progress is fragmented across people, editors, terminals, and half-finished messages. Coordination gaps — a completed endpoint, a resolved blocker, two engineers duplicating work — are discovered too late, causing idle time, broken handoffs, and missed dependencies.

Slack doesn't help. Stand-ups are too slow. GitHub only knows pushed state.

---

## Solution

PodMan is an ambient AI agent that:

1. Watches each engineer's screen via periodic snapshots (consented, browser-native)
2. Extracts structured context using Gemini Vision — current file, inferred task, terminal state
3. Maintains a shared live model of the team in MongoDB Atlas — who is doing what, who owns which files
4. Detects coordination events: dependency ready, blocker detected, duplicate work
5. Speaks proactively into the team's LiveKit room — engineers hear PodMan through their earbuds without leaving their editor

**The AI's job is not to chat. It is to notice what teammates miss and say so, exactly when it matters.**

---

## Target user

Small software teams: hackathon squads, startup engineering teams, student dev teams collaborating in real time on a shared codebase.

---

## Core AI job

- Maintain per-person live context (file, task, terminal)
- Infer shared project state (who owns what, what's blocked, what's ready)
- Detect 3 coordination event types:
  - `DEPENDENCY_READY` — engineer A was waiting on work engineer B just completed
  - `BLOCKER_DETECTED` — engineer appears stuck; another teammate can unblock
  - `DUPLICATE_WORK` — 2+ engineers working on the same file simultaneously
- Generate a 1–2 sentence proactive voice nudge
- Deliver it into the LiveKit room as Gemini TTS audio

---

## How it fits the Continual Learning track

PodMan builds an **ownership map** in MongoDB that persists across sessions:

- Session 1: PodMan needs 3–5 minutes of screen observations to infer who owns what
- Session 2+: PodMan already knows. First nudge fires in under 30 seconds.

The system gets demonstrably more useful the more it is used, with no user configuration required. That is the track definition met exactly.

---

## Architecture (one paragraph)

Each engineer opens a browser PWA on their laptop. The PWA captures live IDE context through LiveKit screen sharing and scheduled local git reports. Hermes, the server-side orchestrator running on DigitalOcean, calls Gemini Vision to extract structured context, writes it to MongoDB Atlas, updates the ownership map, and runs event detection across all active engineers. When a coordination event fires, Hermes generates a short spoken message, asks Gemini TTS for natural audio, and publishes that audio into the team's LiveKit room. Engineers hear PodMan through their earbuds. No Slack. No tab switching. No interruption to the editor flow.

---

## Demo wow moment

> Alice is building the auth endpoint. Carol is visibly blocked — her terminal shows `connection refused`. PodMan detects the blocker and says aloud: "Carol, looks like you're waiting on auth. Alice is actively building it — hang tight."
>
> Two minutes later, Alice's server starts. PodMan says: "Carol, Bob — Alice just got the auth endpoint running. You're clear to integrate."
>
> Nobody asked. Nobody pinged anyone on Slack. PodMan just knew.

---

## What PodMan is NOT

- Not a chat interface
- Not a dashboard product
- Not raw surveillance — engineers consent by joining the room and sharing their screen
- Not a task manager
- Not a GitHub integration (v1)

---

## Prize alignment

| Prize                 | How PodMan earns it                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| Best Gemini 3.5 / 2.5 | Gemini Vision for screen understanding + Gemini TTS for urgent voice output                           |
| Best LiveKit          | LiveKit is the real-time backbone for room presence and voice delivery — load-bearing, not decorative |
| Best DigitalOcean     | Hermes deployed on DigitalOcean App Platform; MongoDB Atlas on DO-adjacent infrastructure             |
