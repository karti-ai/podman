import { Buffer } from 'node:buffer';
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  type Room,
} from '@livekit/rtc-node';
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from '@google/genai';
import { DATA_TOPIC, type DataMessage } from '@podman/shared';
import { env } from '../env.js';

const SAMPLE_RATE = 24_000;
const CHANNELS = 1;
const FRAME_SAMPLES = SAMPLE_RATE / 10;
const encoder = new TextEncoder();
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

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

function audioFrameFromBase64(data: string, mimeType?: string): AudioFrame | null {
  if (mimeType && !mimeType.includes('audio')) return null;
  const buf = Buffer.from(data, 'base64');
  if (buf.byteLength < 2) return null;
  const bytes = buf.byteLength % 2 === 0 ? buf : buf.subarray(0, buf.byteLength - 1);
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
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
    const chunk = samples.subarray(offset, Math.min(offset + FRAME_SAMPLES, samples.length));
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

async function speakWithTts(source: AudioSource, message: string): Promise<void> {
  for (const frame of await generateTtsFrames(message)) {
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

/**
 * Speak a message into the LiveKit room using Gemini audio. A data-channel
 * VOICE_CUE is sent first so clients still get the cue if audio generation or
 * publishing fails.
 */
export async function speak(room: Room, message: string): Promise<void> {
  await publishVoiceCue(room, message);
  if (!room.localParticipant) return;

  const source = new AudioSource(SAMPLE_RATE, CHANNELS);
  const track = LocalAudioTrack.createAudioTrack('podman-hermes-voice', source);
  const options = new TrackPublishOptions();
  options.source = TrackSource.SOURCE_MICROPHONE;

  try {
    const publication = await room.localParticipant.publishTrack(track, options);
    if (env.GEMINI_LIVE_MODEL.includes('tts')) await speakWithTts(source, message);
    else await speakWithLive(source, message);
    if (publication.sid) await room.localParticipant.unpublishTrack(publication.sid, true);
    await source.close();
  } catch (err) {
    console.warn(`[voice] Gemini voice publish failed: ${(err as Error).message}`);
    await source.close().catch(() => {});
  }
}
