# Gemini Integration Spec

Status: active / matches code.

PodMan uses Gemini for five jobs, all through the `@google/genai` SDK
(`GoogleGenAI`) with a single `GEMINI_API_KEY` (`GOOGLE_API_KEY` /
`GOOGLE_GENERATIVE_AI_API_KEY` also accepted):

1. **Vision** — turn screen frames into structured work context.
2. **Embeddings** — vector recall over past coordination events.
3. **TTS voice** — spoken urgent escalations over LiveKit.
4. **Live conversation** — a real-time voice agent teammates talk to.
5. **GenMedia (Lyria)** — a per-pod background score.

Collision detection and intervention text are **deterministic in code**, not
Gemini calls. PodMan does not ask Gemini "is this a conflict?" — that is decided
by `backend/src/collision/detector.ts` from fused vision + git truth. This is a
deliberate reliability choice for the live demo.

---

## 1. Vision — screen understanding

**Model:** `GEMINI_VISION_MODEL` (default `gemini-2.0-flash`)
**Code:** `backend/src/vision/gemini.ts` → `analyzeFrame()`

**Trigger:** the LiveKit agent samples a JPEG frame from each engineer's
screen-share track (not an HTTP upload — frames arrive over LiveKit).

**Input:** a single base64 JPEG, sampled at low media resolution.

**Output:** structured JSON via `responseJsonSchema` (no markdown parsing):

```ts
{
  mode: 'editing' | 'research', // browser/docs/SDK research vs editor work
  currentFile: string,          // open file path, e.g. src/auth/session.ts
  currentSymbol: string,        // function/class under the cursor
  activity: string,             // editing | reading | debugging | terminal | PR review
  hasUnpushedChanges: boolean,  // dirty git gutter / modified markers visible
  researchTopic: string,        // e.g. "LiveKit agents setup", for research mode
  researchSource: string,       // source domain, e.g. "docs.livekit.io"
  confidence: number            // 0..1
}
```

When a frame shows a browser/docs/SDK page instead of an editor, Gemini Vision
classifies it as `mode: "research"` and extracts the topic/source. That feeds the
cross-channel overlap detector: one teammate researching LiveKit docs while
another edits `livekit.py` becomes a collaboration nudge, not a merge-conflict
alert. Editor/IDE frames remain `mode: "editing"` and use the existing file,
symbol, activity, and dirty-change fields.

**Latency/cost levers (in code):**

- `thinkingConfig: { thinkingBudget: 0 }` — minimal thinking for the ambient loop.
- `mediaResolution: MEDIA_RESOLUTION_LOW` — smaller image tokens.
- Missing `confidence` defaults to `0.5`.

**Demo reliability:** large editor font, single window, visible file tab. This is
the primary lever for clean reads.

---

## 2. Embeddings — semantic recall

**Model:** `GEMINI_EMBEDDING_MODEL` (default `gemini-embedding-001`, 768 dims)
**Code:** `backend/src/memory/vectors.ts`

Each collision is embedded into a short memory text (`file`, `symbol`,
`engineers`, `severity`, unpushed flag) and stored on the `collisions` document.
On a new collision PodMan embeds the query and runs MongoDB Atlas `$vectorSearch`
(index `collision_embedding`) to recall similar past events and their outcomes.

**Provider order:** Voyage (`VOYAGE_API_KEY`, `voyage-4-lite`) is tried first when
present; Gemini embeddings are the fallback. Without either, recall degrades to
exact signature/file matching — the demo still works.

---

## 3. TTS voice — urgent escalation over LiveKit

**Model:** `GEMINI_LIVE_MODEL` (default `gemini-3.1-flash-tts-preview`)
**Default voice:** `GEMINI_TTS_VOICE` (default `Charon`)
**Code:** `backend/src/voice/live.ts` → `speak()` / `speakInRoom()`

Flow: a short, natural voice line is generated for a critical collision, returned
as audio, and published as a LiveKit microphone-source audio track. The track is
held for the audio duration plus tail/hold so browsers do not cut playout short.
Browser audio must be unlocked by a user gesture first. The frontend always
renders the `VOICE_CUE` text as a fallback. See `docs/livekit.md` for delivery.

---

## 4. Live conversation — real-time voice agent

**Model:** `GEMINI_CONVERSATION_MODEL` (default `gemini-3.1-flash-live-preview`)
**Code:** `agents/podman-live-conversation/agent.py` (Python LiveKit Agents,
`google.realtime.RealtimeModel`)

A teammate can start a live, streaming speech-to-speech session with PodMan. The
agent answers using **function tools** rather than guessing, including:

- `get_active_pod_context`, `get_recent_changes`, `search_team_memory`
- `search_repo`, `repo_recent_commits`, `repo_find_commits` (repo + git history)
- `record_conversation_note`
- `delegate_to_hermes`, `abort_active_hermes_job` (hands work to the async Hermes
  job runner — see `docs/hermes.md`)

Started/stopped via `POST /api/pods/:id/live-conversation/start` and `.../stop`.

---

## 5. GenMedia — Lyria background score

**Model:** `lyria-3-clip-preview` (override with `GEMINI_MUSIC_MODEL`)
**Endpoint:** Gemini **Interactions API** (`/v1beta/interactions`)
**Code:** `backend/src/voice/music.ts`

A pod-specific ~30s clip is generated through the Interactions API, cached in
MongoDB, and served via `GET /api/pods/:id/music` to play as ambient room audio.

---

## Cooldown

Per-pod cooldown (`NUDGE_COOLDOWN_MS`, default 180000 ms / 3 min) gates repeated
interventions. Implemented in `backend/src/memory/policy.ts`, not in Gemini.
