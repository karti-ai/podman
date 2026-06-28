import 'dotenv/config';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
function opt(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const env = {
  // LiveKit
  LIVEKIT_URL: req('LIVEKIT_URL'),
  LIVEKIT_API_KEY: req('LIVEKIT_API_KEY'),
  LIVEKIT_API_SECRET: req('LIVEKIT_API_SECRET'),
  // Gemini
  GEMINI_API_KEY: req('GEMINI_API_KEY'),
  GEMINI_VISION_MODEL: opt('GEMINI_VISION_MODEL', 'gemini-2.0-flash'),
  GEMINI_LIVE_MODEL: opt('GEMINI_LIVE_MODEL', 'gemini-live-2.5-flash'),
  // GitHub
  GITHUB_TOKEN: req('GITHUB_TOKEN'),
  GITHUB_REPO: req('GITHUB_REPO'), // owner/name
  // Mongo + Voyage
  MONGODB_URI: req('MONGODB_URI'),
  VOYAGE_API_KEY: opt('VOYAGE_API_KEY'),
  VOYAGE_EMBEDDING_MODEL: opt('VOYAGE_EMBEDDING_MODEL', 'voyage-4-lite'),
  // Server
  PORT: Number(opt('PORT', '8787')),
} as const;

export function repoParts(): { owner: string; repo: string } {
  const [owner, repo] = env.GITHUB_REPO.split('/');
  if (!owner || !repo) throw new Error('GITHUB_REPO must be "owner/name"');
  return { owner, repo };
}
