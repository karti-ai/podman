#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { TextEncoder } from 'node:util';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import { config as loadEnv } from 'dotenv';
import { RoomServiceClient } from 'livekit-server-sdk';

loadEnv({ path: 'backend/.env', quiet: true });
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
const pods = await fetchJson('/api/pods');
const verifyPod = pods.find((pod) => pod.id === 'frontend-pod') ?? pods[0];
if (!verifyPod) throw new Error('no pods available for frontend verification');

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
  await room.connect(url, token, { autoSubscribe: true });
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
    suggestedAction: { kind: 'open_sync_pr' },
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
  return intervention;
}

async function publishDataMessage(room, message) {
  await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)), {
    reliable: true,
    topic: DATA_TOPIC,
  });
}

async function waitForInterventionCard(page, room, podId) {
  const cardText = 'Verification collision: two engineers are editing frontend/src/App.tsx.';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const intervention = await publishIntervention(room, podId);
    try {
      await page.getByText(cardText).waitFor({ timeout: 5_000 });
      return intervention;
    } catch (error) {
      if (attempt === 3) throw error;
      await delay(500);
    }
  }
}

function liveKitService() {
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    throw new Error('screen publication verification requires LIVEKIT_* env vars');
  }
  const httpUrl = process.env.LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  return new RoomServiceClient(
    httpUrl,
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
  );
}

function hasScreenShareTrack(participant) {
  return (participant.tracks ?? []).some((track) => {
    const source = JSON.stringify(track).toLowerCase();
    return source.includes('screen') || source.includes('share');
  });
}

async function waitForPublishedScreenShare(roomName) {
  const service = liveKitService();
  let lastParticipants = [];
  for (let i = 0; i < 30; i++) {
    lastParticipants = await service.listParticipants(roomName);
    if (lastParticipants.some(hasScreenShareTrack)) return;
    await delay(500);
  }
  throw new Error(
    `LiveKit room service did not list a screen-share publication in ${roomName}: ${JSON.stringify(
      lastParticipants,
    ).slice(0, 1000)}`,
  );
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
await page.addInitScript(() => {
  globalThis.__podmanVerifyScreens = [];
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      ...(globalThis.navigator.mediaDevices ?? {}),
      async getDisplayMedia() {
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas context unavailable');
        let frame = 0;
        const draw = () => {
          frame += 1;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#111';
          ctx.font = '28px sans-serif';
          ctx.fillText('PodMan verification screen', 32, 72);
          ctx.fillText(`frame ${frame}`, 32, 120);
        };
        draw();
        const interval = globalThis.setInterval(draw, 200);
        const stream = canvas.captureStream(5);
        globalThis.__podmanVerifyScreens.push({ canvas, stream, interval });
        return stream;
      },
    },
  });
});

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
  const failure = req.failure()?.errorText ?? '';
  if (req.url().includes('/activity/stream') && failure.includes('ERR_ABORTED')) return;
  failedRequests.push(`${req.url()} ${failure}`.trim());
});

try {
  await page.goto(frontendUrl, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(500);

  const bodyText = await page.locator('body').innerText();
  const hasPodCards = (await page.getByText(verifyPod.name, { exact: true }).count()) > 0;
  const hasOverlay = (await page.locator('vite-error-overlay, .vite-error-overlay').count()) > 0;

  if (bodyText.length < 100) throw new Error('frontend rendered too little text');
  if (!hasPodCards) throw new Error('pod cards did not render');
  if (hasOverlay) throw new Error('Vite error overlay is visible');

  await page.getByRole('button', { name: 'Team memory' }).click();
  await page.getByText('Workflow metrics').waitFor({ timeout: 15_000 });
  await page.getByText('Learning edges').waitFor({ timeout: 15_000 });
  await page.getByRole('img', { name: 'PodMan team-memory graph' }).waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: 'engineer: Karti' }).click();
  await page.getByText('Learned owner of auth; backend + DB wiring.').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Whole graph' }).click();
  await page.getByRole('button', { name: /Pods/i }).click();

  const podCard = page
    .getByText(verifyPod.name, { exact: true })
    .locator('xpath=ancestor::*[.//input[@placeholder="Your name"]][1]');
  await podCard.getByPlaceholder('Your name').fill(verifyMember);
  await podCard.getByRole('button', { name: 'Add and join' }).click();
  await page.getByRole('button', { name: 'Share screen' }).waitFor({ timeout: 15_000 });
  if (new URL(page.url()).pathname !== `/${verifyPod.id}`) {
    throw new Error(`join did not update URL to /${verifyPod.id}: ${page.url()}`);
  }
  await page.getByRole('heading', { name: 'My stream' }).waitFor({ timeout: 15_000 });
  await page.getByRole('heading', { name: 'Team stream' }).waitFor({ timeout: 15_000 });

  const joinedText = await page.locator('body').innerText();
  const hasPodView =
    joinedText.includes('Leave pod') &&
    joinedText.includes('Share screen') &&
    (joinedText.includes('Test audio') || joinedText.includes('Play beat'));

  if (!hasPodView) {
    throw new Error(`pod detail controls did not render after join: ${joinedText.slice(0, 500)}`);
  }

  await page.getByRole('button', { name: 'Share screen' }).click();
  await page.getByRole('button', { name: 'Stop sharing' }).waitFor({ timeout: 15_000 });
  await page.getByText(/Screen\s*published/i).waitFor({ timeout: 15_000 });
  await waitForPublishedScreenShare(verifyPod.id);
  await page.getByRole('button', { name: 'Stop sharing' }).click();
  await page.getByRole('button', { name: 'Share screen' }).waitFor({ timeout: 15_000 });

  const publisher = await connectPublisher(verifyPod.id);
  try {
    const intervention = await waitForInterventionCard(page, publisher, verifyPod.id);
    await publishDataMessage(publisher, {
      type: 'HERMES_MESSAGE',
      message: {
        id: `hermes-${process.pid}`,
        podId: verifyPod.id,
        interventionId: intervention.id,
        recipients: ['Verify'],
        text: 'Hermes verification message routed to the team.',
        urgency: 'normal',
        createdAt: new Date().toISOString(),
      },
    });
    await publishDataMessage(publisher, {
      type: 'VOICE_CUE',
      text: 'Voice cue verification for urgent escalation.',
    });
    await page.getByText('Hermes message').waitFor({ timeout: 15_000 });
    await page.getByText('Hermes verification message routed to the team.').waitFor({
      timeout: 15_000,
    });
    await page.getByText('Voice cue', { exact: true }).waitFor({ timeout: 15_000 });
    await page.getByText('Voice cue verification for urgent escalation.').waitFor({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await page.getByText('No collision detected').waitFor({ timeout: 15_000 });
  } finally {
    await publisher.disconnect();
  }

  await page.getByRole('button', { name: 'Leave pod' }).click();
  await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 });

  if (consoleErrors.length) throw new Error(`console errors: ${consoleErrors.join(' | ')}`);
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  if (failedRequests.length) throw new Error(`failed requests: ${failedRequests.join(' | ')}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        frontendUrl,
        apiBase,
        bodyLength: bodyText.length,
        graph: true,
        joined: true,
        screenShare: 'livekit-published',
        intervention: 'collision-hermes-voice',
        podId: verifyPod.id,
        member: verifyMember,
      },
      null,
      2,
    ),
  );
} finally {
  await doFetch(`${apiBase}/api/pods/${verifyPod.id}/members/${encodeURIComponent(verifyMember)}`, {
    method: 'DELETE',
  }).catch(() => {});
  await browser.close();
  await stopChild(preview);
}

process.exit(0);
