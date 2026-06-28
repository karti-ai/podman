# Gemini Integration Spec

PodMan uses Gemini for two distinct jobs: **vision** (understanding screens) and **voice** (urgent voice cues).

---

## 1. Vision — Screen Understanding

**Model:** `gemini-2.0-flash` (fast, cheap, strong multimodal)

**Trigger:** every 30s per active engineer, when Hermes receives a `POST /ingest` frame

**Input:** base64-encoded JPEG, max 1280×720, ~50–80KB after compression

**Prompt:**

```
You are analyzing a software engineer's screen during a coding session.
Extract the following JSON. If you cannot determine a field with confidence above 0.7, set it to null.

{
  "currentFile": "string | null",         // active file visible in editor tab or title bar
  "inferredTask": "string | null",        // 1 sentence: what the engineer appears to be doing
  "terminalVisible": true | false,        // is a terminal or CLI panel visible
  "recentTerminalOutput": "string | null", // last meaningful line of terminal output if visible
  "confidence": 0.0–1.0                  // your overall confidence in this extraction
}

Respond with valid JSON only. No explanation. No markdown.
```

**Confidence gate:** if `confidence < 0.6`, Hermes discards the frame — no state update, no event detection triggered.

**Rate limit:** 1 call per engineer per 30s. With 3 engineers = 6 calls/min ≈ $0.002/min at Flash pricing.

**Demo setup requirement:** editors must have large font (18pt+), single window, file name clearly visible in tab. This is the primary reliability lever.

---

## 2. Event Detection — Coordination Awareness

**Model:** `gemini-2.0-flash` (text only, fast)

**Trigger:** after every successful state write to MongoDB, Hermes runs event detection over all active engineer contexts.

**Input:** JSON snapshot of all engineers' current states + ownership map

**Prompt:**

```
You are a team coordination agent. Below is the current state of each engineer on the team.

Engineer states:
{{engineerStates}}

Ownership map (who owns which files):
{{ownershipMap}}

Detect if any of these coordination events are occurring:
- DEPENDENCY_READY: an engineer who was blocked or waiting now has what they need because another engineer completed relevant work
- BLOCKER_DETECTED: an engineer appears stuck (same file, error in terminal, no progress) and another teammate could help
- DUPLICATE_WORK: two or more engineers are working on the same file simultaneously

If an event is detected, respond with:
{
  "event": "DEPENDENCY_READY" | "BLOCKER_DETECTED" | "DUPLICATE_WORK" | null,
  "involvedEngineers": ["engineerId", ...],
  "file": "string | null",
  "reason": "1 sentence explanation"
}

If no event, respond with { "event": null }.
Respond with valid JSON only.
```

---

## 3. Intervention Text Generation

**Model:** `gemini-2.0-flash` (text only)

**Trigger:** when event detection returns a non-null event

**Input:** event type + engineer names + file + reason

**Prompt:**

```
You are PodMan, a friendly AI teammate. Generate a short spoken message (1–2 sentences max) to notify the team about this coordination event.

Event: {{eventType}}
Engineers involved: {{engineerNames}}
File: {{file}}
Context: {{reason}}

Rules:
- Use first names only
- Be direct and specific
- Do not use filler words
- Sound natural when spoken aloud
- Do not start with "Hey" or "Attention"

Respond with the message text only.
```

**Example output:**

> "Carol — Alice just got the auth endpoint running. You're clear to integrate."

---

## 4. Voice Output — Gemini TTS via LiveKit

**Model:** `gemini-3.1-flash-tts-preview`
**Default voice:** `Charon`

**Integration:** Hermes asks Gemini TTS for short PCM audio, then publishes that audio into the room as a short LiveKit audio track. The code still preserves a Gemini Live path for future available Live models.

**Flow:**

1. Intervention message text generated (step 3)
2. Hermes wraps it in a natural-speaking prompt for Gemini TTS
3. Gemini returns audio with the configured prebuilt voice
4. Hermes publishes the audio into the LiveKit room
5. The frontend still renders the `VOICE_CUE` text, but browser TTS is off unless explicitly enabled

**Why Gemini TTS first:**

- Natural voice quality is better than browser `speechSynthesis`
- Tone and pacing can be steered directly in the prompt
- The voice name is configurable with `GEMINI_TTS_VOICE`
- LiveKit remains the delivery layer, so teammates hear the same room audio

---

## Cooldown

Per-pod cooldown of **3 minutes** between urgent voice cues. Prevents spam if multiple risks fire simultaneously. Implemented in Hermes, not in Gemini.
