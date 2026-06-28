#!/usr/bin/env node
import { cp, chmod, rm } from 'node:fs/promises';

const source = process.env.PODMAN_STATIC_SOURCE ?? 'frontend/dist';
const target = process.env.PODMAN_STATIC_TARGET ?? '/var/www/podman';

await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
await chmod(target, 0o755);

const stack = [target];
while (stack.length) {
  const dir = stack.pop();
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      await chmod(path, 0o755);
      stack.push(path);
    } else {
      await chmod(path, 0o644);
    }
  }
}

console.log(JSON.stringify({ ok: true, source, target }, null, 2));
