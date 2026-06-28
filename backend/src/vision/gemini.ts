import { GoogleGenAI, MediaResolution, Type } from '@google/genai';
import type { EngineerContext } from '@podman/shared';
import { env } from '../env.js';

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
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
    confidence: { type: Type.NUMBER, description: '0..1 confidence in this read' },
  },
  propertyOrdering: [
    'currentFile',
    'currentSymbol',
    'activity',
    'hasUnpushedChanges',
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
            text: "You are PodMan watching an engineer's screen. Identify what file/symbol they are working on and whether there are uncommitted edits. JSON only.",
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
    hasUnpushedChanges: parsed.hasUnpushedChanges,
    confidence: parsed.confidence ?? 0.5,
    observedAt: new Date().toISOString(),
  };
}
