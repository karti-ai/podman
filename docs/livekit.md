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

- LiveKit client subscribes to remote Hermes audio tracks and attaches them to
  a hidden audio sink in the DOM.
- Browser autoplay restrictions still apply. The PWA calls `room.startAudio()`
  from user gestures such as first room click, `Enable audio`, `Test PodMan
  voice`, and `Share screen`.
- PWA also listens for data channel messages from Hermes for UI card updates and
  `VOICE_CUE` fallback text.

**Data channel listener (PWA):**

```ts
room.on(RoomEvent.DataReceived, (payload, participant) => {
  if (participant?.identity !== 'podman-hermes') return;
  const intervention = JSON.parse(new TextDecoder().decode(payload));
  // intervention: COLLISION, HERMES_MESSAGE, VOICE_CUE, ACK, or GIT_REPORT
  appendInterventionToFeed(intervention);
});
```

---

## Hermes side (PodMan LiveKit participant)

**Framework:** `@livekit/rtc-node`

**Startup:**

1. Hermes mints its own token via the same `createPodToken` function with `identity: 'podman-hermes'`
2. Connects to the configured room as `podman-hermes`
3. Publishes data-channel cards/messages and Gemini TTS audio tracks

**Voice delivery:**

1. Urgent intervention text is ready (from Gemini text generation)
2. Hermes sends a natural-speaking prompt to Gemini TTS
3. Gemini returns PCM audio using the configured voice
4. Hermes publishes the audio as a LiveKit microphone-source track
5. Hermes keeps the track published for the generated audio duration plus tail
   silence and a hold window. This avoids browser-side cutoff when LiveKit's
   queued playout signal returns before subscribers finish playing buffered
   audio.
6. All participants hear it after browser audio has been unlocked

**Data channel message (sent alongside audio):**

```ts
const intervention = {
  type: 'DEPENDENCY_READY' | 'BLOCKER_DETECTED' | 'DUPLICATE_WORK',
  message: string,        // the spoken text
  involvedEngineers: string[],
  file: string | null,
  sentAt: string,         // ISO timestamp
};
room.localParticipant.publishData(
  new TextEncoder().encode(JSON.stringify(intervention)),
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
- Voice publishing logs generated frame count, estimated duration, queued
  playout, and the final subscriber hold time for diagnostics.
- The backend keeps a Gemini Live path for future model availability, but the verified deployment path uses TTS.

---

## What LiveKit does NOT do in PodMan

- No video tracks from Hermes
- No mic transcription (not needed for v1)
- No SFU mixing — standard room behavior is sufficient
