#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';

const envPath = process.env.DOTENV_CONFIG_PATH ?? (existsSync('.env') ? '.env' : 'backend/.env');
loadEnv({ path: envPath, quiet: true });

function usage() {
  console.error(
    'Usage: node scripts/hermes-notify.mjs --pod <podId> --message <text> [--engineers alice,bob] [--file path] [--urgent]',
  );
  process.exit(1);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : (process.argv[index + 1] ?? '');
}

const podId = arg('--pod');
const message = arg('--message');
if (!podId || !message) usage();

const apiBase = (
  process.env.PODMAN_API_URL ??
  process.env.BACKEND_URL ??
  `http://127.0.0.1:${process.env.PORT ?? '8787'}`
).replace(/\/$/, '');

const engineers = arg('--engineers')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const file = arg('--file');
const urgent = process.argv.includes('--urgent');

const res = await globalThis.fetch(`${apiBase}/api/pods/${encodeURIComponent(podId)}/hermes/notify`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    message,
    ...(engineers.length ? { engineers } : {}),
    ...(file ? { file } : {}),
    ...(urgent ? { urgency: 'urgent' } : {}),
  }),
});

const text = await res.text();
if (!res.ok) {
  console.error(text);
  process.exit(1);
}

console.log(text);
