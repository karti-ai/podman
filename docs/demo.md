# PodMan — 4-Minute Demo Script

**Theme:** Continual Learning. **Hard limit:** 4:00. Practice to land at 3:45.

**The one-line story:** writing code isn't the bottleneck anymore — _coordinating
who's writing what_ is. PodMan is a pair programmer for the whole team: it watches
every member's work in real time, gives everyone live status without anyone having
to interrupt anyone, and learns your team's dynamics so it nudges less and helps
more over time.

**The hook to land:** a "quick five-minute question" actually costs ~25 minutes of
lost focus — for two people. PodMan removes the reason to ask. Multiply the saved
recovery time across every teammate, every day, and that is the value.

---

## The script (4:00)

### 0:00–0:30 — The problem + hook

> "AI made writing code easy. The thing still slowing teams down is coordination
> — checking each other's work, re-planning collisions, and the constant 'what
> are you working on?' A five-minute question really costs both people 25 minutes
> of lost focus. PodMan is a pair programmer for the whole team: it watches
> everyone's work live, so anyone can see another's status without interrupting
> them — and it learns your team as it goes."

_On screen:_ the pod view, two teammates joined, screen-share tiles live.

### 0:30–1:05 — Real-time team awareness (LiveKit + Gemini Vision)

- Point at the two live screen tiles. "These are real screen shares over
  **LiveKit**. Our agent subscribes to the tracks and samples frames."
- "Each frame goes to **Gemini Vision**, which returns structured context — file,
  symbol, activity — not a chatbot, a perception layer."
- Show the live activity stream filling in (Signals vs Reasoning sections).
- Land the value: "This is the part that replaces 'what are you working on?' —
  every teammate's current work is just _visible_, in real time. Nobody had to
  ask."

_Built-by-us callout:_ `backend/src/vision/gemini.ts`, the LiveKit agent worker.

### 1:05–1:40 — The catch (detection + first intervention)

- Have alice and bob both edit the **same file** with unpushed changes.
- "Normally nobody notices until merge time. GitHub can't see this — nothing's
  pushed. Our detector fuses live screen context with **local git truth** from a
  watcher on each laptop."
- A collision card appears: _"alice + bob both on detector.ts (unpushed)."_
- Let the **Gemini TTS** urgent voice fire once over LiveKit: _"alice and bob are
  both editing detector.ts. Please sync before pushing."_
- Land the value: "That's a merge conflict and a wasted afternoon caught before it
  happened — and neither of them had to be tracking the other."

_Built-by-us callout:_ `collision/detector.ts`, `action/hermes.ts`,
`voice/live.ts`.

### 1:40–2:10 — Cross-channel overlap (research + code)

- Keep alice editing `livekit.py`.
- Have bob share a browser tab on LiveKit docs/SDK pages.
- A collaboration nudge appears: _"🤝 bob is researching LiveKit agents
  (docs.livekit.io) while alice edits livekit.py — sync up before duplicating
  effort."_
- Land the value: "This is not a merge conflict. PodMan caught duplicated effort
  across channels — code on one screen, research on another — and nudged the team
  before two people solved the same problem twice."

_Built-by-us callout:_ `vision/gemini.ts`, `collision/research.ts`,
`memory/vectors.ts`.

### 2:10–2:50 — Continual learning (the theme — the money shot)

This is the differentiator. Two beats, both from pre-seeded memory:

1. **It learned to stay quiet.** Trigger a pattern that was dismissed as a false
   alarm earlier. "Last session a teammate marked this kind of alert as not a
   real conflict. Watch — PodMan stays silent. No nagging." (No card fires.)
2. **It learned to escalate.** Trigger the real-conflict pattern that was
   accepted before. The card now says **"Seen before."** and goes straight to
   the spoken urgent cue.

- "The only input was one accept/dismiss tap. No retraining, no labeling. This is
  **MongoDB Atlas vector search** recalling similar past events plus a policy
  that adapts on the recalled outcome."
- Optional: show `/api/memory/stats` counts climbing — accumulated experience.

_Built-by-us callout:_ `memory/vectors.ts` ($vectorSearch), `memory/policy.ts`
(outcome-conditioned gate), `memory/store.ts`.

### 2:50–3:30 — The five-minute meeting, killed (Gemini Live API)

- Frame it: "Instead of breaking a teammate's focus to ask what they're up to,
  you ask PodMan."
- Open the live voice conversation. Ask out loud: _"PodMan, what is everyone
  working on, and where is the collision detector implemented?"_
- It answers with **real tool calls** — `search_repo`, git history, current
  collisions — not guesses.
- "This is the **Gemini Live API**, streaming speech-to-speech over LiveKit, with
  custom function tools we wrote so it grounds every answer in the actual repo
  and live state. That's the status sync, answered in seconds, with zero recovery
  tax on anyone else."

_Built-by-us callout:_ `agents/podman-live-conversation/agent.py`.

### 3:30–3:50 — Stack + close

- "All on **DigitalOcean** — static frontend, API, and agent workers, supervised
  by systemd. The ambient score is **Gemini Lyria** generated per pod through the
  Interactions API."
- Close: "Engineering ability stopped being the bottleneck — coordination is.
  PodMan gives a whole team real-time awareness without the interruptions, catches
  collisions before they cost an afternoon, and learns each team's dynamics so it
  helps more over time. Saved focus, multiplied across every teammate. That's
  continual learning, shipped."

### 3:50–4:00 — Buffer / Q&A handoff

---

## Sponsor-prize coverage (say each at least once)

| Prize            | Spoken moment                                                                    | Segment                |
| ---------------- | -------------------------------------------------------------------------------- | ---------------------- |
| **Gemini**       | Vision perception, Live API agent w/ tools, TTS voice, Lyria score               | 0:30, 1:05, 2:50, 3:30 |
| **LiveKit**      | "real screen shares over LiveKit", agent subscribes, TTS audio track, live voice | 0:30, 1:05, 3:30       |
| **MongoDB**      | "Atlas vector search recalling past events"                                      | 1:50                   |
| **DigitalOcean** | "all on DigitalOcean, systemd-supervised workers"                                | 3:30                   |

---

## If something breaks (live recovery)

| Failure                 | Recovery                                                                |
| ----------------------- | ----------------------------------------------------------------------- |
| Voice doesn't fire      | Cut to the card; say the line aloud; cards are the default path anyway. |
| Live conversation drops | Skip 2:50–3:30; lean longer on the learning beat.                       |
| Collision won't trigger | Use the backup recording for that beat; keep narrating.                 |
| Agent flapping          | Pre-checked — but if so, `systemctl restart podman-platform-agent`.     |

**Rule:** never debug on stage. Narrate, fall back to recording, keep moving.

---

## Tight timing summary

| Time | Beat                                                       |
| ---- | ---------------------------------------------------------- |
| 0:00 | Problem (coordination cost) + hook + original-work line    |
| 0:30 | Real-time team awareness — LiveKit + Gemini Vision         |
| 1:05 | The catch — collision caught before merge                  |
| 1:40 | Cross-channel overlap — research + code nudge              |
| 2:10 | **Continual learning — quiet + escalate**                  |
| 2:50 | The five-minute meeting, killed — Gemini Live conversation |
| 3:30 | DigitalOcean + Lyria + close                               |
| 3:50 | Buffer                                                     |
