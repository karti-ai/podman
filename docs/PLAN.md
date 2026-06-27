# PodMan — Build Plan (12 hours)

> Replaces the original v1 plan. Architecture finalized. See `docs/idea.md` for concept, individual integration specs for details.

---

## What we are building

PodMan is a real-time AI team coordination agent. Engineers join a LiveKit room with earbuds. Each engineer's browser PWA captures their screen every 30s and sends it to Hermes (server-side orchestrator). Hermes uses Gemini Vision to extract structured context, detects coordination events (dependency ready, blocker, duplicate work), and speaks proactive nudges into the room via Gemini Live 2.5. MongoDB Atlas stores team state and an ownership map that persists across sessions — making PodMan faster and smarter each session.

**Hero demo moment:** PodMan detects Carol is blocked waiting for Alice's auth endpoint, warns Carol, then notifies Carol and Bob the moment Alice's server starts — without anyone sending a message.

---

## Must-have demo path

The minimum end-to-end flow required for a winning demo:

1. 3 engineers join a pod room via PWA (browser tab)
2. PWA captures screen frame every 30s, POSTs to Hermes
3. Hermes calls Gemini Vision → extracts `{ currentFile, inferredTask, confidence }`
4. Hermes writes to MongoDB (`engineer_states`, `ownership_map`)
5. Hermes runs event detection across all 3 engineers
6. `BLOCKER_DETECTED` or `DEPENDENCY_READY` event fires
7. Hermes generates 1–2 sentence nudge via Gemini
8. Hermes speaks nudge into LiveKit room via Gemini Live 2.5
9. Engineers hear it through earbuds
10. Frontend shows live nudge feed (data channel card)

---

## Nice-to-have (only if steps 1–10 done before hour 10)

- `DUPLICATE_WORK` event detection
- Ownership map cold-start demo (session 2 is visibly faster)
- GitHub state fusion (open PRs/branches per file)
- Polish: teammate status cards in UI, confidence indicator

---

## Cut immediately

- VS Code extension
- Mic transcription
- Manual task input fields
- Multilingual voice
- Full task management
- Slack / Linear integrations
- Webcam tracks
- Always-on raw screen surveillance (we sample every 30s by design)

---

## Team assignments

| Person | Owns | Hours |
|---|---|---|
| **Karti** | MongoDB Atlas wiring, `engineer_states` + `ownership_map` upsert logic, DO deploy, `/health` + env setup | 3–4h |
| **Ramis** | `POST /ingest` endpoint, Gemini Vision pipeline (`frameToContext`), confidence gate, frame compression in PWA | 3–4h |
| **Yahya** | Event detector (all 3 event types), nudge generator (Gemini text), cooldown logic, event + nudge MongoDB writes | 3–4h |
| **Everyone** | Gemini Live 2.5 + LiveKit Agents wiring (Hermes joins room + publishes voice) — highest integration risk, do together | 2h |

---

## Build order (strictly sequential by dependency)

### Hour 0–1: Plumbing (Karti)
- [ ] Confirm `.env` vars populated: `LIVEKIT_*`, `GEMINI_API_KEY`, `MONGODB_URI`
- [ ] `GET /health` returns `{ ok: true }`
- [ ] MongoDB connection established, collections initialized
- [ ] `POST /ingest` stub returns `{ ok: true }` (no logic yet)

### Hour 1–3: Frame capture + Vision pipeline (Ramis)
- [ ] PWA: `getDisplayMedia` frame capture every 30s → JPEG base64 (1280×720 max, quality 0.7)
- [ ] PWA: `POST /ingest` with `{ engineerId, podId, screenshotBase64, capturedAt }`
- [ ] Hermes: wire `@google/genai`, call `gemini-2.0-flash` with vision prompt
- [ ] Hermes: parse response, apply confidence gate (< 0.6 → discard)
- [ ] Hermes: upsert `engineer_states` in MongoDB

### Hour 1–3: MongoDB state layer (Karti, parallel with Ramis)
- [ ] `engineer_states` upsert function
- [ ] `ownership_map` upsert function (called after each `engineer_states` write)
- [ ] `events` insert function
- [ ] `nudges` insert function + cooldown query

### Hour 3–5: Event detection + nudge generation (Yahya)
- [ ] Hermes: after each state write, fetch all `engineer_states` for the pod
- [ ] Run Gemini event detection prompt → parse `{ event, involvedEngineers, file, reason }`
- [ ] On non-null event: check cooldown, generate nudge message via Gemini
- [ ] Write event + nudge to MongoDB
- [ ] Log to console (voice wiring comes next)

### Hour 3–5: PWA active session UI (Zander, parallel)
- [ ] Active session screen (post-join): "PodMan is watching" + teammate status cards
- [ ] Data channel listener: append nudge to live feed on receive
- [ ] Nudge feed: last 5 nudges, timestamped, engineer names highlighted

### Hour 5–7: Gemini Live 2.5 + LiveKit Agents voice (everyone)
- [ ] Install LiveKit Agents SDK in backend
- [ ] Hermes joins pod room as `podman-hermes` participant on startup
- [ ] Wire Gemini Live 2.5 as voice provider in LiveKit Agents
- [ ] On nudge ready: publish audio into room
- [ ] Also publish data channel message for frontend card
- [ ] Test: voice audible through browser audio output

### Hour 7–9: Integration + demo rehearsal
- [ ] Full end-to-end test: 3 browser tabs, screen share, Hermes processes frames, nudge fires, voice heard
- [ ] Pre-stage demo laptops: large font, clear file names, single editor window
- [ ] Run demo script 2× — fix any timing issues
- [ ] DO deploy (Karti) — verify `/health` live

### Hour 9–10: Ownership map demo (if time)
- [ ] Load `ownership_map` on Hermes startup
- [ ] Session 1 cold-start (3 min to first nudge) vs session 2 warm-start (< 30s)
- [ ] Add "Session memory loaded" log visible in demo

### Hour 10–12: Polish + backup plan
- [ ] Record a backup video of the demo working end-to-end
- [ ] Rehearse 3× with real audio
- [ ] Fallback: Hermes runs locally if DO deploy is flaky

---

## Open risks

| Risk | Mitigation |
|---|---|
| Gemini Vision accuracy on screens | Large font, single editor window, file name visible in tab. Confidence gate discards bad frames. |
| Gemini Live 2.5 + LiveKit Agents wiring is unknown territory | Allocate hour 5–7 as a team. Have fallback: plain HTTP TTS → WAV → LiveKit audio track. |
| Frame POST latency | Compress JPEG to quality 0.7, max 1280×720. Target < 500ms round trip. |
| Event detection false positives | Cooldown (3 min between nudges). Pre-stage demo so events fire cleanly. |
| DO deploy fails on stage | Run Hermes local. PWA already defaults to `localhost:8787`. Zero demo impact. |

---

## Demo script (3 min)

**(0:00)** Three laptops visible. Alice, Bob, Carol join `demo-pod`. PodMan: *"PodMan online. I see Alice, Bob, and Carol. Let's build."*

**(0:20)** Alice opens `auth/middleware.ts` (big font, clearly visible). Hermes processes first frame. Ownership map: Alice → auth.

**(0:45)** Bob opens `frontend/login.tsx`. Carol's terminal shows `curl: connection refused`.

**(1:20) MONEY MOMENT 1 — BLOCKER_DETECTED:** PodMan speaks: *"Carol, looks like you're waiting on auth. Alice is actively building it in middleware.ts — hang tight."*

**(1:50)** Alice's server starts (visible in terminal). Hermes detects transition.

**(2:00) MONEY MOMENT 2 — DEPENDENCY_READY:** PodMan: *"Carol, Bob — Alice just got the auth endpoint running. You're clear to integrate."*

**(2:20)** Optional: show session 2 cold-start vs warm-start comparison.

**(2:45)** Close: *"PodMan — the teammate that sees what Slack can't."*
