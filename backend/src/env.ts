import 'dotenv/config';

/** Reads an env var, throwing if it is required but missing. */
function read(name: string, required = false): string {
  const value = process.env[name] ?? '';
  if (required && !value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),

  livekit: {
    url: read('LIVEKIT_URL'),
    apiKey: read('LIVEKIT_API_KEY'),
    apiSecret: read('LIVEKIT_API_SECRET'),
  },

  gemini: {
    apiKey: read('GEMINI_API_KEY'),
    visionModel: process.env.GEMINI_VISION_MODEL ?? 'gemini-3.5-flash',
    liveModel: process.env.GEMINI_LIVE_MODEL ?? '',
  },

  github: {
    token: read('GITHUB_TOKEN'),
    repo: read('GITHUB_REPO'),
  },

  mongo: {
    uri: read('MONGODB_URI'),
  },

  voyage: {
    apiKey: read('VOYAGE_API_KEY'),
  },
} as const;
