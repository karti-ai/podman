import { GoogleGenAI, MediaResolution, Type } from '@google/genai';
import type { EngineerContext } from '@podman/shared';
import { env } from '../env.js';

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    mode: {
      type: Type.STRING,
      description:
        'editing when an IDE/editor/terminal is primary; research for browser docs/SDK pages',
    },
    currentFile: {
      type: Type.STRING,
      description: 'open file path if visible, e.g. src/auth/session.ts',
    },
    currentSymbol: { type: Type.STRING, description: 'function/class under the cursor' },
    activity: {
      type: Type.STRING,
      description: 'editing | reading | debugging | terminal | PR review',
    },
    hasUnpushedChanges: {
      type: Type.BOOLEAN,
      description: 'dirty git gutter / modified markers visible',
    },
    researchTopic: {
      type: Type.STRING,
      description: 'topic being researched when mode is research, e.g. LiveKit agents setup',
    },
    researchSource: {
      type: Type.STRING,
      description: 'source domain when mode is research, e.g. docs.livekit.io',
    },
    confidence: { type: Type.NUMBER, description: '0..1 confidence in this read' },
  },
  propertyOrdering: [
    'mode',
    'currentFile',
    'currentSymbol',
    'activity',
    'hasUnpushedChanges',
    'researchTopic',
    'researchSource',
    'confidence',
  ],
} as const;

export async function analyzeFrame(
  engineerId: string,
  podId: string,
  jpeg: Buffer,
): Promise<EngineerContext> {
  const res = await ai.models.generateContent({
    model: env.GEMINI_VISION_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              "You are PodMan watching an engineer's screen. Return JSON only. " +
              "If the primary window is an IDE/editor/terminal, set mode='editing' and identify the file, symbol, activity, and whether uncommitted edits are visible. " +
              "If the primary window is a browser/docs/SDK/reference page, set mode='research', leave currentFile empty unless a file path is clearly visible, and extract researchTopic plus researchSource as the source domain.",
          },
          { inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: SCHEMA,
      thinkingConfig: { thinkingBudget: 0 }, // minimal thinking: low latency/cost for ambient loop
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
    },
  });
  const parsed = JSON.parse(res.text ?? '{}') as Partial<EngineerContext>;
  return {
    engineerId,
    podId,
    currentFile: parsed.currentFile,
    currentSymbol: parsed.currentSymbol,
    activity: parsed.activity,
    mode: parsed.mode,
    researchTopic: parsed.researchTopic,
    researchSource: parsed.researchSource,
    hasUnpushedChanges: parsed.hasUnpushedChanges,
    confidence: parsed.confidence ?? 0.5,
    observedAt: new Date().toISOString(),
  };
}
