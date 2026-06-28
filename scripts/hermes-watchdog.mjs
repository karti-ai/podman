#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { config as loadEnv } from 'dotenv';

const envPath = process.env.DOTENV_CONFIG_PATH ?? (existsSync('.env') ? '.env' : 'backend/.env');
loadEnv({ path: envPath, quiet: true });

const { AbortController, clearTimeout, fetch, setTimeout } = globalThis;
const args = new Set(process.argv.slice(2));
const remediate = !args.has('--no-remediate') && process.env.PODMAN_HERMES_REMEDIATE !== '0';
const strict = args.has('--strict') || process.env.PODMAN_HERMES_STRICT === '1';
const jsonOnly = args.has('--json');
const rootUrl = process.env.PODMAN_PUBLIC_URL ?? 'https://165-22-129-249.sslip.io/';
const apiUrl = process.env.PODMAN_PUBLIC_API_URL ?? new URL('/api/pods', rootUrl).toString();
const healthUrl = process.env.PODMAN_PUBLIC_HEALTH_URL ?? new URL('/health', rootUrl).toString();
const timeoutMs = Number(process.env.PODMAN_HERMES_TIMEOUT_MS ?? 8000);
const stateDir = process.env.PODMAN_HERMES_STATE_DIR ?? '/var/log/podman';
const services = (
  process.env.PODMAN_HERMES_SERVICES ??
  [
    'mongod.service',
    'podman-platform-api.service',
    'podman-platform-agent.service',
    'caddy.service',
  ].join(',')
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const report = {
  ok: false,
  strict,
  remediate,
  startedAt: new Date().toISOString(),
  completedAt: '',
  checks: [],
  remediation: [],
  logs: {},
};

function addCheck(name, ok, detail = '') {
  report.checks.push({ name, ok, detail });
  return ok;
}

function summarizeOutput(result, max = 1200) {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n').slice(-max);
}

function run(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    }, options.timeoutMs ?? timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 127, signal: null, stdout, stderr: error.message });
    });
  });
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, text: text.slice(0, 300) };
  } catch (error) {
    return { ok: false, status: 0, text: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function checkUrls() {
  for (const [name, url] of [
    ['public root', rootUrl],
    ['public health', healthUrl],
    ['public api', apiUrl],
  ]) {
    const result = await fetchWithTimeout(url);
    addCheck(name, result.ok, `${url} -> ${result.status || result.text}`);
  }
}

async function checkServices() {
  for (const service of services) {
    const active = await run('systemctl', ['is-active', '--quiet', service], { timeoutMs: 5000 });
    addCheck(`service:${service}`, active.code === 0, `systemctl is-active exit ${active.code}`);
  }
}

async function checkDoctor() {
  const doctorArgs = ['deploy:doctor'];
  if (strict) doctorArgs[0] = 'deploy:doctor:strict';
  const result = await run('pnpm', doctorArgs, {
    timeoutMs: Number(process.env.PODMAN_HERMES_DOCTOR_TIMEOUT_MS ?? 120000),
  });
  const ok = result.code === 0 && /"ok":\s*true/.test(result.stdout);
  addCheck(`pnpm ${doctorArgs[0]}`, ok, summarizeOutput(result, 2000));
}

async function collectLogs(failedServices = services) {
  for (const service of failedServices) {
    const result = await run('journalctl', ['-u', service, '-n', '80', '--no-pager'], {
      timeoutMs: 8000,
    });
    report.logs[service] = summarizeOutput(result, 6000);
  }
}

async function restart(service) {
  const result = await run('systemctl', ['restart', service], { timeoutMs: 20000 });
  report.remediation.push({
    action: `restart ${service}`,
    ok: result.code === 0,
    detail: summarizeOutput(result),
  });
  return result.code === 0;
}

async function validateCaddy() {
  if (!existsSync('/etc/caddy/Caddyfile')) return;
  const result = await run('caddy', ['validate', '--config', '/etc/caddy/Caddyfile'], {
    timeoutMs: 10000,
  });
  report.remediation.push({
    action: 'caddy validate',
    ok: result.code === 0,
    detail: summarizeOutput(result),
  });
  if (result.code === 0) {
    const reload = await run('systemctl', ['reload', 'caddy.service'], { timeoutMs: 10000 });
    report.remediation.push({
      action: 'reload caddy.service',
      ok: reload.code === 0,
      detail: summarizeOutput(reload),
    });
  }
}

async function remediateFailures() {
  const failed = report.checks.filter((c) => !c.ok);
  if (!failed.length || !remediate) return;

  const failedServiceNames = failed.map((c) => c.name.match(/^service:(.+)$/)?.[1]).filter(Boolean);

  if (failedServiceNames.length) {
    for (const service of failedServiceNames) await restart(service);
  } else {
    for (const service of services.filter((s) => s !== 'mongod.service')) await restart(service);
  }

  if (failed.some((c) => c.name.includes('public'))) await validateCaddy();
  await delay(3000);
}

async function writeReport() {
  report.completedAt = new Date().toISOString();
  report.ok = report.checks.every((c) => c.ok);
  await mkdir(stateDir, { recursive: true });
  const payload = JSON.stringify(report, null, 2);
  await writeFile(join(stateDir, 'hermes-watchdog-latest.json'), payload);
  await writeFile(join(stateDir, `hermes-watchdog-${Date.now()}.json`), payload);
  return payload;
}

async function alert(payload) {
  const url = process.env.PODMAN_ALERT_WEBHOOK_URL;
  if (!url || report.ok) return;
  const failed = report.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
  const text = `PodMan Hermes watchdog failed ${failed.length} check(s):\n${failed.join('\n')}`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: text,
        text,
        username: 'PodMan Hermes',
        report: JSON.parse(payload),
      }),
    });
  } catch (error) {
    report.remediation.push({
      action: 'send alert',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

await checkServices();
await checkUrls();
await checkDoctor();

const firstFailed = report.checks.filter((c) => !c.ok);
await remediateFailures();

if (firstFailed.length && remediate) {
  report.checks.push({ name: 'retry boundary', ok: true, detail: 'after remediation' });
  await checkServices();
  await checkUrls();
  await checkDoctor();
}

await collectLogs(
  report.checks
    .filter((c) => !c.ok)
    .map((c) => c.name.match(/^service:(.+)$/)?.[1])
    .filter(Boolean),
);

const payload = await writeReport();
await alert(payload);

if (!jsonOnly) {
  for (const check of report.checks) {
    console.log(
      `${check.ok ? 'OK  ' : 'FAIL'} ${check.name}${check.detail ? ` - ${check.detail}` : ''}`,
    );
  }
  for (const action of report.remediation) {
    console.log(`${action.ok ? 'OK  ' : 'FAIL'} remediate:${action.action}`);
  }
}
console.log(payload);
process.exit(report.ok || !strict ? 0 : 1);
