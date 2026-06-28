#!/usr/bin/env node
import { spawn } from 'node:child_process';

const branch = process.env.PODMAN_DEPLOY_BRANCH ?? 'main';
const remote = process.env.PODMAN_DEPLOY_REMOTE ?? 'origin';
const services = (
  process.env.PODMAN_DEPLOY_RESTART_SERVICES ??
  ['podman-platform-api.service', 'podman-platform-agent.service', 'caddy.service'].join(',')
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const report = {
  ok: false,
  branch,
  remote,
  startedAt: new Date().toISOString(),
  completedAt: '',
  changed: false,
  from: '',
  to: '',
  steps: [],
};

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.on('error', (error) =>
      resolve({ code: 127, signal: null, stdout, stderr: error.message }),
    );
  });
}

function detail(result, max = 1600) {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n').slice(-max);
}

async function step(name, command, args, options) {
  const result = await run(command, args, options);
  const ok = result.code === 0;
  report.steps.push({ name, ok, detail: detail(result) });
  if (!ok) throw new Error(`${name} failed`);
  return result;
}

async function gitOutput(args) {
  const result = await run('git', args);
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${detail(result)}`);
  return result.stdout.trim();
}

async function main() {
  const currentBranch = await gitOutput(['branch', '--show-current']);
  if (currentBranch !== branch)
    throw new Error(`expected branch ${branch}, found ${currentBranch}`);

  await step('fetch', 'git', ['fetch', remote, branch]);
  const dirty = await gitOutput(['status', '--porcelain']);
  if (dirty) throw new Error(`working tree is dirty; refusing auto-deploy:\n${dirty}`);

  const local = await gitOutput(['rev-parse', 'HEAD']);
  const upstream = await gitOutput(['rev-parse', `${remote}/${branch}`]);
  report.from = local;
  report.to = upstream;

  if (local === upstream) {
    report.ok = true;
    report.completedAt = new Date().toISOString();
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  await step('fast-forward', 'git', ['merge', '--ff-only', `${remote}/${branch}`]);
  report.changed = true;
  await step('install', 'pnpm', ['install', '--frozen-lockfile'], {
    env: { CI: 'true' },
  });
  await step('build', 'pnpm', ['build']);
  await step('deploy static', 'pnpm', ['deploy:static:local']);
  for (const service of services)
    await step(`restart ${service}`, 'systemctl', ['restart', service]);
  await step('hermes watchdog', 'pnpm', ['hermes:watchdog:strict']);

  report.ok = true;
  report.completedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
}

try {
  await main();
} catch (error) {
  report.ok = false;
  report.completedAt = new Date().toISOString();
  report.error = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
