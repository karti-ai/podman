# PodMan — Demo Runbook (final, read-off)

> One page. Reflects the **current live state** (`podman.live`) as of the final hour.
> Companion to `docs/demo.md` (full 4-min script) — this is the de-risked version.

## ⛔ Read first — last-hour changes that affect the demo

1. **Suppression is DISABLED for the demo** (`shouldIntervene` only filters `info`).
   Every real collision now surfaces — good (no accidental silencing). **But the
   `docs/demo.md` 2:10 beat "it learned to stay QUIET / no card fires" will NOT
   work.** Do the **escalate** half only (below). Do not promise silence on stage.
2. **Do NOT redeploy prod.** The live build has demo code not on `main`
   (`userPodContext`); redeploying `main` would remove it *and* surface stale
   "SUPPRESSED" beats. If the auto-deploy timer is on, stop it before the run:
   `systemctl stop podman-hermes-sync-deploy.timer`.
3. **Never debug on stage.** Narrate, fall back to the backup recording, keep moving.

## ✅ Pre-flight (do once, before you start)

- [ ] `curl https://podman.live/health` → `{"ok":true}`
- [ ] Deploy timer stopped (above); confirm exactly one agent: `systemctl status podman-platform-agent`
- [ ] Browser open on the pod; **click "Enable audio"** in-room (TTS needs it)
- [ ] Backup recording cued on a second device
- [ ] Two screen-shares live (the two "engineers")

## 🎬 The 3-minute path (the coherent, working story)

| Time | Do | Say (land the value) |
|---|---|---|
| **0:00** | Pod view, two live screen tiles | "Coordination is the bottleneck now, not coding. PodMan watches everyone's work live — no one has to ask 'what are you on?'" |
| **0:30** | Point at tiles; show activity stream filling | "Real screen-shares over **LiveKit**; each frame → **Gemini Vision** returns file/symbol/activity — a perception layer, not a chatbot." |
| **1:05** | Two engineers edit the **same file**, unpushed | "GitHub can't see this — nothing's pushed. We fuse live screen context with **local git truth**." → **collision card** appears. |
| **1:40** | **Accept** the card | Real **GitHub sync-PR** is created + outcome recorded. "One tap closes the loop." |
| **2:10** | **Trigger the same collision again** | Card now says **"Seen before."** and escalates straight to the **Gemini TTS voice** cue. "It recalled the prior event from **MongoDB Atlas vector search** and escalated — that's the learning." |
| **2:35** | Cut to **GraphView** | "This graph is materialized **live from MongoDB right now** — and here's the **`learned_from` edge**: PodMan learned who owns this file from the accepted outcome. Not a mock." |
| **3:00** | Stack + close | "All on **DigitalOcean**, systemd-supervised; ambient score is **Gemini Lyria**. Coordination awareness, collisions caught before they cost an afternoon, memory that sharpens each session." |

## 🗣️ Sponsor coverage (say each ≥ once)
- **Gemini** — Vision (0:30), TTS voice (2:10), Lyria (3:00) — add Live conversation if time allows
- **LiveKit** — "real screen-shares over LiveKit" (0:30), TTS over LiveKit (2:10)
- **MongoDB** — "Atlas vector-search recall" + "graph materialized live from MongoDB" (2:10, 2:35)
- **DigitalOcean** — "all on DigitalOcean, systemd-supervised" (3:00)

## 🚑 If it breaks
| Failure | Recovery |
|---|---|
| Voice doesn't fire | Cut to the card, say the line aloud — cards are the default path |
| Collision won't trigger | Use the backup recording for that beat; keep narrating |
| Graph looks empty/odd | Reload once; if still off, narrate from the recording |
| Agent silent | Suspect a duplicate `podman-hermes` process, not the UI — but **don't fix on stage** |

## Optional (only if ahead of time): the five-minute-meeting killer
Open the live voice conversation; ask *"PodMan, what is everyone working on, and where is the collision detector?"* → answers via real tool calls (**Gemini Live API**). Skip entirely if tight on time or if it drops.

---
**The spine:** live awareness → collision caught pre-push → accept → **"Seen before." + voice + `learned_from` edge**. That's the win. Suppression/"stays quiet" is intentionally out this run.
