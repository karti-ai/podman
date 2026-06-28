import { Buffer } from 'node:buffer';
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
  type LocalParticipant,
} from '@livekit/rtc-node';
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from '@google/genai';
import { AccessToken } from 'livekit-server-sdk';
import { DATA_TOPIC, type DataMessage } from '@podman/shared';
import { env } from '../env.js';

const SAMPLE_RATE = 24_000;
const CHANNELS = 1;
const FRAME_SAMPLES = SAMPLE_RATE / 10;
const SUBSCRIBER_READY_MS = 750;
const AUDIO_PREROLL_MS = 300;
const AUDIO_TAIL_MS = 300;
const VOICE_QUEUE_MS = 30_000;
const VOICE_TRACK_PREFIX = 'podman-hermes-voice';
const encoder = new TextEncoder();
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
let voiceQueue: Promise<void> = Promise.resolve();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ttsPrompt(message: string): string {
  return [
    'Speak this PodMan coordination alert as a calm, natural engineering teammate.',
    'Use warm human pacing, clear pronunciation, and a brief pause after the first sentence.',
    'Do not add extra words, labels, markdown, or sound effects.',
    '',
    message,
  ].join('\n');
}

async function publishVoiceCue(room: Room, message: string): Promise<void> {
  const cue: DataMessage = { type: 'VOICE_CUE', text: message };
  await room.localParticipant?.publishData(encoder.encode(JSON.stringify(cue)), {
    reliable: true,
    topic: DATA_TOPIC,
  });
}

async function unpublishVoiceTracks(localParticipant: LocalParticipant): Promise<void> {
  const publications = Array.from(localParticipant.trackPublications.values()).filter(
    (publication) => publication.name?.startsWith(VOICE_TRACK_PREFIX) && publication.sid,
  );
  for (const publication of publications) {
    await localParticipant.unpublishTrack(publication.sid!, true).catch((err) => {
      console.warn(`[voice] stale track cleanup failed: ${(err as Error).message}`);
    });
  }
}

function audioFrameFromBase64(data: string, mimeType?: string): AudioFrame | null {
  if (mimeType && !mimeType.includes('audio')) return null;
  const buf = Buffer.from(data, 'base64');
  if (buf.byteLength < 2) return null;
  const bytes = buf.byteLength % 2 === 0 ? buf : buf.subarray(0, buf.byteLength - 1);
  const samples = new Int16Array(bytes.byteLength / 2);
  for (let i = 0; i < samples.length; i += 1) samples[i] = bytes.readInt16LE(i * 2);
  return new AudioFrame(samples, SAMPLE_RATE, CHANNELS, samples.length / CHANNELS);
}

function audioFrames(message: LiveServerMessage): AudioFrame[] {
  const parts = message.serverContent?.modelTurn?.parts ?? [];
  const out: AudioFrame[] = [];
  for (const part of parts) {
    const data = part.inlineData?.data;
    if (!data) continue;
    const frame = audioFrameFromBase64(data, part.inlineData?.mimeType);
    if (frame) out.push(frame);
  }
  return out;
}

function framesFromPcmBase64(data: string, mimeType?: string): AudioFrame[] {
  const frame = audioFrameFromBase64(data, mimeType);
  if (!frame) return [];

  const samples = frame.data;
  const frames: AudioFrame[] = [];
  for (let offset = 0; offset < samples.length; offset += FRAME_SAMPLES) {
    const chunk = samples.slice(offset, Math.min(offset + FRAME_SAMPLES, samples.length));
    frames.push(new AudioFrame(chunk, SAMPLE_RATE, CHANNELS, chunk.length / CHANNELS));
  }
  return frames;
}

async function generateTtsFrames(message: string): Promise<AudioFrame[]> {
  const res = await ai.models.generateContent({
    model: env.GEMINI_LIVE_MODEL,
    contents: [{ parts: [{ text: ttsPrompt(message) }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: env.GEMINI_TTS_VOICE } } },
      temperature: 0.8,
    },
  });
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  return parts.flatMap((part) =>
    framesFromPcmBase64(part.inlineData?.data ?? '', part.inlineData?.mimeType),
  );
}

function fallbackVoiceLine(message: string): string {
  const clean = message.replace(/^heads up[.!]?\s*/i, '').trim();
  if (clean && clean !== message) return clean;
  return 'PodMan noticed a critical conflict. Please sync with the team before pushing.';
}

async function speakWithTts(source: AudioSource, message: string): Promise<void> {
  let frames: AudioFrame[];
  try {
    frames = await generateTtsFrames(message);
  } catch (err) {
    const fallback = fallbackVoiceLine(message);
    console.warn(`[voice] Gemini TTS retrying with fallback line: ${(err as Error).message}`);
    frames = await generateTtsFrames(fallback);
  }
  if (frames.length === 0) throw new Error('Gemini TTS returned no audio frames');
  console.log(`[voice] publishing Gemini TTS audio frames=${frames.length}`);
  for (const frame of frames) {
    await source.captureFrame(frame);
  }
}

async function speakWithLive(source: AudioSource, message: string): Promise<void> {
  let done: () => void = () => {};
  const donePromise = new Promise<void>((resolve) => {
    done = resolve;
  });
  const session: Session = await ai.live.connect({
    model: env.GEMINI_LIVE_MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: env.GEMINI_TTS_VOICE } } },
      temperature: 0.8,
    },
    callbacks: {
      onmessage: (event) => {
        void (async () => {
          for (const frame of audioFrames(event)) await source.captureFrame(frame);
          if (event.serverContent?.turnComplete || event.serverContent?.generationComplete) done();
        })();
      },
      onerror: (event) => {
        console.warn(`[voice] Gemini voice error: ${event.message}`);
        done();
      },
      onclose: done,
    },
  });

  session.sendClientContent({
    turns: [{ role: 'user', parts: [{ text: ttsPrompt(message) }] }],
    turnComplete: true,
  });

  await Promise.race([donePromise, new Promise((resolve) => setTimeout(resolve, 15_000))]);
  session.close();
}

async function waitForVoicePlayout(source: AudioSource): Promise<void> {
  if (source.queuedDuration <= 0) return;
  await Promise.race([
    source.waitForPlayout(),
    new Promise((resolve) => setTimeout(resolve, VOICE_QUEUE_MS + 2_000)),
  ]);
}

async function captureSilence(source: AudioSource, durationMs: number): Promise<void> {
  const samples = Math.max(1, Math.round((SAMPLE_RATE * durationMs) / 1000));
  await source.captureFrame(new AudioFrame(new Int16Array(samples), SAMPLE_RATE, CHANNELS, samples));
}

async function speakAudio(room: Room, message: string): Promise<void> {
  const localParticipant = room.localParticipant;
  if (!localParticipant) return;
  await unpublishVoiceTracks(localParticipant);
  const source = new AudioSource(SAMPLE_RATE, CHANNELS, VOICE_QUEUE_MS);
  const track = LocalAudioTrack.createAudioTrack(`${VOICE_TRACK_PREFIX}-${Date.now()}`, source);
  const options = new TrackPublishOptions();
  options.source = TrackSource.SOURCE_MICROPHONE;
  let publicationSid: string | undefined;

  try {
    const publication = await localParticipant.publishTrack(track, options);
    publicationSid = publication.sid;
    await delay(SUBSCRIBER_READY_MS);
    await captureSilence(source, AUDIO_PREROLL_MS);
    if (env.GEMINI_LIVE_MODEL.includes('tts')) await speakWithTts(source, message);
    else await speakWithLive(source, message);
    await captureSilence(source, AUDIO_TAIL_MS);
    await waitForVoicePlayout(source);
  } catch (err) {
    console.warn(`[voice] Gemini voice publish failed: ${(err as Error).message}`);
  } finally {
    if (publicationSid) {
      await localParticipant.unpublishTrack(publicationSid, true).catch((err) => {
        console.warn(`[voice] track unpublish failed: ${(err as Error).message}`);
      });
    }
    await source.close().catch(() => {});
  }
}

/**
 * Speak a message into the LiveKit room using Gemini audio. A data-channel
 * VOICE_CUE is sent first so clients still get the cue if audio generation or
 * publishing fails.
 */
export async function speak(room: Room, message: string): Promise<void> {
  await publishVoiceCue(room, message);
  voiceQueue = voiceQueue.catch(() => {}).then(() => speakAudio(room, message));
  await voiceQueue;
}

export async function speakInRoom(roomName: string, message: string): Promise<void> {
  const room = new Room();
  try {
    const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity: `podman-voice-${Date.now()}`,
      name: 'PodMan voice',
      ttl: '5m',
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    await room.connect(env.LIVEKIT_URL, await at.toJwt());
    await speak(room, message);
  } finally {
    await room.disconnect().catch(() => {});
  }
}
