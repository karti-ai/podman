# LiveKit Integration Spec

Status: active / matches code.

LiveKit is the real-time backbone for PodMan. It carries the **screen-share
perception input**, the **intervention data channel**, and **all room audio**
(Gemini TTS escalations, the Lyria score, and the live conversation agent). It is
load-bearing, not decorative.

---

## Room structure

- One LiveKit room per pod: `room = podId`.
- Engineers join as named participants (e.g. `alice`, `bob`).
- PodMan runs **multiple agent identities** in/around a room:
  - `podman-hermes` — the main vision + intervention agent (`@livekit/rtc-node`).
  - `podman-live-conversation` — the Gemini Live voice agent (Python).
  - short-lived `podman-hermes-job-*` publishers for async job events.
- A fixed identity matters: a second `podman-hermes` evicts the first and they
  flap, dropping interventions. systemd keeps exactly one alive in production.

---

## Engineer side (PWA)

**Joining:**

1. PWA calls `POST /api/token` with `{ podId, identity }` → `{ token, url }`.
2. LiveKit client connects with the token.
3. PWA publishes the screen track via `getDisplayMedia`.
4. PWA enables mic for ambient presence (used by the conversation agent).

**Receiving:**

- Subscribes to remote agent audio tracks (TTS, Lyria, conversation) and attaches
  them to a hidden audio sink.
- Browser autoplay restrictions apply: the PWA calls `room.startAudio()` from a
  user gesture (`Enable audio`, `Test PodMan voice`, `Share screen`, first room
  click).
- Listens on the data channel for cards and `VOICE_CUE` fallback text.

**Data channel listener (PWA):**

```ts
room.on(RoomEvent.DataReceived, (payload, participant) => {
  if (!participant?.identity.startsWith('podman-')) return;
  const msg = JSON.parse(new TextDecoder().decode(payload));
  // msg.type: COLLISION | ACK | GIT_REPORT | VOICE_CUE | HERMES_JOB_EVENT
  appendInterventionToFeed(msg);
});
```

All data messages share the `podman.intervention` topic (`DATA_TOPIC`).

---

## Agent side (`podman-hermes`)

**Framework:** `@livekit/rtc-node`. **Code:** `backend/src/agent/podman.ts`,
`backend/src/action/hermes.ts`, `backend/src/voice/live.ts`.

1. Subscribes to engineers' screen-share tracks and samples frames for Gemini
   Vision.
2. Detects collisions, gates them through the learning policy, then publishes a
   card/message on the data channel.
3. For critical collisions, generates Gemini TTS audio and publishes it as a
   microphone-source audio track, held for the audio duration plus a tail/hold
   window so subscribers finish playout. Voice publishing logs frame count,
   estimated duration, queued playout, and hold time for diagnostics.

---

## Live conversation agent (`podman-live-conversation`)

**Framework:** LiveKit Agents for Python (`AgentSession`, `function_tool`,
`google.realtime.RealtimeModel`). **Code:**
`agents/podman-live-conversation/agent.py`.

Joins the pod room on demand (`POST /api/pods/:id/live-conversation/start`),
streams speech-to-speech with Gemini Live, and answers using repo/git/memory
function tools. It can delegate long tasks to the async Hermes job runner and
narrate progress. See `docs/hermes.md`.

---

## Token endpoint

`POST /api/token` mints room tokens for engineers and agents alike. Grants:

- `roomJoin: true`
- `canPublish: true` (audio + screen)
- `canPublishData: true` (data channel)
- `canSubscribe: true`

Short-lived job publishers use `canSubscribe: false`.

---

## What LiveKit does NOT do in PodMan

- No video tracks published by agents.
- No mic transcription outside the live conversation agent.
- No custom SFU mixing — standard room behavior is sufficient.
