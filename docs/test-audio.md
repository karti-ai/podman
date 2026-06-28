# Shared Test Audio — pod-wide connectivity check

> Spec for the `frontend/src/livekit/useBeat.ts` + `PodView.tsx` test-audio
> behavior and the additive `BEAT_STOP` data message. Satisfies the
> documentation-first gate for those files.

## Why

The **Test audio** button is PodMan's pre-flight check that the LiveKit audio
path works for the whole pod — the same path the urgent Gemini-TTS voice
escalation rides on. Today the beat is published correctly but its on/off state
is **local to the publisher**: teammates can't see it's playing and can't stop
it. This makes it a shared, pod-wide toggle so a judge sees the state flip on
every screen at once.

## Behavior

- Any participant clicks **Test audio** → they publish the `podman-beat` audio
  track (Web Audio, `lib/beat.ts`). Everyone auto-subscribes and hears it.
- The shared on/off state is **derived from the track's presence**, not a synced
  flag — so it self-syncs across joins/leaves and can't drift from reality. The
  publisher is the **owner**.
- Anyone can stop it:
  - Owner clicks **Stop audio** → unpublishes its own track directly.
  - Non-owner clicks **Stop (`<owner>`'s)** → sends `BEAT_STOP`; the owner
    unpublishes. (LiveKit forbids unpublishing another participant's track, so a
    request is the only way.)
- The Status card shows `publishing` / `<owner> playing` / `ready`, and the
  waveform animates (`active`) for everyone while the test is live.

## State derivation (source of truth = the track)

`useBeat(room)` returns `{ on, by, mine }`, recomputed from the presence of a
track named `podman-beat` across `localParticipant` + `remoteParticipants` on
these events: `LocalTrackPublished/Unpublished`, `TrackPublished/Unpublished`,
`TrackSubscribed/Unsubscribed`, `ParticipantConnected/Disconnected`. Owner
disconnect and late-join sync therefore need no extra messaging.

## Contract (additive)

`shared/src/messages.ts` — one new message on the existing `podman.intervention`
data topic:

    | { type: 'BEAT_STOP' }   // any participant → owner: stop the shared beat

Additive to the `DataMessage` union; existing consumers ignore unknown types.
**No backend / API change.**

## Known limitation (LiveKit constraint)

A client can only unpublish **its own** tracks, so a non-owner's **Stop** is a
`BEAT_STOP` _request_ the owner must honor. If the owner disconnects **uncleanly**
(crash / network drop), the SFU keeps the track published until it times the
participant out — during that window the beat keeps playing and non-owners can't
stop it. A clean disconnect clears it immediately via `ParticipantDisconnected`.
Demo mitigation: have the same person who starts the test also stop it.

## Files

- `shared/src/messages.ts` — `BEAT_STOP` message (additive).
- `frontend/src/livekit/useBeat.ts` — `useBeat(room)` hook.
- `frontend/src/components/PodView.tsx` — button label, status line, waveform
  `active` driven by the hook.
- `frontend/src/lib/beat.ts` — unchanged (existing Web-Audio beat source).
