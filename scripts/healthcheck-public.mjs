#!/usr/bin/env node
import { spawn } from 'node:child_process';

const rootUrl = process.env.PODMAN_PUBLIC_URL ?? 'https://165-22-129-249.sslip.io/';
const apiUrl = process.env.PODMAN_PUBLIC_API_URL ?? new URL('/api/pods', rootUrl).toString();
const timeoutMs = Number(process.env.PODMAN_HEALTH_TIMEOUT_MS ?? 8000);
const doFetch = globalThis.fetch;
const { AbortController, clearTimeout, setTimeout } = globalThis;
const requiredServices = [
  'mongod.service',
  'podman-platform-api.service',
  'podman-platform-agent.service',
  'caddy.service',
];

async function fetchOk(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { signal: controller.signal });
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timeout);
  }
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', (error) => resolve({ code: 127, stdout, stderr: error.message }));
  });
}

async function runChecked(command, args) {
  const result = await run(command, args);
  if (result.code !== 0) {
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
    throw new Error(
      `${command} ${args.join(' ')} failed with ${result.code}${output ? `:\n${output}` : ''}`,
    );
  }
  return result;
}

async function serviceOk(service) {
  const result = await run('systemctl', ['is-active', '--quiet', service]);
  return { ok: result.code === 0, code: result.code };
}

async function restartServices(reason) {
  console.error(`[healthcheck] ${reason}; restarting public app services`);
  for (const service of requiredServices) {
    await runChecked('systemctl', ['restart', service]);
  }
}

const urlChecks = [
  ['root', rootUrl, await fetchOk(rootUrl).catch((error) => ({ ok: false, error: error.message }))],
  ['api', apiUrl, await fetchOk(apiUrl).catch((error) => ({ ok: false, error: error.message }))],
];
const serviceChecks = await Promise.all(
  requiredServices.map(async (service) => [
    `service:${service}`,
    service,
    await serviceOk(service),
  ]),
);
const checks = [...urlChecks, ...serviceChecks];

const failed = checks.filter(([, , result]) => !result.ok);
if (failed.length) {
  await restartServices(
    failed
      .map(([name, url, result]) => `${name} ${url} ${result.status ?? result.error}`)
      .join('; '),
  );
  const retryUrlChecks = [
    [
      'root',
      rootUrl,
      await fetchOk(rootUrl).catch((error) => ({ ok: false, error: error.message })),
    ],
    ['api', apiUrl, await fetchOk(apiUrl).catch((error) => ({ ok: false, error: error.message }))],
  ];
  const retryServiceChecks = await Promise.all(
    requiredServices.map(async (service) => [
      `service:${service}`,
      service,
      await serviceOk(service),
    ]),
  );
  const retry = [...retryUrlChecks, ...retryServiceChecks];
  const stillFailed = retry.filter(([, , result]) => !result.ok);
  console.log(JSON.stringify({ ok: stillFailed.length === 0, checks, retry }, null, 2));
  process.exit(stillFailed.length === 0 ? 0 : 1);
}

console.log(JSON.stringify({ ok: true, checks }, null, 2));
