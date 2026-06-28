#!/usr/bin/env node
import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { MongoClient } from 'mongodb';
import { RoomServiceClient } from 'livekit-server-sdk';
import { config as loadEnv } from 'dotenv';

const envPath = process.env.DOTENV_CONFIG_PATH ?? (existsSync('.env') ? '.env' : 'backend/.env');
loadEnv({ path: envPath, quiet: true });

const strict = process.argv.includes('--strict');
const results = [];

const requiredEnv = [
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'GITHUB_TOKEN',
  'GITHUB_REPO',
  'MONGODB_URI',
];

const frontendEnv = ['VITE_BACKEND_URL', 'VITE_LIVEKIT_URL'];
const optionalEnv = ['VOYAGE_API_KEY', 'VOYAGE_EMBEDDING_MODEL'];
const doFetch = globalThis.fetch;

function add(name, status, detail = '') {
  results.push({ name, status, detail });
}

function isSet(name) {
  return !!process.env[name]?.trim();
}

function configuredGeminiKey() {
  const candidates = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'];
  for (const name of candidates) {
    const value = process.env[name]?.trim();
    if (!value) continue;
    if (/replace|todo|example|your|xxx/i.test(value) || value.length < 20) {
      throw new Error(`${name} looks like a placeholder or truncated key`);
    }
    return { name, value };
  }
  throw new Error('GEMINI_API_KEY is not set');
}

async function check(name, fn) {
  try {
    const detail = await fn();
    add(name, 'ok', detail);
  } catch (err) {
    add(name, 'fail', summarizeError(err));
  }
}

function summarizeProviderBody(text) {
  try {
    const parsed = JSON.parse(text);
    const error = parsed.error;
    if (error?.status || error?.message) {
      return [error.status, error.message].filter(Boolean).join(': ');
    }
  } catch {
    // Keep short plaintext bodies.
  }
  return text.slice(0, 240);
}

async function responseError(service, res) {
  const body = await res.text();
  return `${service} returned ${res.status}${body ? `: ${summarizeProviderBody(body)}` : ''}`;
}

function summarizeError(err) {
  return err instanceof Error ? err.message : String(err);
}

async function checkWorkspace() {
  const workspace = await readFile('pnpm-workspace.yaml', 'utf8');
  for (const pkg of ['frontend', 'backend', 'shared']) {
    if (!workspace.includes(`'${pkg}'`) && !workspace.includes(`- ${pkg}`)) {
      throw new Error(`pnpm-workspace.yaml missing ${pkg}`);
    }
  }
  return 'frontend, backend, and shared are listed';
}

function backendUrl() {
  const explicit = process.env.BACKEND_URL ?? process.env.VITE_BACKEND_URL;
  if (explicit) return explicit;
  if (requiredEnv.every(isSet)) return 'http://127.0.0.1:8787';
  throw new Error('BACKEND_URL or VITE_BACKEND_URL is not set');
}

function frontendUrl() {
  return process.env.FRONTEND_URL ?? process.env.VITE_BACKEND_URL ?? backendUrl();
}

async function checkFrontendShell() {
  const url = frontendUrl().replace(/\/$/, '');
  const res = await doFetch(`${url}/`);
  if (!res.ok) throw new Error(`GET / returned ${res.status}`);
  const html = await res.text();
  if (!html.includes('id="root"')) throw new Error('frontend HTML missing root mount node');

  const script = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
  if (!script) throw new Error('frontend HTML missing bundled script');

  const assetUrl = new URL(script, `${url}/`);
  const assetRes = await doFetch(assetUrl);
  if (!assetRes.ok) throw new Error(`frontend bundle returned ${assetRes.status}`);
  const bundle = await assetRes.text();
  if (bundle.length < 10_000) throw new Error('frontend bundle was unexpectedly small');
  return `${url}, bundle ${Math.round(bundle.length / 1024)} KiB`;
}

async function checkBackendHealth() {
  const url = backendUrl();
  const res = await doFetch(`${url.replace(/\/$/, '')}/health`);
  if (!res.ok) throw new Error(`GET /health returned ${res.status}`);
  const body = await res.json();
  if (body.ok !== true) throw new Error(`unexpected /health body: ${JSON.stringify(body)}`);
  return url;
}

async function checkBackendPods() {
  const url = backendUrl();
  const res = await doFetch(`${url.replace(/\/$/, '')}/api/pods`);
  if (!res.ok) throw new Error(`GET /api/pods returned ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(`unexpected /api/pods body: ${JSON.stringify(body)}`);
  return `${body.length} pod(s)`;
}

async function checkBackendToken() {
  const url = backendUrl();
  const res = await doFetch(`${url.replace(/\/$/, '')}/api/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      room: process.env.POD_ROOM ?? 'demo-pod',
      identity: 'doctor',
      name: 'Doctor',
    }),
  });
  if (!res.ok) throw new Error(`POST /api/token returned ${res.status}`);
  const body = await res.json();
  if (typeof body.token !== 'string' || body.token.split('.').length !== 3) {
    throw new Error('token response did not contain a JWT');
  }
  if (typeof body.url !== 'string' || !body.url)
    throw new Error('token response missing LiveKit URL');
  return `minted JWT for ${body.url}`;
}

async function checkLiveKitApi() {
  if (!isSet('LIVEKIT_URL')) throw new Error('LIVEKIT_URL is not set');
  if (!isSet('LIVEKIT_API_KEY')) throw new Error('LIVEKIT_API_KEY is not set');
  if (!isSet('LIVEKIT_API_SECRET')) throw new Error('LIVEKIT_API_SECRET is not set');
  if (process.env.LIVEKIT_URL.includes('REPLACE_ME')) {
    throw new Error('LIVEKIT_URL is still the local placeholder');
  }
  const httpUrl = process.env.LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  const svc = new RoomServiceClient(
    httpUrl,
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
  );
  const rooms = await svc.listRooms();
  return `${httpUrl}, ${rooms.length} room(s) visible`;
}

async function checkMongo() {
  if (!isSet('MONGODB_URI')) throw new Error('MONGODB_URI is not set');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db();
    await db.command({ ping: 1 });
    return `connected to ${db.databaseName}`;
  } finally {
    await client.close();
  }
}

async function checkVectorIndex() {
  if (!isSet('MONGODB_URI')) throw new Error('MONGODB_URI is not set');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db();
    const indexes = await db
      .collection('collisions')
      .listSearchIndexes('collision_embedding')
      .toArray();
    if (indexes.length === 0) throw new Error('Atlas Search index collision_embedding not found');
    return 'collision_embedding search index found';
  } finally {
    await client.close();
  }
}

async function checkGitHub() {
  if (!isSet('GITHUB_TOKEN')) throw new Error('GITHUB_TOKEN is not set');
  if (!isSet('GITHUB_REPO')) throw new Error('GITHUB_REPO is not set');
  const res = await doFetch(`https://api.github.com/repos/${process.env.GITHUB_REPO}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub repo check returned ${res.status}`);
  const body = await res.json();
  return body.full_name ?? process.env.GITHUB_REPO;
}

async function checkGeminiVision() {
  const key = configuredGeminiKey();
  const model = process.env.GEMINI_VISION_MODEL ?? 'gemini-2.0-flash';
  const res = await doFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(key.value)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Return only: ok' }] }] }),
    },
  );
  if (!res.ok) throw new Error(await responseError('Gemini vision check', res));
  const body = await res.json();
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!text.trim()) throw new Error('Gemini vision response had no text');
  return model;
}

async function checkGeminiVoiceModel() {
  const key = configuredGeminiKey();
  const model = process.env.GEMINI_LIVE_MODEL ?? 'gemini-3.1-flash-tts-preview';
  const res = await doFetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key.value)}`,
  );
  if (!res.ok) throw new Error(await responseError('Gemini model list', res));
  const body = await res.json();
  const names = (body.models ?? []).map((m) => m.name?.replace(/^models\//, ''));
  if (!names.includes(model)) throw new Error(`${model} not present in Gemini model list`);
  if (!model.includes('tts')) return model;

  const tts = await doFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(key.value)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Say clearly: PodMan voice check.' }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      }),
    },
  );
  if (!tts.ok) throw new Error(await responseError('Gemini voice check', tts));
  const ttsBody = await tts.json();
  const audio = ttsBody.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audio) throw new Error('Gemini voice response had no audio');
  return `${model}, generated ${Buffer.from(audio, 'base64').byteLength} audio bytes`;
}

async function checkVoyage() {
  if (!isSet('VOYAGE_API_KEY')) throw new Error('VOYAGE_API_KEY is not set');
  const model = process.env.VOYAGE_EMBEDDING_MODEL ?? 'voyage-4-lite';
  const res = await doFetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ input: 'podman deployment doctor', model, input_type: 'query' }),
  });
  if (!res.ok) throw new Error(await responseError('Voyage embedding check', res));
  const body = await res.json();
  const dims = body.data?.[0]?.embedding?.length;
  if (!dims) throw new Error('Voyage response did not contain an embedding');
  return `${model}, ${dims} dimensions`;
}

await check('workspace', checkWorkspace);

for (const name of requiredEnv) {
  add(`env:${name}`, isSet(name) ? 'ok' : 'fail', isSet(name) ? 'set' : 'missing');
}
try {
  const key = configuredGeminiKey();
  add(
    'env:GEMINI_API_KEY',
    'ok',
    key.name === 'GEMINI_API_KEY' ? 'set' : `using ${key.name} alias`,
  );
} catch (err) {
  add('env:GEMINI_API_KEY', 'fail', summarizeError(err));
}
for (const name of optionalEnv) {
  add(`env:${name}`, isSet(name) ? 'ok' : 'warn', isSet(name) ? 'set' : 'optional');
}
for (const name of frontendEnv) {
  add(
    `env:${name}`,
    isSet(name) ? 'ok' : strict ? 'fail' : 'warn',
    isSet(name) ? 'set' : 'required for production frontend builds',
  );
}

await check('frontend shell', checkFrontendShell);
await check('backend health', checkBackendHealth);
await check('backend pods', checkBackendPods);
await check('backend token minting', checkBackendToken);
await check('livekit room service', checkLiveKitApi);
await check('mongo ping', checkMongo);
await check('github repo access', checkGitHub);
await check('gemini vision model', checkGeminiVision);
await check('gemini voice model', checkGeminiVoiceModel);

if (isSet('VOYAGE_API_KEY')) {
  await check('voyage embeddings', checkVoyage);
  await check('atlas vector index', checkVectorIndex);
} else {
  add('voyage embeddings', 'warn', 'VOYAGE_API_KEY is optional; exact Mongo recall remains active');
  add('atlas vector index', 'warn', 'requires VOYAGE_API_KEY and Atlas Search index');
}

const failed = results.filter((r) => r.status === 'fail');
const warnings = results.filter((r) => r.status === 'warn');

for (const result of results) {
  const mark = result.status.toUpperCase().padEnd(4);
  console.log(`${mark} ${result.name}${result.detail ? ` - ${result.detail}` : ''}`);
}

console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      strict,
      failed: failed.length,
      warnings: warnings.length,
    },
    null,
    2,
  ),
);

if (strict && failed.length > 0) {
  process.exitCode = 1;
}
