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
const {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
} = backendRequire('@livekit/rtc-node');
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

async function publishAudioProbe(room) {
  const source = new AudioSource(24_000, 1, 5_000);
  const track = LocalAudioTrack.createAudioTrack(`verify-audio-${process.pid}`, source);
  const options = new TrackPublishOptions();
  options.source = TrackSource.SOURCE_MICROPHONE;
  const publication = await room.localParticipant.publishTrack(track, options);
  await source.captureFrame(new AudioFrame(new Int16Array(24_000), 24_000, 1, 24_000));
  return { source, publication };
}

async function waitForAttachedAudio(page) {
  const audioSink = page.getByTestId('livekit-audio-sink');
  await audioSink.waitFor({ timeout: 15_000 });
  for (let i = 0; i < 30; i++) {
    const count = await audioSink.locator('audio').count();
    if (count > 0) return;
    await delay(250);
  }
  throw new Error('LiveKit audio track was not attached to the hidden audio sink');
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

async function boxOf(locator, name) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${name} did not have a visible bounding box`);
  return box;
}

function assertNoOverlap(left, main, right, label) {
  if (left.x + left.width > main.x + 2) {
    throw new Error(`${label}: left sidebar overlaps main workspace`);
  }
  if (main.x + main.width > right.x + 2) {
    throw new Error(`${label}: right sidebar overlaps main workspace`);
  }
}

function assertContained(container, child, label) {
  if (child.x < container.x - 2 || child.x + child.width > container.x + container.width + 2) {
    throw new Error(`${label}: body summary is not contained inside the main workspace`);
  }
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

  await page.getByRole('button', { name: 'Pod actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Team memory' }).click();
  await page.getByText('Workflow metrics').waitFor({ timeout: 15_000 });
  await page.getByText('Learning edges').waitFor({ timeout: 15_000 });
  await page.getByRole('img', { name: 'PodMan team-memory graph' }).waitFor({ timeout: 15_000 });
  await page
    .getByRole('button', { name: /engineer:/ })
    .first()
    .click();
  await page.getByText('Relationships').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Whole graph' }).click();
  await page.getByRole('button', { name: /Pods/i }).click();

  const podCard = page
    .getByText(verifyPod.name, { exact: true })
    .locator('xpath=ancestor::*[.//input[@placeholder="Your name"]][1]');
  await podCard.getByPlaceholder('Your name').first().fill(verifyMember);
  await podCard.getByRole('button', { name: 'Join' }).first().click();
  await page.getByRole('button', { name: 'Share screen' }).waitFor({ timeout: 15_000 });
  if (new URL(page.url()).pathname !== `/${verifyPod.id}`) {
    throw new Error(`join did not update URL to /${verifyPod.id}: ${page.url()}`);
  }
  await page.getByRole('heading', { name: 'My stream' }).waitFor({ timeout: 15_000 });
  await page.getByRole('heading', { name: 'Team stream' }).waitFor({ timeout: 15_000 });
  const bodySummary = page.getByTestId('pod-body-summary');
  const mainWorkspace = page.getByTestId('pod-main-workspace');
  const mySidebar = page.getByTestId('my-stream-sidebar');
  const teamSidebar = page.getByTestId('team-stream-sidebar');
  await bodySummary.waitFor({ timeout: 15_000 });
  await mainWorkspace.waitFor({ timeout: 15_000 });
  await mySidebar.waitFor({ timeout: 15_000 });
  await teamSidebar.waitFor({ timeout: 15_000 });
  if ((await page.getByTestId('pod-topbar').count()) > 0) {
    throw new Error('pod detail view still renders a topbar test id');
  }
  if ((await bodySummary.getByRole('button', { name: /stream|team/i }).count()) > 0) {
    throw new Error('pod body summary contains sidebar stream/team controls');
  }
  const expandedLayout = {
    summary: await boxOf(bodySummary, 'body summary expanded'),
    main: await boxOf(mainWorkspace, 'main workspace expanded'),
    left: await boxOf(mySidebar, 'my stream sidebar expanded'),
    right: await boxOf(teamSidebar, 'team stream sidebar expanded'),
  };
  assertNoOverlap(
    expandedLayout.left,
    expandedLayout.main,
    expandedLayout.right,
    'expanded layout',
  );
  assertContained(expandedLayout.main, expandedLayout.summary, 'expanded layout');
  await page.locator('[data-testid="my-stream-toggle"]:visible').click();
  await page.waitForTimeout(300);
  const leftCollapsedLayout = {
    main: await boxOf(mainWorkspace, 'main workspace after left collapse'),
    left: await boxOf(mySidebar, 'my stream sidebar collapsed'),
    right: await boxOf(teamSidebar, 'team stream sidebar with left collapsed'),
    summary: await boxOf(bodySummary, 'body summary after left collapse'),
  };
  if (leftCollapsedLayout.left.width >= expandedLayout.left.width - 24) {
    throw new Error('my stream sidebar did not collapse into a compact rail');
  }
  if (leftCollapsedLayout.main.width <= expandedLayout.main.width) {
    throw new Error('main workspace did not expand after my stream collapsed');
  }
  assertNoOverlap(
    leftCollapsedLayout.left,
    leftCollapsedLayout.main,
    leftCollapsedLayout.right,
    'left collapsed layout',
  );
  assertContained(leftCollapsedLayout.main, leftCollapsedLayout.summary, 'left collapsed layout');
  await page.locator('[data-testid="team-stream-toggle"]:visible').click();
  await page.waitForTimeout(300);
  const bothCollapsedLayout = {
    main: await boxOf(mainWorkspace, 'main workspace after both collapse'),
    left: await boxOf(mySidebar, 'my stream sidebar with both collapsed'),
    right: await boxOf(teamSidebar, 'team stream sidebar collapsed'),
    summary: await boxOf(bodySummary, 'body summary after both collapse'),
  };
  if (bothCollapsedLayout.right.width >= expandedLayout.right.width - 24) {
    throw new Error('team stream sidebar did not collapse into a compact rail');
  }
  if (bothCollapsedLayout.main.width <= leftCollapsedLayout.main.width) {
    throw new Error('main workspace did not expand after team stream collapsed');
  }
  assertNoOverlap(
    bothCollapsedLayout.left,
    bothCollapsedLayout.main,
    bothCollapsedLayout.right,
    'both collapsed layout',
  );
  assertContained(bothCollapsedLayout.main, bothCollapsedLayout.summary, 'both collapsed layout');
  await page.locator('[data-testid="my-stream-toggle"]:visible').click();
  await page.locator('[data-testid="team-stream-toggle"]:visible').click();
  await page.waitForTimeout(300);

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
    const audioProbe = await publishAudioProbe(publisher);
    try {
      await waitForAttachedAudio(page);
    } finally {
      if (audioProbe.publication.sid) {
        await publisher.localParticipant
          .unpublishTrack(audioProbe.publication.sid, true)
          .catch(() => {});
      }
      await audioProbe.source.close().catch(() => {});
    }

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
        audioSink: 'livekit-attached',
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
