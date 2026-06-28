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
3. PWA publishes screen track via `getDisplayMedia`
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

## Hermes side (PodMan LiveKit participant)

**Framework:** `@livekit/rtc-node`

**Startup:**

1. Hermes mints its own token via the same `createPodToken` function with `identity: 'podman-hermes'`
2. Connects to the configured room as `podman-hermes`
3. Publishes data-channel cards/messages and short Gemini TTS audio tracks

**Voice delivery:**

1. Nudge message text is ready (from Gemini text generation)
2. Hermes sends a natural-speaking prompt to Gemini TTS
3. Gemini returns PCM audio using the configured voice
4. Hermes publishes the audio as a short LiveKit track
5. All participants hear it

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

Already implemented at `POST /api/token`.

Hermes uses the same endpoint. Grants:

- `roomJoin: true`
- `canPublish: true` (for audio track)
- `canPublishData: true` (for data channel)
- `canSubscribe: true`

---

## Gemini voice model

- Model ID: `gemini-3.1-flash-tts-preview`
- Default voice: `Charon` (`GEMINI_TTS_VOICE`)
- Hermes generates Gemini TTS audio and publishes it as a LiveKit audio track.
- The backend keeps a Gemini Live path for future model availability, but the verified deployment path uses TTS.

---

## What LiveKit does NOT do in PodMan

- No video tracks from Hermes
- No mic transcription (not needed for v1)
- No SFU mixing — standard room behavior is sufficient
