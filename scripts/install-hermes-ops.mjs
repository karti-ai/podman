#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const root = process.cwd();
const dryRun = process.argv.includes('--dry-run');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
    child.on('error', reject);
  });
}

async function installFile(source, target, mode = 0o644) {
  console.log(`${dryRun ? 'would install' : 'install'} ${source} -> ${target}`);
  if (dryRun) return;
  await copyFile(source, target);
  await chmod(target, mode);
}

async function installGitHook() {
  const hookDir = `${root}/.git/hooks`;
  if (!existsSync(hookDir)) return;
  const hook = `#!/usr/bin/env bash
set -euo pipefail
cd "${root}"
echo "[hermes] running pre-push verification"
pnpm -r typecheck
pnpm lint
pnpm hermes:watchdog -- --no-remediate --json >/tmp/podman-hermes-pre-push.json
echo "[hermes] pre-push verification passed"
`;
  console.log(`${dryRun ? 'would write' : 'write'} ${hookDir}/pre-push`);
  if (dryRun) return;
  await writeFile(`${hookDir}/pre-push`, hook);
  await chmod(`${hookDir}/pre-push`, 0o755);
}

await installFile(
  'infra/systemd/podman-hermes-watchdog.service',
  '/etc/systemd/system/podman-hermes-watchdog.service',
);
await installFile(
  'infra/systemd/podman-hermes-watchdog.timer',
  '/etc/systemd/system/podman-hermes-watchdog.timer',
);
await installFile(
  'infra/systemd/podman-hermes-sync-deploy.service',
  '/etc/systemd/system/podman-hermes-sync-deploy.service',
);
await installFile(
  'infra/systemd/podman-hermes-sync-deploy.timer',
  '/etc/systemd/system/podman-hermes-sync-deploy.timer',
);
await installFile(
  'infra/systemd/podman-public-healthcheck.service',
  '/etc/systemd/system/podman-public-healthcheck.service',
);
await installFile(
  'infra/systemd/podman-public-healthcheck.timer',
  '/etc/systemd/system/podman-public-healthcheck.timer',
);

await mkdir('/var/log/podman', { recursive: true });
await installGitHook();

if (!dryRun) {
  await run('systemctl', ['daemon-reload']);
  await run('systemctl', ['enable', '--now', 'podman-hermes-watchdog.timer']);
  await run('systemctl', ['enable', '--now', 'podman-hermes-sync-deploy.timer']);
  await run('systemctl', ['enable', '--now', 'podman-public-healthcheck.timer']);
  await run('systemctl', [
    'status',
    '--no-pager',
    'podman-hermes-watchdog.timer',
    'podman-hermes-sync-deploy.timer',
    'podman-public-healthcheck.timer',
  ]);
}

console.log(JSON.stringify({ ok: true, installed: !dryRun }, null, 2));
