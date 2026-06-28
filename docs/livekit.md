# LiveKit Integration Spec

LiveKit is the real-time backbone for PodMan. It handles room presence and voice delivery. It is load-bearing — not decorative.

---

## Room structure

- One LiveKit room per project pod: `room = podId`
- Engineers join as named participants (e.g. `alice`, `bob`)
- Hermes joins as `podman-hermes`
- All participants stay connected for the duration of the session

---

## Engineer side (PWA)

**Joining:**

1. PWA calls `POST /pods/:podId/token` → receives `{ token, url }`
2. LiveKit client connects to the room with the token
3. PWA publishes screen track via `getDisplayMedia` (used client-side for frame capture — Hermes does NOT subscribe to this track)
4. PWA sets mic enabled for ambient presence

**Receiving:**

- LiveKit client automatically receives Hermes audio track
- No special subscription needed — LiveKit delivers audio to all participants
- PWA also listens for data channel messages from Hermes for UI card updates

**Data channel listener (PWA):**

```ts
room.on(RoomEvent.DataReceived, (payload, participant) => {
  if (participant?.identity !== 'podman-hermes') return;
  const nudge = JSON.parse(new TextDecoder().decode(payload));
  // nudge: { type, message, involvedEngineers, file, sentAt }
  appendNudgeToFeed(nudge);
});
```

---

## Hermes side (LiveKit Agent)

**Framework:** LiveKit Agents (Node.js)

**Startup:**

1. Hermes mints its own token via the same `createPodToken` function with `identity: 'podman-hermes'`
2. Connects to the room on pod creation / first engineer joining
3. Registers as a LiveKit Agent with Gemini Live 2.5 as voice provider

**Voice delivery:**

1. Nudge message text is ready (from Gemini text generation)
2. Hermes passes text to Gemini Live 2.5 via LiveKit Agents voice pipeline
3. Audio streams into the room in real-time
4. All participants hear it

**Data channel message (sent alongside audio):**

```ts
const nudge = {
  type: 'DEPENDENCY_READY' | 'BLOCKER_DETECTED' | 'DUPLICATE_WORK',
  message: string,        // the spoken text
  involvedEngineers: string[],
  file: string | null,
  sentAt: string,         // ISO timestamp
};
room.localParticipant.publishData(
  new TextEncoder().encode(JSON.stringify(nudge)),
  { reliable: true }
);
```

---

## Token endpoint

Already implemented at `POST /pods/:podId/token`.

Hermes uses the same endpoint. Grants:

- `roomJoin: true`
- `canPublish: true` (for audio track)
- `canPublishData: true` (for data channel)
- `canSubscribe: true`

---

## Gemini Live 2.5 model

- Model ID: `gemini-live-2.5-flash` — confirm exact ID from LiveKit Agents + Gemini docs at build time
- LiveKit Agents has native Gemini Live integration — no manual audio encoding needed
- Hermes passes text string → Agents handles streaming audio publication

---

## What LiveKit does NOT do in PodMan

- Hermes does NOT subscribe to engineer screen tracks (frame capture happens client-side)
- No video tracks from Hermes
- No mic transcription (not needed for v1)
- No SFU mixing — standard room behavior is sufficient
