#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

function fail(message) {
  throw new Error(message);
}

function requireText(haystack, needle, label) {
  if (!haystack.includes(needle)) fail(`${label} missing: ${needle}`);
}

function sectionBetween(text, start, end) {
  const startAt = text.indexOf(start);
  if (startAt === -1) fail(`section not found: ${start}`);
  const endAt = end ? text.indexOf(end, startAt + start.length) : -1;
  return text.slice(startAt, endAt === -1 ? undefined : endAt);
}

function requireEnvKeys(section, keys, label) {
  for (const key of keys) {
    requireText(section, `key: ${key}`, label);
  }
}

const [appSpec, doSpec, dockerfile, digitalOceanDocs] = await Promise.all([
  readFile('infra/app.yaml', 'utf8'),
  readFile('infra/.do/app.yaml', 'utf8'),
  readFile('infra/Dockerfile', 'utf8'),
  readFile('docs/digitalocean.md', 'utf8'),
]);

if (appSpec !== doSpec) {
  fail('infra/.do/app.yaml must stay identical to infra/app.yaml');
}

const web = sectionBetween(appSpec, 'static_sites:', 'services:');
const api = sectionBetween(appSpec, '  - name: api', 'workers:');
const worker = sectionBetween(appSpec, '  - name: podman-agent');

requireText(web, 'output_dir: frontend/dist', 'web static site');
requireText(web, 'value: ${APP_URL}', 'web static site VITE_BACKEND_URL');
requireEnvKeys(web, ['VITE_BACKEND_URL', 'VITE_LIVEKIT_URL'], 'web static site envs');

requireText(api, 'dockerfile_path: infra/Dockerfile', 'api service');
requireText(api, 'http_port: 8787', 'api service');
requireText(api, 'http_path: /health', 'api service health check');
requireText(api, 'path: /api', 'api service route');
requireText(api, 'preserve_path_prefix: true', 'api service route');
requireText(api, 'value: server', 'api service PODMAN_PROCESS');

requireText(worker, 'dockerfile_path: infra/Dockerfile', 'worker');
requireText(worker, 'value: agent', 'worker PODMAN_PROCESS');
requireText(worker, 'value: demo-pod', 'worker POD_ROOM');
if (worker.includes('health_check:') || worker.includes('http_port:')) {
  fail('podman-agent must remain a worker, not a health-checked HTTP service');
}

const runtimeKeys = [
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'GEMINI_API_KEY',
  'GEMINI_VISION_MODEL',
  'GEMINI_LIVE_MODEL',
  'GEMINI_TTS_VOICE',
  'GEMINI_EMBEDDING_MODEL',
  'GITHUB_TOKEN',
  'GITHUB_REPO',
  'MONGODB_URI',
];
requireEnvKeys(api, ['PODMAN_PROCESS', 'PORT', ...runtimeKeys], 'api service envs');
requireEnvKeys(worker, ['PODMAN_PROCESS', 'POD_ROOM', ...runtimeKeys], 'worker envs');

requireText(dockerfile, 'ENV PODMAN_PROCESS=server', 'Dockerfile');
requireText(dockerfile, 'node backend/dist/agent.js', 'Dockerfile');
requireText(dockerfile, 'node backend/dist/server.js', 'Dockerfile');
requireText(dockerfile, 'EXPOSE 8787', 'Dockerfile');

requireText(digitalOceanDocs, 'docker run --env-file backend/.env', 'DigitalOcean docs');
requireText(digitalOceanDocs, '`/api` with `preserve_path_prefix: true`', 'DigitalOcean docs');
requireText(
  digitalOceanDocs,
  '`podman-agent`: background LiveKit/Gemini worker',
  'DigitalOcean docs',
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: [
        'app-spec-mirror',
        'static-site-envs',
        'api-route-preserves-prefix',
        'worker-split',
        'runtime-env-keys',
        'docker-entrypoint',
        'digitalocean-docs',
      ],
    },
    null,
    2,
  ),
);
