# PodMan — Research findings (validated, June 2026)


## Gemini 3.5 realtime/vision APIs for PodMan (screen-understanding, Live voice/translate, Computer Use, Managed Agents)

All three organizer-named models are REAL and callable via the @google/genai JS/TS SDK (Gemini Developer API) as of June 2026. Reconciliation: (1) `gemini-3.5-flash` exists, is GA/stable, and is the right model for the vision-to-structured-JSON screen-understanding layer (1M ctx, supports responseJsonSchema). (2) `gemini-3.5-live-translate-preview` exists for the Live Translate feature, BUT it is translate-ONLY (audio in -> translated audio out, no general conversation, no video). For PodMan's "PodMan speaks" voice the correct general Live model is `gemini-3.1-flash-live-preview` (native audio, accepts text+image+audio+video over one WebSocket). There is no general-purpose `gemini-3.5-flash-live`; use 3.1-flash-live for voice and 3.5-live-translate only for the translation demo flourish. (3) `antigravity-preview-05-2026` is real — the Antigravity managed agent on the Interactions API (hosted Linux sandbox, can write/run code, browse web, manage files). Computer Use: the whats-new FAQ line saying "not supported in 3.5 Flash" is STALE — Google shipped built-in Computer Use INSIDE `gemini-3.5-flash` on 2026-06-24 (3 days ago) as public preview, covering browser/mobile/desktop. So Computer Use needs NO separate model now; it is a tool on 3.5-flash.

ARCHITECTURE RECOMMENDATION for PodMan: (a) Screen understanding = `gemini-3.5-flash` generateContent with image part + responseJsonSchema, run per-engineer at ~1 frame / 2-5s (NOT the Live API — cheaper, structured, no 1fps cap). Use mediaResolution "low" (280 tok/img) for ambient watching. (b) Voice out + barge-in = ai.live.connect with `gemini-3.1-flash-live-preview`, responseModalities:[AUDIO]. (c) Opening the sync PR: do NOT use Computer Use for this — use the GitHub REST API directly (deterministic, instant). Reserve Computer Use as a creative "PodMan drives the screen" demo moment only. (d) Antigravity/Interactions API: worth it ONLY for the self-improvement angle (background agent that analyzes conflict outcomes / generates the PR diff in a sandbox); skip for the realtime hot path (latency + cost). Keep realtime local.


**Model / IDs:** `gemini-3.5-flash — GA, vision + structured JSON (responseJsonSchema), 1M ctx / 65k out; ALSO hosts built-in Computer Use tool (preview, since 2026-06-24). Use for PodMan screen-understanding.`, `gemini-3.1-flash-live-preview — Live API native audio (text+image+audio+video in, audio out over WebSocket). Use for PodMan's voice / barge-in.`, `gemini-3.5-live-translate-preview — Live Translate ONLY (audio in -> translated audio out, 16kHz->24kHz). Optional translation demo, not general voice.`, `antigravity-preview-05-2026 — Antigravity managed agent via Interactions API; hosted Linux sandbox (code exec + web + files), stateful. Use for off-path self-improvement / PR drafting.`, `gemini-3-flash-preview — older preview of the Flash line; appears in some docs. Prefer gemini-3.5-flash.`, `gemini-live-2.5-flash-native-audio / gemini-2.5-flash-native-audio-preview-12-2025 — previous-gen Live native audio (fallback if 3.1-flash-live preview is unstable).`, `gemini-2.5-computer-use-preview-10-2025 — LEGACY standalone Computer Use model; superseded by built-in Computer Use in gemini-3.5-flash. Avoid for new work.`


**Packages**

- `@google/genai` — npm i @google/genai  
  _Official Google Gen AI JS/TS SDK (context7 id /googleapis/js-genai, latest v2.0.1). Single package covers generateContent (vision+structured), ai.live.connect (Live API WebSocket), and ai.interactions.create (Managed Agents/Antigravity). Use `new GoogleGenAI({ apiKey })`. For the browser PWA, keep the API key server-side (Node/backend) and proxy — do not ship the key in the Vite frontend. Live API can also be hit as a raw WebSocket from the browser if you mint ephemeral tokens, but easiest is backend relay._
- `ws (Node)` — npm i ws  
  _Only if you hand-roll the Live API WebSocket on the backend instead of using ai.live.connect. The SDK's live module already wraps this; prefer the SDK._


**Critical snippets**


### (a) Screen frame -> structured scene understanding (gemini-3.5-flash)
```typescript
import { GoogleGenAI, Type } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// frameJpegBase64 = one screenshot grabbed from the LiveKit screen-share track
const res = await ai.models.generateContent({
  model: "gemini-3.5-flash",
  contents: [{
    role: "user",
    parts: [
      { text: "You are PodMan watching an engineer's screen. Identify what they are working on. Return JSON only." },
      { inlineData: { mimeType: "image/jpeg", data: frameJpegBase64 } }
    ]
  }],
  config: {
    responseMimeType: "application/json",
    responseJsonSchema: {
      type: Type.OBJECT,
      properties: {
        app:        { type: Type.STRING, description: "e.g. VS Code, Chrome, terminal" },
        repo:       { type: Type.STRING },
        filePath:   { type: Type.STRING, description: "open file path if visible" },
        symbols:    { type: Type.ARRAY, items: { type: Type.STRING }, description: "functions/classes on screen" },
        activity:   { type: Type.STRING, description: "editing | reading | debugging | terminal | PR review" },
        feature:    { type: Type.STRING, description: "inferred feature/ticket" },
        unpushedHint:{ type: Type.BOOLEAN, description: "signs of uncommitted/unpushed local edits (dirty git gutter, modified markers)" }
      },
      propertyOrdering: ["app","repo","filePath","symbols","activity","feature","unpushedHint"]
    }
  }
});
const scene = JSON.parse(res.text); // guaranteed schema-valid
```
> This is PodMan's load-bearing 'see unpushed changes' layer. Use generateContent (one-shot per frame), NOT the Live API, so you get structured JSON, no 1fps cap, and ~280 tokens/img at low res. Throttle to one frame every 2-5s per engineer. To control vision cost add per-part `mediaResolution`/`resolution: "low"`.

### (b) PodMan speaks: Live API native audio (gemini-3.1-flash-live-preview)
```typescript
import { GoogleGenAI, Modality } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const session = await ai.live.connect({
  model: "gemini-3.1-flash-live-preview",   // general voice; NOT the translate model
  config: {
    responseModalities: [Modality.AUDIO],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
    systemInstruction: "You are PodMan, an ambient assistant for an engineering pod. Speak only to warn about imminent code collisions; be terse."
  },
  callbacks: {
    onopen:   () => console.log("PodMan voice live"),
    onmessage: (msg) => {
      // msg.serverContent.modelTurn.parts[].inlineData = base64 24kHz PCM -> play in browser
    },
    onerror:  (e) => console.error(e),
    onclose:  () => console.log("closed")
  }
});

// trigger PodMan to speak a warning (text in -> audio out):
session.sendClientContent({ turns: "Two engineers are both editing auth/session.ts. Warn them." });

// to feed live frames/mic instead:
// session.sendRealtimeInput({ media: { data: pcm16kBase64, mimeType: "audio/pcm;rate=16000" } });
// session.sendRealtimeInput({ media: { data: jpegBase64,  mimeType: "image/jpeg" } });
```
> Raw WS endpoint if not using SDK: wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=KEY . Audio: 16-bit PCM 16kHz in, 24kHz out. sendRealtimeInput uses VAD auto-response. Session limits: audio-only 15 min, audio+video only 2 min, video max 1 fps. For the optional Live Translate demo swap model to gemini-3.5-live-translate-preview and add translationConfig:{targetLanguageCode:'es'} (audio-in only).

### (d) Managed Agent / Antigravity (Interactions API) for self-improvement loop
```typescript
// Hosted sandbox agent: analyze a detected collision, draft the sync PR diff, run tests.
const interaction = await ai.interactions.create({
  model: "antigravity-preview-05-2026",
  input: "Two unpushed branches both touch auth/session.ts. Here is each diff... produce a merged sync patch and run the test suite.",
  tools: [{ type: "code_execution" }],
  // background: true  // async; resume later via the returned environment id
});
console.log(interaction.outputs);
```
> Runs in a Google-hosted ephemeral Linux container (reason+code+web+files). State persists across calls via the environment id; auto-compacts ctx ~135k tokens. Use OFF the realtime path — e.g. PodMan's 'refine its own intervention policy from outcomes' / generate-PR step. For simple compute you can use model:'gemini-2.5-flash' with the same code_execution tool. Skip for low-latency interventions (network round-trip).

**Gotchas**
- Computer Use FAQ is STALE: an older whats-new page says Computer Use is 'not supported in Gemini 3.5 Flash', but Google shipped built-in Computer Use INSIDE gemini-3.5-flash on 2026-06-24 (public preview, browser+mobile+desktop). No separate model needed. Computer Use requires mediaResolution 'ultra_high' on the screenshot (2,240 tokens/img) — expensive; do not use it on the ambient watch loop.
- Do NOT use Computer Use to open the sync PR in the demo hot path — it is a slow screenshot->action loop and flaky. Open the PR with the GitHub REST API (deterministic). Keep Computer Use as an optional 'PodMan takes the wheel' wow-moment only.
- gemini-3.5-live-translate-preview is TRANSLATE-ONLY: audio in -> translated audio out, no text input, no video, no free conversation. It cannot be PodMan's general voice. Use gemini-3.1-flash-live-preview for PodMan speaking. There is no general-purpose 'gemini-3.5-flash-live'.
- Live API session caps will bite the demo: audio-only 15 min, audio+VIDEO only 2 minutes, and video input is capped at 1 frame/sec. So DON'T push every engineer's screen video through the Live API. Do screen understanding via one-shot generateContent on gemini-3.5-flash (throttled frames), and reserve the Live session for short voice bursts. Use sessionResumption/contextWindowCompression config to survive reconnects.
- Vision cost scales with frames x engineers: image tokens are low=280, medium=560, high=1,120, ultra_high=2,240 per image (Gemini 3 family). 4 engineers x 1 frame/2s x low-res = ~33.6k img-tokens/min input. At $1.50/1M input that is cheap (~$0.05/min) but DON'T run high/ultra_high on the ambient loop. Set per-part resolution:'low' (per-content-item resolution is a Gemini 3 exclusive).
- API key security: @google/genai in a Vite frontend would leak the key. Run generateContent + Live + Interactions calls from the backend; for browser-side Live, mint ephemeral tokens or relay the WebSocket through your server.
- gemini-3.5-flash knowledge cutoff is Jan 2025 and it defaults to 'medium' thinking effort — for the fast ambient classifier set thinkingConfig to minimal/low to cut latency and cost; reserve higher thinking for the collision-reasoning step.
- Pricing snapshot (per 1M tokens, paid tier): gemini-3.5-flash $1.50 in / $9.00 out; gemini-3.1-flash-live-preview audio $3.00 in (or $0.005/min) / $12.00 out (or $0.018/min); gemini-3.5-live-translate-preview audio $3.50 in / $21.00 out. Live Translate output is the priciest — budget it. Free tier exists for the hackathon but is rate-limited.
- SDK field naming: structured output uses responseMimeType:'application/json' + responseJsonSchema (or responseSchema) — you MUST set the mime type or the schema is ignored. Live config uses responseModalities:[Modality.AUDIO]. Interactions API tools use {type:'code_execution'} objects, not the function-calling shape.

**Sources**
- https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5 (gemini-3.5-flash capabilities; note stale Computer-Use FAQ line)
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash (3.5 Flash specs, 1M/65k token limits, GA)
- https://ai.google.dev/gemini-api/docs/live-api/live-translate (gemini-3.5-live-translate-preview, translationConfig, audio-only)
- https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket (WebSocket endpoint, gemini-3.1-flash-live-preview, responseModalities AUDIO, PCM formats)
- https://ai.google.dev/gemini-api/docs/live-api/capabilities (Live model ids, 1fps video, session 15min/2min limits, speechConfig voices)
- https://ai.google.dev/gemini-api/docs/computer-use (Computer Use loop; gemini-3.5-flash / gemini-3-flash-preview model ids, browser/mobile/desktop)
- https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-computer-use-gemini-3-5-flash/ (built-in Computer Use in 3.5 Flash, 2026-06-24 public preview)
- https://ai.google.dev/gemini-api/docs/antigravity-agent (antigravity-preview-05-2026 managed agent)
- https://ai.google.dev/gemini-api/docs/custom-agents and https://blog.google/innovation-and-ai/technology/developers-tools/managed-agents-gemini-api/ (Interactions API / Managed Agents, hosted Linux sandbox, code_execution, background, environment resume)
- https://ai.google.dev/gemini-api/docs/pricing (per-token pricing for 3.5-flash, 3.1-flash-live, 3.5-live-translate; free tier)
- https://ai.google.dev/gemini-api/docs/media-resolution (image token counts low 280/medium 560/high 1120/ultra_high 2240; per-part resolution field, Gemini 3 exclusive)
- context7 /googleapis/js-genai v2.0.1 (generateContent responseJsonSchema, ai.live.connect callbacks, sendRealtimeInput media Blob, ai.interactions.create code_execution)

## LiveKit realtime stack for PodMan: browser screen-share + mic + cam publishing, server-side token minting, Node agent subscribing to a remote screen-share video track and grabbing raw frames for a vision model (the critical path), data-channel interventions back to engineers, and PodMan TTS voice into the room, plus how it composes with Gemini.

All four pieces are buildable today, but the architecture hinges on one finding: the LiveKit Agents-JS framework's integrated LIVE-VIDEO pipeline is currently Python-only (the vision/video doc marks "Node.js: not available; Python: available"). For a Node backend you drop to the lower-level @livekit/rtc-node SDK, where VideoStream + VideoFrame work fully. So PodMan's critical path (b) = a plain Node process that connects with @livekit/rtc-node (autoSubscribe:true, dynacast:true), listens for RoomEvent.TrackSubscribed, filters for the screen-share publication (publication.source === TrackSource.SOURCE_SCREENSHARE), wraps the RemoteVideoTrack in a VideoStream, async-iterates frame events, calls frame.convert(VideoBufferType.RGBA) to get a raw pixel buffer, encodes to JPEG/PNG (sharp), and ships it to Gemini vision. This sidesteps the framework limitation and gives full control over frame-rate throttling (critical for cost/latency: sample ~1 fps, not 30). Recommended component split: (a) Browser = livekit-client: createLocalScreenTracks({audio:true}) for screen + system audio, then setCameraEnabled/setMicrophoneEnabled for cam+mic; receive interventions via RoomEvent.DataReceived. (b) Token server = livekit-server-sdk: new AccessToken + addGrant({roomJoin, room, canPublish, canSubscribe, canPublishData}). (c)+(d) Vision/voice agent = @livekit/rtc-node: subscribe + frame grab + publishData(JSON, {reliable:true, topic}) back to engineers + publish a TTS audio track via AudioSource/AudioFrame.captureFrame. Two valid voice strategies: (A) full Agents-JS voice.AgentSession with the Google plugin (google.beta.realtime.RealtimeModel = Gemini Live native audio, model gemini-2.5-flash-native-audio-preview, or google.beta.TTS) — cleanest for the VOICE leg; (B) DIY: Gemini TTS bytes -> Int16 PCM -> AudioFrame -> AudioSource.captureFrame on a published mic-source track. Because Agents-JS cannot do the live VIDEO leg in Node, the pragmatic winning setup is a HYBRID: one rtc-node process owns the screen-frame vision loop, and either the same process (DIY audio) or a co-located Agents-JS worker owns the voice. If the team can tolerate Python for just the vision worker, Agents-JS Python gives the fully integrated path with VideoStream + llm.ImageContent — but Node + rtc-node keeps the whole backend in one language and is proven by the SDK's own examples.


**Model / IDs:** `gemini-2.5-flash-native-audio-preview-12-2025 (via @livekit/agents-plugin-google google.beta.realtime.RealtimeModel — confirm exact id with Gemini lane; PROJECT targets Gemini 3.5 Live API)`, `Gemini 2.5/3.5 Flash vision (via @google/genai, for per-frame screen understanding — exact id per Gemini research lane)`, `deepgram/nova-3 (example STT in Agents-JS, only if you add engineer voice input)`, `cartesia/sonic-3 (example TTS in Agents-JS inference; replaceable by Gemini TTS)`


**Packages**

- `livekit-client` — npm i livekit-client  
  _Browser SDK (frontend, React+Vite). Room, createLocalScreenTracks, LocalParticipant.setScreenShareEnabled/setCameraEnabled/setMicrophoneEnabled, publishData, RoomEvent.DataReceived/TrackSubscribed. This is what each engineer's PWA runs._
- `livekit-server-sdk` — npm i livekit-server-sdk  
  _Node backend token minting + room admin. AccessToken, VideoGrant fields, TokenVerifier, RoomServiceClient. Runs on your token endpoint (e.g. Express on DigitalOcean)._
- `@livekit/rtc-node` — npm i @livekit/rtc-node  
  _THE critical-path package for the PodMan agent. Lets a Node process join a room as a participant, subscribe to remote tracks, read raw video frames (VideoStream/VideoFrame.convert), publish audio frames (AudioSource/AudioFrame), and publishData. Native bindings (prebuilt binaries) — works on macOS/Linux; build it into your DigitalOcean container. Call dispose() on shutdown._
- `@livekit/agents` — npm i @livekit/agents  
  _Optional higher-level agent framework (defineAgent, JobContext, voice.AgentSession, cli.runApp). Great for the VOICE leg (STT/LLM/TTS/VAD orchestration). NOTE: its integrated live-VIDEO input is Python-only right now, so do not rely on it for screen-frame vision in Node._
- `@livekit/agents-plugin-google` — npm i @livekit/agents-plugin-google  
  _Gemini plugin for Agents-JS. Exposes google.beta.realtime.RealtimeModel (Gemini Live native audio, e.g. gemini-2.5-flash-native-audio-preview) and google.beta.TTS. Use for PodMan's spoken interventions if you adopt the AgentSession path._
- `@livekit/agents-plugin-silero` — npm i @livekit/agents-plugin-silero  
  _Only needed if you build a turn-taking voice.AgentSession (VAD). Not needed for one-way TTS announcements._
- `sharp` — npm i sharp  
  _Encode the RGBA/RGB24 buffer from VideoFrame.convert into JPEG/PNG before sending to Gemini (Gemini wants encoded image bytes, not raw RGBA). Fast native encoder; downscale here to cut tokens/latency._
- `@google/genai` — npm i @google/genai  
  _Google Gen AI SDK to call Gemini 2.5/3.5 Flash vision with the encoded screen frame (inlineData base64 image + prompt) and to get TTS audio bytes if going the DIY voice route. (Confirm exact model id with the Gemini research lane.)_


**Critical snippets**


### (a) BROWSER: publish screen-share (+system audio) then mic + camera (livekit-client)
```typescript
import { Room, RoomEvent, Track, createLocalScreenTracks, VideoPresets } from 'livekit-client';

const room = new Room({ adaptiveStream: true, dynacast: true });
await room.connect(LIVEKIT_WS_URL, token); // token from your server

// SCREEN SHARE + system audio. Triggers the browser picker.
// cursor:'always' keeps the pointer visible (useful for the vision model).
const screenTracks = await createLocalScreenTracks({ audio: true, resolution: VideoPresets.h1080.resolution });
for (const t of screenTracks) {
  await room.localParticipant.publishTrack(t.mediaStreamTrack, {
    source: t.kind === Track.Kind.Audio ? Track.Source.ScreenShareAudio : Track.Source.ScreenShare,
  });
}
// (Equivalent one-liner: await room.localParticipant.setScreenShareEnabled(true, { cursor:'always' }))

// MIC + CAMERA (separate prompts).
await room.localParticipant.setMicrophoneEnabled(true);
await room.localParticipant.setCameraEnabled(true);
```
> createLocalScreenTracks returns up to 2 tracks (video + optional system-audio); you must tag the screen video with Source.ScreenShare so the agent can find it. getDisplayMedia permission is implicit. Screen-share audio is a SEPARATE source from mic.

### (a) SERVER: mint an access token (livekit-server-sdk)
```typescript
import { AccessToken } from 'livekit-server-sdk';

export async function createToken(roomName: string, identity: string, name: string) {
  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity, name, ttl: '4h',
    metadata: JSON.stringify({ githubLogin: name }), // handy for collision attribution
  });
  at.addGrant({
    roomJoin: true, room: roomName,
    canPublish: true,      // engineer publishes screen/mic/cam
    canSubscribe: true,
    canPublishData: true,  // allows acking interventions
  });
  return await at.toJwt(); // async -> returns the JWT string
}

// The PodMan agent itself wants a token too: canSubscribe:true (read screens),
// canPublish:true (publish TTS audio), canPublishData:true (push interventions).
```
> toJwt() is async in current versions. Scope tightly: give engineers canSubscribe only if you also want them to hear PodMan. roomCreate is auto on first join so you usually don't need it.

### (b) CRITICAL PATH: Node agent subscribes to the screen-share track and grabs RGBA frames (@livekit/rtc-node)
```typescript
import {
  Room, RoomEvent, TrackKind, TrackSource,
  VideoStream, VideoBufferType, dispose,
  type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant,
} from '@livekit/rtc-node';
import sharp from 'sharp';

const room = new Room();
await room.connect(LIVEKIT_WS_URL, agentToken, { autoSubscribe: true, dynacast: true });

let lastSentAt = 0;
const SAMPLE_INTERVAL_MS = 1000; // ~1 fps to the vision model -> cheap + low latency

room.on(RoomEvent.TrackSubscribed,
  (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
    // Only the SCREEN SHARE video, not webcam, not mic.
    if (track.kind !== TrackKind.KIND_VIDEO || pub.source !== TrackSource.SOURCE_SCREENSHARE) return;

    const stream = new VideoStream(track);
    (async () => {
      for await (const event of stream) {       // event.frame is a VideoFrame
        const now = Date.now();
        if (now - lastSentAt < SAMPLE_INTERVAL_MS) continue; // THROTTLE: drop frames
        lastSentAt = now;

        const frame = event.frame;
        const rgba = frame.convert(VideoBufferType.RGBA); // -> { data:Uint8Array, width, height, type }
        // Encode to JPEG (Gemini wants encoded bytes, not raw RGBA). Downscale to save tokens.
        const jpeg = await sharp(Buffer.from(rgba.data), {
          raw: { width: rgba.width, height: rgba.height, channels: 4 },
        }).resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();

        await onScreenFrame(participant.identity, jpeg); // -> hand to Gemini vision
      }
    })();
  });
// on shutdown: await room.disconnect(); await dispose();
```
> THIS is PodMan's moat (catching unpushed local edits via the screen). Key points: (1) Agents-JS integrated video is Python-only, so use rtc-node directly. (2) VideoFrame.convert(VideoBufferType.RGBA) gives a packed 4-channel buffer; use RGB24 if you want 3 channels. (3) Throttle yourself — frames arrive at the publish FPS (could be 30). (4) Encode with sharp before sending; do not send raw RGBA. (5) Tag screen-share via pub.source so you never confuse it with the webcam.

### (b-alt) Same frame-grab using the Agents-JS framework (VideoStream + llm.ImageContent)
```typescript
// Inside a voice.Agent subclass (Agents-JS). Useful pattern even though integrated
// live-video is officially Python-first; the VideoStream loop itself runs in Node.
import { VideoStream } from '@livekit/rtc-node';
import { llm } from '@livekit/agents';

private latestFrame: VideoFrame | null = null;
private createVideoStream(track: Track): void {
  this.videoStream?.cancel();
  this.videoStream = new VideoStream(track);
  (async () => { for await (const e of this.videoStream!) this.latestFrame = e.frame; })();
}
async onUserTurnCompleted(chatCtx: llm.ChatContext, msg: llm.ChatMessage) {
  if (this.latestFrame) {
    msg.content.push(llm.createImageContent({ image: this.latestFrame }));
    this.latestFrame = null;
  }
}
```
> Buffer the latest frame and only attach it on a turn — avoids streaming every frame to the LLM. createImageContent accepts a VideoFrame directly. Good if you later move the vision worker to Python for the fully-supported path.

### (c) DATA CHANNEL: agent broadcasts an intervention; browser receives it
```typescript
// --- AGENT SIDE (@livekit/rtc-node) ---
const payload = new TextEncoder().encode(JSON.stringify({
  type: 'COLLISION', file: 'src/auth/session.ts',
  withIdentity: 'alice', message: 'Bob has unpushed edits to this file', action: 'OFFER_SYNC_PR',
}));
await room.localParticipant!.publishData(payload, {
  reliable: true, topic: 'podman.intervention',
  destination_identities: ['bob'], // omit to broadcast to the whole pod
});

// --- BROWSER SIDE (livekit-client) ---
import { RoomEvent } from 'livekit-client';
room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
  if (topic !== 'podman.intervention') return;
  const msg = JSON.parse(new TextDecoder().decode(payload));
  showInterventionCard(msg); // render the warn/diff/sync-PR card
});
```
> Reliable mode is ordered+retransmitted, cap ~15 KiB per packet (lossy cap ~1300 bytes). Use a topic to multiplex intervention types. destination_identities targets one engineer; omit for pod-wide. For larger payloads (a full diff), use byte/text streams (streamBytes/sendText) instead. Engineer ACKs (accepted PR? dismissed?) flow back via publishData — that closes the self-improvement / continual-learning loop.

### (d) PodMan VOICE: publish a TTS audio track from the agent (@livekit/rtc-node, DIY route)
```typescript
import { AudioSource, AudioFrame, LocalAudioTrack, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';

const SAMPLE_RATE = 24000, CHANNELS = 1; // match your TTS output (Gemini TTS ~24kHz)
const source = new AudioSource(SAMPLE_RATE, CHANNELS);
const track = LocalAudioTrack.createAudioTrack('podman-voice', source);
const opts = new TrackPublishOptions(); opts.source = TrackSource.SOURCE_MICROPHONE;
await room.localParticipant!.publishTrack(track, opts);

// ttsPcm: Int16Array of mono PCM from Gemini TTS (decode the returned audio to raw PCM16 first).
async function speak(ttsPcm: Int16Array) {
  const CHUNK = SAMPLE_RATE / 100; // 10ms frames
  for (let i = 0; i < ttsPcm.length; i += CHUNK) {
    const slice = ttsPcm.subarray(i, i + CHUNK); // NOTE: subarray, NOT slice (slice() is unstable in Node)
    await source.captureFrame(new AudioFrame(slice, SAMPLE_RATE, CHANNELS, slice.length));
  }
}
```
> Engineers hear this because they subscribe to the agent's mic-source track. CRITICAL gotcha straight from the SDK: when converting Uint8Array->Int16Array use buffer.subarray, never buffer.slice (slice is flagged unstable by Node and injects noise). Match SAMPLE_RATE to your TTS. captureFrame backpressures, so awaiting it paces playback in realtime.

### (d-alt) PodMan VOICE via Agents-JS + Gemini plugin (cleanest voice leg)
```typescript
import { voice } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';

const session = new voice.AgentSession({
  // Gemini Live native audio (single realtime model does the speaking):
  llm: new google.beta.realtime.RealtimeModel({ model: 'gemini-2.5-flash-native-audio-preview' }),
  // OR keep your own LLM and just use Gemini TTS:  tts: new google.beta.TTS(),
});
await session.start({ agent, room: ctx.room });
await session.generateReply({ instructions: 'Warn Bob: collision on session.ts; offer a sync PR.' });
```
> Lets LiveKit handle audio framing/turn-taking for you. Pair this voice worker with the SEPARATE rtc-node vision worker (snippet b) since the integrated video input is Python-only in Node. Confirm the exact Gemini model id with the Gemini research lane — names move fast.

**Gotchas**
- BIGGEST one: LiveKit Agents-JS integrated LIVE-VIDEO input is currently Python-only (the docs/agents/multimodality/vision/video page literally marks Node.js as not available). Do NOT architect PodMan's screen-vision around the Node AgentSession video helper. Use @livekit/rtc-node's VideoStream/VideoFrame directly (fully supported) OR run just the vision worker in Python. The voice leg is fine in Node.
- Frame-rate throttling is mandatory. A VideoStream yields frames at the publisher's FPS (up to 30). Sending every frame to Gemini will blow up cost and latency. Throttle to ~1 fps (or send only on a turn / on detected change). Buffer the latest frame and sample it.
- VideoFrame.convert() returns a NEW buffer; you must encode it (sharp -> JPEG/PNG) before sending to Gemini — vision models want encoded image bytes, not raw RGBA. Downscale (e.g. width 1280) at encode time to cut tokens.
- VideoBufferType values: ARGB, RGBA, ABGR, BGRA (32-bit), RGB24 (24-bit), I444/I422/I420/I420A/I010 (planar YUV), NV12. Incoming WebRTC frames are typically I420 (YUV); always convert to RGBA/RGB24 before handing to an image encoder.
- Audio gotcha (from the SDK's own README): when converting Uint8Array -> Int16Array, use buffer.subarray, NEVER buffer.slice — slice is marked unstable in Node and can append large bursts of noise to the audio.
- Screen-share AUDIO (system audio) is a DISTINCT source (Track.Source.ScreenShareAudio) from the microphone. createLocalScreenTracks({audio:true}) can return two tracks; publish each with the correct source or the agent will mis-route them.
- Tag and filter by source. On publish, set source: Track.Source.ScreenShare; on the agent, filter pub.source === TrackSource.SOURCE_SCREENSHARE so you never feed the webcam to the collision detector instead of the screen.
- getDisplayMedia (screen share) REQUIRES a user gesture and a secure context (https or localhost). As an installable PWA this is fine, but the demo must serve over HTTPS — plan TLS on the DigitalOcean deploy.
- publishData reliable cap is ~15 KiB; lossy ~1300 bytes (MTU). A full git diff can exceed this — use byte/text streams (localParticipant.streamBytes / sendText with a topic + writer.write/close) for large intervention payloads, and keep publishData for small JSON cards.
- toJwt() is ASYNC in current livekit-server-sdk versions (returns Promise<string>). Forgetting the await yields '[object Promise]' as the token and a confusing auth failure.
- @livekit/rtc-node uses native bindings (prebuilt per-platform binaries). It works on macOS for local dev and Linux in the DigitalOcean container, but make sure the install runs in the deploy image (not copied node_modules from macOS). Call dispose() (and room.disconnect()) on shutdown to free the native runtime.
- The agent's token needs canPublish (for its TTS audio track) AND canSubscribe AND canPublishData. A subscribe-only token cannot speak or intervene.
- For the continual-learning frame: feed engineer ACKs (was the collision real? did they accept the sync PR?) back over a data topic and persist them. That's the outcome signal that lets PodMan refine its intervention policy — it's the difference between 'dashboard' (banned) and 'agent that gets better the more it watches'.

**Sources**
- https://github.com/livekit/client-sdk-js (createLocalScreenTracks, setScreenShareEnabled/setCameraEnabled/setMicrophoneEnabled, Room.connect, RoomEvent.TrackSubscribed)
- https://github.com/livekit/node-sdks/blob/main/packages/livekit-server-sdk/README.md (AccessToken, addGrant VideoGrant fields, toJwt, install)
- https://github.com/livekit/node-sdks/blob/main/packages/livekit-rtc/README.md (Room.connect autoSubscribe/dynacast, AudioSource/AudioFrame publish, subarray-not-slice gotcha)
- https://context7.com/livekit/node-sdks/llms.txt (rtc-node publish audio/video RGBA frames, VideoBufferType.RGBA, publishData with reliable/topic/destination_identities)
- https://docs.livekit.io/agents/multimodality/vision/video (VideoStream frame-buffering pattern in TS + Python; Node.js NOT available for integrated live video; llm.createImageContent / ImageContent)
- https://docs.livekit.io/home/client/tracks/subscribe (VideoStream over a subscribed video track, iterate frames)
- https://docs.livekit.io/home/client/data/messages (publishData Uint8Array, RoomEvent.DataReceived, reliable 15KiB / lossy 1300B limits, topics)
- https://github.com/livekit/node-sdks/blob/main/packages/livekit-rtc/src/video_frame.ts (VideoFrame.data/width/height/type, convert(dstType, flipY?), getPlane; VideoBufferType enum: ARGB/RGBA/ABGR/BGRA/RGB24/I444/I422/I420/I420A/I010/NV12)
- https://github.com/livekit/agents-js (defineAgent, JobContext, voice.AgentSession, cli.runApp, ctx.connect)
- https://github.com/livekit/agents-js/blob/main/plugins/google/README.md (google.beta.realtime.RealtimeModel Gemini native audio, google.beta.TTS)
- https://github.com/livekit/agents-js/blob/main/agents-js/agents/src/voice/remote_session.ts (streamBytes for large reliable binary payloads with topic + destinationIdentities)

## GitHub integration for PodMan — official GitHub MCP server, Node consumption (MCP client SDK vs REST), and detecting unpushed-local collisions

RECOMMENDATION FOR THE HACKATHON: For PodMan's backend agent, call the GitHub REST API directly via Octokit (`octokit@5.0.5`) for the git-state half — it is faster to ship, fully typed, no extra process/transport to babysit, and you only need ~6 endpoints (list commits, list branches, compare refs, get file contents, create ref/branch, create PR). Keep the official GitHub MCP server as the "agent skill" surface IF a Gemini/Antigravity managed agent needs to discover tools dynamically; for that use the REMOTE server at https://api.githubcopilot.com/mcp/ with a PAT Bearer header (zero infra) and the stable MCP TypeScript client `@modelcontextprotocol/sdk@1.29.0`. Do NOT use Octokit AND MCP for the same calls — pick REST for deterministic backend logic, MCP only if you want the LLM to autonomously pick GitHub tools.

(a) OFFICIAL GITHUB MCP SERVER (github/github-mcp-server). Two ways to run: (1) REMOTE hosted by GitHub at `https://api.githubcopilot.com/mcp/` — transport type "http", no install; auth via OAuth 2.0 (recommended) OR a PAT sent as `Authorization: Bearer <PAT>`. (2) LOCAL Docker: `docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN=<token> ghcr.io/github/github-mcp-server` (stdio transport). Toolsets are grouped and toggled via `GITHUB_TOOLSETS="repos,pull_requests,git,context"` (default on: context, repos, issues, pull_requests, users); read-only safety via `GITHUB_READ_ONLY=1` (also `--read-only` flag / X-MCP-Readonly header on remote). EXACT TOOLS PodMan needs (verified): repos toolset -> `list_commits`, `get_commit` (commit details incl. diff/files), `list_branches`, `create_branch`, `get_file_contents`, `search_code`, `search_commits`; pull_requests toolset -> `list_pull_requests`, `pull_request_read` (one tool with a `method` arg: get/get_diff/get_files/get_reviews/get_status — get_diff returns the unified diff string), `create_pull_request`, `update_pull_request`, `merge_pull_request`; git toolset -> `get_repository_tree`. Note: there is NO dedicated compare-two-refs MCP tool — to diff two branches via MCP you must fall back to commits or the REST compare endpoint, which is another reason to use Octokit directly for collision diffing.

(b) NODE CONSUMPTION — MCP client SDK vs direct API. Direct Octokit (WINNER for hackathon): `npm i octokit` (v5.0.5) gives `new Octokit({auth: PAT})` then `octokit.rest.repos.listCommits/getCommit/listBranches/createRef`, `octokit.rest.pulls.list/create`, `octokit.rest.repos.compareCommitsWithBasehead` for branch-vs-branch diffs, and `octokit.rest.repos.getContent`. Typed, single dependency, no transport lifecycle. MCP client path (only if an LLM should auto-select tools): `npm i @modelcontextprotocol/sdk@1.29.0` — STABLE v1, imports use `.js` subpaths: `import { Client } from '@modelcontextprotocol/sdk/client/index.js'` and `import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'`; pass the PAT via `requestInit.headers`. Then `client.listTools()` / `client.callTool({name, arguments})`. CAUTION: Context7/some docs surface `@modelcontextprotocol/client@alpha` with bare subpaths (no `.js`) and an `authProvider` option — that is the v2 ALPHA, do NOT use it for the hackathon; the v1.29.0 shape above is the stable one matching the npm exports map I verified.

(c) CRITICAL ARCHITECTURE — detecting "two engineers on the same feature, not yet pushed". The GitHub API is BLIND to unpushed local commits and uncommitted working-tree edits — confirmed, this is PodMan's moat. Recommended two-tier fusion: TIER 1 (always-on, the demo hero) = realtime SCREEN VISION. Gemini 3.5 Flash (vision) reads each engineer's editor frame from the LiveKit screen-share track and emits a structured "active-edit" signal per person: { engineer, repoGuess, filePath(s) visible in tab/title bar/file tree, symbol/function under cursor, rough change summary }. PodMan maintains a live in-memory map filePath -> {engineers actively editing}. A COLLISION fires when 2+ engineers' vision signals point at the same file/feature AND git shows neither change is pushed yet. TIER 2 (optional, makes it bulletproof) = a tiny LOCAL GIT REPORTER: a ~30-line Node/bash sidecar each engineer runs that posts `git status --porcelain`, `git branch --show-current`, `git rev-list @{u}..HEAD` (count of unpushed commits) and `git diff --name-only` to PodMan over the LiveKit data channel or a WS endpoint every few seconds. This converts the fuzzy vision signal into ground-truth file paths + unpushed-commit counts. FUSION RULE for an intervention: collision = (same normalized file path or same feature/branch) seen across ≥2 engineers, where ≥1 has local-but-unpushed work (detected by Tier 2 unpushed count >0, OR inferred by Tier 1 when that file is NOT yet present in the remote branch via Octokit getContent/compare). Then PodMan: voice-warns + shows a card, pulls the remote file via Octokit getContent (or compareCommitsWithBasehead between their branches) to render the would-be diff, and offers create_branch + create_pull_request to sync. CONTINUAL-LEARNING framing: persist every {filePath, engineer, branch, wasRealCollision, acceptedPR} outcome to MongoDB Atlas + Voyage embeddings to learn code ownership, recurring conflict hotspots, and to tune the intervention threshold over the session.


**Model / IDs:** `Gemini 3.5 Flash (native vision + Computer Use) — reads each engineer's editor frame from the LiveKit screen-share track to emit structured active-edit signals (file paths, symbol under cursor, change summary)`, `Gemini 3.5 Live API — realtime audio for PodMan's voice intervention when a collision fires`, `Voyage AI embeddings (voyage-3 family) — embed collision/ownership outcomes into MongoDB Atlas vector search for the continual-learning memory layer`


**Packages**

- `octokit` — npm i octokit  
  _v5.0.5. THE recommended path for PodMan's deterministic git-state logic. Bundles @octokit/rest (v22.0.1). new Octokit({auth: process.env.GITHUB_PAT}). Fully typed, Node + browser/edge compatible. Use rest.repos.compareCommitsWithBasehead({owner,repo,basehead:'main...feature'}) for branch-vs-branch diffs since MCP has no compare tool._
- `@modelcontextprotocol/sdk` — npm i @modelcontextprotocol/sdk  
  _STABLE v1.29.0. Only needed if you want an LLM/managed-agent to auto-discover GitHub tools via MCP. Node-compatible. Imports MUST end in .js: '@modelcontextprotocol/sdk/client/index.js' and '@modelcontextprotocol/sdk/client/streamableHttp.js'. Pass PAT via transport requestInit.headers. Avoid the @modelcontextprotocol/client@alpha (v2) docs — different import shape._
- `github/github-mcp-server (remote, no install)` — connect to https://api.githubcopilot.com/mcp/ with header Authorization: Bearer <PAT>  
  _Zero-infra remote MCP server. Set GITHUB_READ_ONLY behavior via X-MCP-Readonly:true header and GITHUB_TOOLSETS via X-MCP-Toolsets header on remote, or env vars when local._
- `github/github-mcp-server (local Docker)` — docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN=<token> -e GITHUB_TOOLSETS=repos,pull_requests,git ghcr.io/github/github-mcp-server  
  _stdio transport; use only if you cannot reach the remote or want full local control. Add -e GITHUB_READ_ONLY=1 for safety during demos._


**Critical snippets**


### RECOMMENDED: direct Octokit for PodMan git-state + collision diffing
```typescript
import { Octokit } from 'octokit';
const gh = new Octokit({ auth: process.env.GITHUB_PAT });

// who pushed what recently
const { data: commits } = await gh.rest.repos.listCommits({ owner, repo, per_page: 20 });
const { data: branches } = await gh.rest.repos.listBranches({ owner, repo });

// branch-vs-branch diff (the would-be collision view) — MCP has NO compare tool, REST does
const { data: cmp } = await gh.rest.repos.compareCommitsWithBasehead({
  owner, repo, basehead: 'main...alice-feature'
});
const changedFiles = cmp.files?.map(f => f.filename) ?? [];

// is this file already on the remote branch? (if not, the edit on someone's screen is unpushed)
const exists = await gh.rest.repos.getContent({ owner, repo, path: 'src/auth.ts', ref: 'main' })
  .then(() => true).catch(() => false);

// PodMan's sync intervention: create branch + PR
const { data: mainRef } = await gh.rest.git.getRef({ owner, repo, ref: 'heads/main' });
await gh.rest.git.createRef({ owner, repo, ref: 'refs/heads/podman-sync', sha: mainRef.object.sha });
await gh.rest.pulls.create({ owner, repo, title: 'PodMan: sync auth.ts before collision', head: 'podman-sync', base: 'main', body: 'Alice & Bob both editing src/auth.ts (unpushed). Sync now.' });
```
> Single dependency, typed, no transport to manage. This is the fast hackathon path for the deterministic backend logic.

### OPTIONAL: consume the official GitHub MCP server from Node (stable v1)
```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('https://api.githubcopilot.com/mcp/'),
  { requestInit: { headers: { Authorization: `Bearer ${process.env.GITHUB_PAT}` } } }
);
const client = new Client({ name: 'podman', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools(); // discover create_pull_request, list_commits, pull_request_read, ...

const diff = await client.callTool({
  name: 'pull_request_read',
  arguments: { method: 'get_diff', owner, repo, pullNumber: 42 }
});

await client.callTool({
  name: 'create_pull_request',
  arguments: { owner, repo, title: 'PodMan sync', head: 'podman-sync', base: 'main', body: 'collision detected' }
});
```
> Use ONLY if you want an LLM/managed agent to auto-select GitHub tools. Note import paths end in .js — that is the stable v1.29.0 shape, NOT the alpha @modelcontextprotocol/client package.

### Tier-2 local git reporter sidecar (each engineer runs this) — fills the API blind spot
```bash
# unpushed commit count (invisible to GitHub API until pushed)
git rev-list --count @{u}..HEAD 2>/dev/null || echo 0
# uncommitted working-tree edits, machine-readable
git status --porcelain
# files touched but not yet committed
git diff --name-only
git branch --show-current
```
> Wrap in a ~30-line Node watcher that POSTs JSON {engineer, branch, unpushedCount, dirtyFiles[]} over the LiveKit data channel every few seconds. This turns the fuzzy vision signal into ground-truth file paths + proof the work is unpushed.

### Fusion rule (pseudo) — when PodMan fires a collision intervention
```typescript
// per-file map built from Tier-1 vision signals + Tier-2 reporter
const editors = activeEditsByFile.get(normalize(path)); // Set<engineer>
if (editors && editors.size >= 2) {
  const anyUnpushed = [...editors].some(e =>
    reporter[e]?.unpushedCount > 0 ||           // Tier 2 ground truth
    !remoteHasFile(path, branchOf(e))           // Tier 1 inference via Octokit getContent/compare
  );
  if (anyUnpushed) intervene({ file: path, engineers: [...editors] });
}
```
> Collision = same file/feature across >=2 engineers AND >=1 has local-but-unpushed work. anyUnpushed is the crux the GitHub API alone cannot answer.

**Gotchas**
- GitHub API is BLIND to unpushed local commits and uncommitted edits — this is by design and is exactly PodMan's moat. Never claim collision detection from git state alone; the vision layer (and/or the local reporter) is load-bearing, not decorative.
- The official GitHub MCP server has NO compare-two-refs tool. To diff branch-vs-branch (the core collision view) you MUST use the REST compare endpoint (octokit.rest.repos.compareCommitsWithBasehead, basehead 'main...feature'). Another reason to lead with Octokit.
- pull_request_read is ONE tool with a `method` argument (get / get_diff / get_files / get_reviews / get_status), not separate tools. get_diff returns the full unified diff as a string and has NO pagination — large PRs can return huge payloads and have crashed IDE clients (issue #2122). Cap/scope what you feed Gemini.
- MCP SDK package confusion: stable is @modelcontextprotocol/sdk@1.29.0 with .js subpath imports and PAT via requestInit.headers. Context7/alpha docs show @modelcontextprotocol/client (no .js, authProvider option) — that's the v2 ALPHA. Mixing them yields module-not-found / wrong-API errors. Pin v1 for the hackathon.
- PAT scopes: a fine-grained PAT needs Contents: Read (commits, branches, file contents), Pull requests: Read & Write (list + create PRs), and Metadata: Read (mandatory). A classic PAT needs the `repo` scope. Repos must be PUBLIC per hackathon rules, but a token is still required to CREATE branches/PRs.
- Hackathon rule reminder: do NOT make the pod grid/dashboard the hero (dashboards are a banned hero). Frame the GitHub integration as the proactive create_branch + create_pull_request intervention triggered by the realtime collision, not as a repo dashboard.
- Rate limits: PAT-authenticated REST is 5,000 req/hr. PodMan polling many repos/branches every few seconds will burn this fast — cache git state, use conditional requests (ETag), and prefer webhooks or longer poll intervals for push events.
- Remote MCP server toolset/read-only toggles on the hosted endpoint are set via request HEADERS (e.g. X-MCP-Toolsets, X-MCP-Readonly) since you can't pass env vars to a hosted server; only the local Docker run uses GITHUB_TOOLSETS / GITHUB_READ_ONLY env vars.
- Vision filePath extraction is fuzzy (editor tab text, breadcrumb, file-tree highlight). Normalize paths (strip workspace prefixes, lowercase on case-insensitive FS) before matching across engineers, or the same file from two screens won't match. The Tier-2 local reporter eliminates this ambiguity — strongly recommend shipping it for the demo's reliability.

**Sources**
- https://github.com/github/github-mcp-server
- https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/set-up-the-github-mcp-server
- https://github.blog/changelog/2025-06-12-remote-github-mcp-server-is-now-available-in-public-preview/
- https://github.blog/ai-and-ml/generative-ai/a-practical-guide-on-how-to-use-the-github-mcp-server/
- https://github.com/github/github-mcp-server/issues/2122
- https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md
- https://www.npmjs.com/package/@modelcontextprotocol/sdk
- https://octokit.github.io/rest.js/
- https://docs.github.com/en/rest/commits/commits?apiVersion=2022-11-28
- https://docs.github.com/en/rest/commits/commits#compare-two-commits
- https://www.npmjs.com/package/octokit

## DigitalOcean deployment for PodMan (realtime Node websocket/LiveKit backend, React Vite PWA, DB) + "Best DigitalOcean" prize strategy

RECOMMENDED ARCHITECTURE for the hackathon (fastest path that still wins "Best DigitalOcean"):

1) BACKEND (PodMan agent + LiveKit agent worker, Node + websockets) -> DigitalOcean App Platform "Web Service" deployed from your GitHub repo. App Platform natively supports websockets/wss, auto-TLS, deploy-on-push, and zero-config Node detection. It is dramatically faster than provisioning a Droplet. ONE important caveat: the LiveKit *agent* (the bot that joins the room to do Gemini vision) is an outbound worker, not an inbound HTTP server — it should be a separate App Platform component of type "Worker" (no http_port, no public route). Your token/REST server (issues LiveKit join tokens, serves the collision API/websocket to the frontend) is the "Web Service" with http_port. Run them as two components in ONE app spec.

2) FRONTEND (React + Vite PWA) -> App Platform "Static Site" component in the SAME app. Free tier (3 static sites free), auto-detects Vite's `dist` output, free TLS + CDN. Putting frontend + backend in one app gives you a single domain (clean for the demo, no CORS) — App Platform routes by path. Alternative: Vercel is also fine for the PWA and arguably faster DX, but keeping it on DO strengthens the "Best DigitalOcean" prize story. Recommendation: keep PWA on DO App Platform static site.

3) DATABASE -> Use MongoDB Atlas Sandbox (free, provided to attendees) for speed, OR DO Managed MongoDB if you want everything on DO. DO DOES offer Managed MongoDB (plus Postgres/MySQL/Valkey/Kafka/OpenSearch), starting ~$15/mo. For the prize, DO Managed MongoDB is a nice stack item but Atlas Sandbox is free and pairs with Voyage AI vector search out of the box. Recommendation: Atlas Sandbox for the memory/vector layer to save the $200 credit; mention DO Managed DB as the production path.

4) "openclaw" IS a real DO product. The user's "openclaw" = OpenClaw (formerly Moltbot/Clawdbot, by Peter Steinberger) — a viral open-source personal-AI-agent framework that DO promotes heavily with 1-Click Droplet deploy AND an App Platform path. It is a FRAMEWORK for always-on proactive agents connected to messaging (Slack/Discord/WhatsApp/Telegram). It is NOT required for PodMan and you should NOT rebuild on it (it's a personal assistant pattern, wrong shape for a team collision detector). BUT name-dropping/optionally wiring a PodMan notification channel through it, or simply deploying your custom agent on the same App Platform that DO markets for OpenClaw, is on-message for judges.

PRIZE STRATEGY ("Best DigitalOcean"): The strongest, simplest winning move is (a) deploy the whole PodMan stack (web service + worker + static site, ideally + Managed DB) on App Platform via a single app spec, AND (b) use DigitalOcean Gradient AI Serverless Inference for at least one model call (it is OpenAI-SDK-compatible, hosts Claude/GPT/Llama/Mistral via one MODEL_ACCESS_KEY at https://inference.do-ai.run/v1/). That way DO touches realtime hosting + inference + data, which is exactly the "built on DO" story judges reward. Note: Gemini is NOT on Gradient, so keep the load-bearing vision on Gemini Live (for the $5000 Gemini prize) and route a secondary call (e.g. the collision-summary/intervention-policy LLM, or embeddings fallback) through DO Gradient to legitimately claim DO usage.

CREDITS: Claim the $200 via the MLH/hackathon DO signup link (mlh.link/digitalocean-signup or the organizer-provided code). New accounts get $200 valid ~60 days after adding a payment method. Apply at signup or in Billing -> add promo code. App Platform free tier covers 3 static sites; the web service + worker + Managed DB draw from credits (well under $200 for a hackathon).


**Model / IDs:** `DO Gradient Serverless Inference: Anthropic Claude (incl. Claude Opus 4.6), OpenAI GPT-4o, Meta Llama 3, Mistral — all via OpenAI-compatible API at https://inference.do-ai.run/v1/ with one MODEL_ACCESS_KEY`, `NOT on DO: Google Gemini (keep Gemini Live vision on Google AI Studio / Gemini API directly)`


**Packages**

- `doctl (DigitalOcean CLI)` — brew install doctl   # then: doctl auth init  
  _Used to create/update the app from your app spec: doctl apps create --spec .do/app.yaml ; doctl apps update <id> --spec .do/app.yaml. Also doctl apps logs <id> for live logs during the demo._
- `openai (Node SDK) — for DO Gradient Serverless Inference` — npm i openai  
  _DO Gradient is OpenAI-API-compatible. Point baseURL at https://inference.do-ai.run/v1/ and use the MODEL_ACCESS_KEY. Lets you call Claude/GPT/Llama/Mistral on DO for the 'Best DigitalOcean' angle without changing SDKs._
- `livekit-server-sdk (Node)` — npm i livekit-server-sdk  
  _Token minting on the Web Service component. The LiveKit *agent* itself (joins rooms, does Gemini vision) runs as the Worker component._
- `ws / express` — npm i ws express  
  _Standard Node websocket stack; works on App Platform as long as the service binds 0.0.0.0:8080 and the service is a Web Service (publicly routable). Confirmed by DO's official sample-websocket repo._


**Critical snippets**


### Single App Platform app spec: static PWA + web (token/ws API) + worker (LiveKit agent)
```yaml
# .do/app.yaml  -> deploy: doctl apps create --spec .do/app.yaml
name: podman
region: nyc

static_sites:
  - name: web
    github:
      repo: <org>/Podman
      branch: main
      deploy_on_push: true
    source_dir: frontend
    build_command: npm ci && npm run build
    output_dir: dist          # Vite default; auto-detected if omitted
    routes:
      - path: /               # PWA served at the apex path

services:
  - name: api                 # token mint + collision REST + ws to the PWA
    github:
      repo: <org>/Podman
      branch: main
      deploy_on_push: true
    source_dir: backend
    run_command: node dist/server.js
    http_port: 8080           # MUST bind 0.0.0.0:8080, not localhost
    instance_size_slug: apps-s-1vcpu-1gb
    instance_count: 1
    routes:
      - path: /api            # ws upgrades over wss://<app>.ondigitalocean.app/api
    envs:
      - { key: LIVEKIT_API_KEY,    scope: RUN_TIME, type: SECRET }
      - { key: LIVEKIT_API_SECRET, scope: RUN_TIME, type: SECRET }
      - { key: GEMINI_API_KEY,     scope: RUN_TIME, type: SECRET }
      - { key: MODEL_ACCESS_KEY,   scope: RUN_TIME, type: SECRET }  # DO Gradient
      - { key: MONGODB_URI,        scope: RUN_TIME, type: SECRET }

workers:
  - name: podman-agent        # LiveKit agent: joins rooms, runs Gemini vision
    github:
      repo: <org>/Podman
      branch: main
      deploy_on_push: true
    source_dir: backend
    run_command: node dist/agent.js   # outbound worker: NO http_port, NO routes
    instance_size_slug: apps-s-1vcpu-1gb
    instance_count: 1
    envs:
      - { key: LIVEKIT_URL,        scope: RUN_TIME, value: wss://<your>.livekit.cloud }
      - { key: LIVEKIT_API_KEY,    scope: RUN_TIME, type: SECRET }
      - { key: LIVEKIT_API_SECRET, scope: RUN_TIME, type: SECRET }
      - { key: GEMINI_API_KEY,     scope: RUN_TIME, type: SECRET }
```
> Key design point: inbound HTTP/ws server = `service` (has http_port + route); the LiveKit agent that DIALS OUT to join rooms = `worker` (no port, no route). Both can live in the same repo/source_dir with different run_commands. Frontend talks to the API over wss because App Platform terminates TLS (always HTTPS).

### Frontend wss protocol selection (App Platform is always HTTPS)
```javascript
// On App Platform everything is served over 443/HTTPS, so ws:// will be blocked
// as mixed content. Pick the scheme from the page protocol:
const proto = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${proto}://${location.host}/api/collisions`);
```
> This is the #1 websocket gotcha DO calls out in their official sample-websocket repo. Hardcoding ws:// works locally but fails in prod.

### Call DigitalOcean Gradient Serverless Inference from Node (OpenAI-compatible)
```javascript
import OpenAI from 'openai';

// One MODEL_ACCESS_KEY unlocks Claude / GPT / Llama / Mistral on DO.
const client = new OpenAI({
  apiKey: process.env.MODEL_ACCESS_KEY,
  baseURL: 'https://inference.do-ai.run/v1/',
});

// e.g. summarize a detected collision / decide the intervention policy on DO
const res = await client.chat.completions.create({
  model: 'anthropic-claude-opus-4-6', // Claude Opus 4.6 is live on Gradient
  messages: [{ role: 'user', content: collisionContext }],
});
```
> This is the cheap, legitimate way to put DO inference in the loop for the 'Best DigitalOcean' prize WITHOUT giving up the load-bearing Gemini vision (Gemini is NOT on Gradient). Get the key in Control Panel: INFERENCE -> Manage -> Model Access Keys. Verify exact model id strings in the DO inference docs at deploy time.

### Minimal Dockerfile (only if buildpack auto-detect misbehaves)
```dockerfile
# App Platform auto-detects Node via buildpacks, so a Dockerfile is usually
# UNNECESSARY. Add one only if you need a custom build. Reference it with
# dockerfile_path: backend/Dockerfile in the component spec.
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 8080
CMD ["node", "dist/server.js"]
```
> Prefer NO Dockerfile for hackathon speed — let App Platform's Node buildpack handle it. Only add this if you hit a build edge case.

**Gotchas**
- Service vs Worker: the LiveKit AGENT must be a `worker` component (no http_port, no public route) — it dials out to join rooms. Only the token/API/ws server is a `service`. Putting the agent as a service with a port will make App Platform wait for a health check on a port nothing listens on and the deploy will fail.
- Bind to 0.0.0.0, not localhost/127.0.0.1. App Platform routes external traffic to 0.0.0.0:http_port (default 8080). Binding to localhost = silent 'no healthy upstream'.
- Websockets MUST use wss:// in production — App Platform always serves over 443/HTTPS, so ws:// triggers mixed-content blocking. Use the protocol-switch snippet. (This is DO's own documented #1 websocket pitfall.)
- Websockets only work on the publicly-routable web service, NOT on internal service-to-service ports. Route ws through the public app domain.
- Gemini is NOT available on DO Gradient inference (only Anthropic/OpenAI/Meta/Mistral). Keep your load-bearing realtime vision on Google's Gemini Live API (also protects the $5000 Gemini prize) and route a SECONDARY model call (collision summary / intervention-policy reasoning / embeddings) through DO Gradient to legitimately claim DO inference usage.
- App Platform free tier covers 3 STATIC sites only; the web service + worker + Managed DB consume credits/billing. Total for a hackathon is tiny (single small instances), well under $200, but it is not $0 — make sure the $200 credit is applied first.
- $200 credits are for NEW DO accounts, valid ~60 days, and require adding a payment method before they apply. Use the MLH/organizer DO link (e.g. mlh.link/digitalocean-signup) or the event promo code — a generic signup may only give the smaller standard trial.
- gVisor sandbox: App Platform runs containers under gVisor; a few exotic syscalls are unsupported. Standard Node + ws + LiveKit SDK are fine, but if a native dependency does something unusual, fall back to a Droplet for that component.
- Demo-safety rule: the hackathon bans 'dashboard-as-hero'. App Platform makes it trivial to expose the pod grid — keep the deployed hero route as the proactive intervention card/voice, not the grid.
- DON'T rebuild PodMan on OpenClaw. OpenClaw is a real DO-promoted product but it's a PERSONAL assistant framework (messaging-channel bot), the wrong shape for a multi-engineer collision detector. At most, wire a PodMan alert channel through it as a bonus, or just note you deploy on the same App Platform DO markets for OpenClaw.
- If you want EVERYTHING on DO for the prize, DO Managed MongoDB exists (~$15/mo) — but for speed and to save credits, the free MongoDB Atlas Sandbox + Voyage AI for the vector/memory layer is the pragmatic choice.

**Sources**
- https://github.com/digitalocean/sample-websocket
- https://www.digitalocean.com/community/questions/websocket-use-in-app-platform-wss
- https://docs.digitalocean.com/products/app-platform/details/limits/
- https://docs.digitalocean.com/products/app-platform/reference/app-spec/
- https://docs.digitalocean.com/products/app-platform/reference/dockerfile/
- https://github.com/digitalocean/sample-vite-react
- https://docs.digitalocean.com/products/app-platform/how-to/manage-static-sites/
- https://www.digitalocean.com/pricing/app-platform
- https://www.digitalocean.com/products/ai-platform
- https://docs.digitalocean.com/products/gradient-ai-platform/
- https://www.digitalocean.com/community/tutorials/serverless-inference-openai-sdk
- https://docs.digitalocean.com/products/inference/how-to/si-endpoints/
- https://docs.digitalocean.com/products/inference/how-to/model-access-keys/
- https://www.digitalocean.com/blog/claude-opus-4-6-gradient-ai-platform
- https://www.digitalocean.com/blog/openclaw-digitalocean-app-platform
- https://docs.digitalocean.com/products/marketplace/catalog/openclaw/
- https://docs.digitalocean.com/products/databases/
- https://www.digitalocean.com/pricing/managed-databases
- https://www.mlh.com/partners/digitalocean
- https://github.com/digitalocean/app_action