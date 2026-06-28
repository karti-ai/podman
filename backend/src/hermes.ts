import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const processMode = process.env.PODMAN_PROCESS ?? 'all';
type ProcessMode = 'server' | 'agent';

function commandFor(mode: ProcessMode): string[] {
  return [join(here, `${mode}.js`)];
}

const modes: ProcessMode[] =
  processMode === 'server' || processMode === 'agent' ? [processMode] : ['server', 'agent'];

const children: ChildProcess[] = modes.map((mode) =>
  spawn(process.execPath, commandFor(mode), { stdio: 'inherit' }),
);

let shuttingDown = false;

function stopAll(signal: NodeJS.Signals = 'SIGTERM') {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopAll();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

process.on('SIGINT', () => {
  shuttingDown = true;
  stopAll('SIGINT');
});

process.on('SIGTERM', () => {
  shuttingDown = true;
  stopAll('SIGTERM');
});
