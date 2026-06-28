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
const encoder = new TextEncoder();
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

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

/**
 * Speak a message into the LiveKit room using Gemini Live audio. A data-channel
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
    let done: () => void = () => {};
    const donePromise = new Promise<void>((resolve) => {
      done = resolve;
    });
    let session: Session | null = null;

    session = await ai.live.connect({
      model: env.GEMINI_LIVE_MODEL,
      config: { responseModalities: [Modality.AUDIO] },
      callbacks: {
        onmessage: (event) => {
          void (async () => {
            for (const frame of audioFrames(event)) await source.captureFrame(frame);
            if (event.serverContent?.turnComplete || event.serverContent?.generationComplete)
              done();
          })();
        },
        onerror: (event) => {
          console.warn(`[voice] Gemini Live error: ${event.message}`);
          done();
        },
        onclose: done,
      },
    });

    session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: message }] }],
      turnComplete: true,
    });

    await Promise.race([donePromise, new Promise((resolve) => setTimeout(resolve, 15_000))]);
    session.close();
    if (publication.sid) await room.localParticipant.unpublishTrack(publication.sid, true);
    await source.close();
  } catch (err) {
    console.warn(`[voice] Gemini Live publish failed: ${(err as Error).message}`);
    await source.close().catch(() => {});
  }
}
