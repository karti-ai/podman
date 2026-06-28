#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { config as loadEnv } from 'dotenv';

const image = process.env.VERIFY_CONTAINER_IMAGE ?? 'podman-backend';
const runtime = process.env.VERIFY_CONTAINER_RUNTIME ?? 'docker';
const port = Number(process.env.VERIFY_CONTAINER_PORT ?? 8799);
const baseUrl = `http://127.0.0.1:${port}`;
const runId = `${process.pid}-${Date.now()}`;
const apiContainer = `podman-verify-api-${runId}`;
const agentContainer = `podman-verify-agent-${runId}`;
const envPath = process.env.DOTENV_CONFIG_PATH ?? (existsSync('.env') ? '.env' : 'backend/.env');
const doFetch = globalThis.fetch;

loadEnv({ path: envPath, quiet: true });

const containerEnv = {
  PORT: String(port),
  LIVEKIT_URL: process.env.LIVEKIT_URL ?? 'REPLACE_ME',
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY ?? 'verify-key',
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET ?? 'verify-secret',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? 'verify-gemini',
  GEMINI_VISION_MODEL: process.env.GEMINI_VISION_MODEL ?? 'gemini-2.0-flash',
  GEMINI_LIVE_MODEL: process.env.GEMINI_LIVE_MODEL ?? 'gemini-3.1-flash-tts-preview',
  GEMINI_TTS_VOICE: process.env.GEMINI_TTS_VOICE ?? 'Charon',
  GEMINI_EMBEDDING_MODEL: process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? 'verify-github',
  GITHUB_REPO: process.env.GITHUB_REPO ?? 'karti-ai/podman',
  MONGODB_URI: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/podman',
  VOYAGE_API_KEY: process.env.VOYAGE_API_KEY ?? '',
  VOYAGE_EMBEDDING_MODEL: process.env.VOYAGE_EMBEDDING_MODEL ?? 'voyage-4-lite',
};

function runContainer(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(runtime, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function envArgs(extra = {}) {
  return Object.entries({ ...containerEnv, ...extra }).flatMap(([key, value]) => [
    '--env',
    `${key}=${value}`,
  ]);
}

function fail(message) {
  throw new Error(message);
}

async function assertPodmanAvailable() {
  const result = await runContainer(['--version']);
  if (result.code !== 0) fail(`${runtime} is not available: ${result.stderr.trim()}`);
}

async function assertImageExists() {
  const result =
    runtime === 'podman'
      ? await runContainer(['image', 'exists', image])
      : await runContainer(['image', 'inspect', image]);
  if (result.code !== 0) {
    fail(
      `container image "${image}" does not exist locally; build it before running this verifier`,
    );
  }
}

async function removeContainer(name) {
  await runContainer(['rm', '-f', name]);
}

async function startContainer(name, extraEnv) {
  await removeContainer(name);
  const networkArgs =
    runtime === 'podman'
      ? ['--network', 'host']
      : extraEnv.PODMAN_PROCESS === 'server'
        ? ['--publish', `127.0.0.1:${port}:${port}`]
        : [];
  const result = await runContainer([
    'run',
    '--detach',
    '--name',
    name,
    ...networkArgs,
    ...envArgs(extraEnv),
    image,
  ]);
  if (result.code !== 0) {
    fail(`failed to start ${name}: ${result.stderr.trim() || result.stdout.trim()}`);
  }
}

async function stopContainer(name) {
  await runContainer(['stop', '--time', '3', name]);
  await removeContainer(name);
}

async function fetchJson(path) {
  const res = await doFetch(`${baseUrl}${path}`);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    fail(`${path} returned non-JSON response: ${text.slice(0, 200)}`);
  }
  if (!res.ok) fail(`${path} returned ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function waitForApi() {
  let lastError = 'not attempted';
  for (let i = 0; i < 60; i++) {
    try {
      const body = await fetchJson('/health');
      if (body?.ok === true) return;
      lastError = `unexpected /health body: ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error.message;
    }
    await delay(500);
  }
  const logs = await runContainer(['logs', apiContainer]);
  fail(
    `API container did not become healthy at ${baseUrl}: ${lastError}\n${logs.stdout}${logs.stderr}`,
  );
}

async function verifyApiContainer() {
  await startContainer(apiContainer, { PODMAN_PROCESS: 'server' });
  await waitForApi();
  const pods = await fetchJson('/api/pods');
  if (!Array.isArray(pods)) fail(`/api/pods returned unexpected payload: ${JSON.stringify(pods)}`);
}

function requireLiveKitEnv() {
  const missing = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'].filter((key) => {
    const value = process.env[key];
    return !value || value === 'REPLACE_ME';
  });
  if (missing.length) {
    fail(`agent container verification requires real LiveKit env vars: ${missing.join(', ')}`);
  }
}

async function verifyAgentContainer() {
  requireLiveKitEnv();
  await startContainer(agentContainer, { PODMAN_PROCESS: 'agent', POD_ROOM: 'demo-pod' });

  let output = '';
  for (let i = 0; i < 60; i++) {
    const logs = await runContainer(['logs', agentContainer]);
    output = `${logs.stdout}${logs.stderr}`;
    if (output.includes('podman-hermes joined room')) return;

    const inspect = await runContainer([
      'inspect',
      '--format',
      '{{.State.Running}} {{.State.ExitCode}}',
      agentContainer,
    ]);
    if (inspect.code === 0 && inspect.stdout.trim().startsWith('false')) break;

    await delay(500);
  }

  fail(`agent logs did not include "podman-hermes joined room":\n${output}`);
}

let exitCode = 0;
try {
  await assertPodmanAvailable();
  await assertImageExists();
  await verifyApiContainer();
  await verifyAgentContainer();
  console.log(
    JSON.stringify(
      {
        ok: true,
        runtime,
        image,
        baseUrl,
        containers: [apiContainer, agentContainer],
        checks: [
          'image-exists',
          'api-health',
          'api-pods',
          'agent-joined-room',
          'gemini-model-envs',
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  await stopContainer(agentContainer);
  await stopContainer(apiContainer);
}

process.exit(exitCode);
