import type { Room } from '@livekit/rtc-node';

/**
 * Speak a message into the LiveKit room using Gemini Live voice.
 * Stub: logs until Gemini Live audio track wiring is complete.
 */
export async function speak(_room: Room, message: string): Promise<void> {
  // TODO(voice): use Gemini Live streaming TTS -> publish audio track into room
  console.log(`[voice] ${message}`);
}
