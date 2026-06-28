#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { TextEncoder } from 'node:util';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';

const frontendUrl = process.env.FRONTEND_URL ?? 'http://127.0.0.1:4173/';
const shouldStartPreview = !process.env.FRONTEND_URL;
const doFetch = globalThis.fetch;
const verifyMember = `Verify ${process.pid}`;
const apiBase = process.env.BACKEND_URL
  ? process.env.BACKEND_URL.replace(/\/$/, '')
  : process.env.FRONTEND_URL
    ? new URL(process.env.FRONTEND_URL).origin
    : 'http://localhost:8787';
const { DATA_TOPIC } = await import('../shared/dist/messages.js').catch(() => ({
  DATA_TOPIC: 'podman.intervention',
}));
const backendRequire = createRequire(new URL('../backend/package.json', import.meta.url));
const { Room } = backendRequire('@livekit/rtc-node');

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(3000).then(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    }),
  ]);
}

async function waitForPreview() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await doFetch(frontendUrl);
      if (res.ok) return;
    } catch {
      // Preview is still starting.
    }
    await delay(200);
  }
  throw new Error(`frontend preview did not become ready at ${frontendUrl}`);
}

async function fetchJson(path, init) {
  const res = await doFetch(`${apiBase}${path}`, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${path} returned ${res.status}: ${text}`);
  return body;
}

async function connectPublisher(roomName) {
  const { token, url } = await fetchJson('/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      room: roomName,
      identity: `verify-agent-${process.pid}`,
      name: 'PodMan',
    }),
  });
  const room = new Room();
  await room.connect(url, token);
  return room;
}

async function publishIntervention(room, podId) {
  const now = new Date().toISOString();
  const id = `verify-${process.pid}-${Date.now()}`;
  const intervention = {
    id: `int-${id}`,
    collisionId: `col-${id}`,
    podId,
    kind: 'card',
    message: 'Verification collision: two engineers are editing frontend/src/App.tsx.',
    suggestedAction: { kind: 'sync_before_push' },
    status: 'pending',
    createdAt: now,
  };
  const message = {
    type: 'COLLISION',
    collision: {
      id: intervention.collisionId,
      podId,
      file: 'src/App.tsx',
      engineers: ['Verify', 'PodMan'],
      severity: 'warn',
      githubState: { branch: 'verify', unpushed: true, prs: [] },
      detectedAt: now,
    },
    intervention,
  };
  await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)), {
    reliable: true,
    topic: DATA_TOPIC,
  });
}

let preview = null;
if (shouldStartPreview) {
  preview = spawn(
    'pnpm',
    ['--filter', '@podman/frontend', 'preview', '--host', '127.0.0.1', '--port', '4173'],
    {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await waitForPreview();
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (text.includes('net::ERR_NETWORK_CHANGED')) return;
  consoleErrors.push(text);
});
page.on('pageerror', (err) => pageErrors.push(err.message));
page.on('requestfailed', (req) => {
  failedRequests.push(`${req.url()} ${req.failure()?.errorText ?? ''}`.trim());
});

try {
  await page.goto(frontendUrl, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(500);

  const bodyText = await page.locator('body').innerText();
  const hasPodCards =
    (await page.locator('text=/Frontend Pod|Backend Pod|graph pod/i').count()) > 0;
  const hasOverlay = (await page.locator('vite-error-overlay, .vite-error-overlay').count()) > 0;

  if (bodyText.length < 100) throw new Error('frontend rendered too little text');
  if (!hasPodCards) throw new Error('pod cards did not render');
  if (hasOverlay) throw new Error('Vite error overlay is visible');

  await page.getByRole('button', { name: 'Team memory' }).click();
  await page.getByText('Workflow metrics').waitFor({ timeout: 15_000 });
  await page.getByText('Learning edges').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: /Pods/i }).click();
  await page.getByPlaceholder('Your name').first().waitFor({ timeout: 15_000 });

  await page.getByPlaceholder('Your name').first().fill(verifyMember);
  await page.getByRole('button', { name: 'Add and join' }).first().click();
  await page.getByRole('button', { name: 'Share screen' }).waitFor({ timeout: 15_000 });

  const joinedText = await page.locator('body').innerText();
  const hasPodView =
    joinedText.includes('Leave pod') &&
    joinedText.includes('Share screen') &&
    (joinedText.includes('Test audio') || joinedText.includes('Play beat'));

  if (!hasPodView) {
    throw new Error(`pod detail controls did not render after join: ${joinedText.slice(0, 500)}`);
  }

  const publisher = await connectPublisher('frontend-pod');
  try {
    await publishIntervention(publisher, 'frontend-pod');
    await page
      .getByText('Verification collision: two engineers are editing frontend/src/App.tsx.')
      .waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await page.getByText('No collision detected').waitFor({ timeout: 15_000 });
  } finally {
    await publisher.disconnect();
  }

  await page.getByRole('button', { name: 'Leave pod' }).click();

  if (consoleErrors.length) throw new Error(`console errors: ${consoleErrors.join(' | ')}`);
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  if (failedRequests.length) throw new Error(`failed requests: ${failedRequests.join(' | ')}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        frontendUrl,
        bodyLength: bodyText.length,
        graph: true,
        joined: true,
        intervention: true,
        member: verifyMember,
      },
      null,
      2,
    ),
  );
} finally {
  await doFetch(`${apiBase}/api/pods/frontend-pod/members/${encodeURIComponent(verifyMember)}`, {
    method: 'DELETE',
  }).catch(() => {});
  await browser.close();
  await stopChild(preview);
}

process.exit(0);
