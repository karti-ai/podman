#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';

const frontendUrl = process.env.FRONTEND_URL ?? 'http://127.0.0.1:4173/';
const shouldStartPreview = !process.env.FRONTEND_URL;
const doFetch = globalThis.fetch;
const verifyMember = `Verify ${process.pid}`;

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
  if (consoleErrors.length) throw new Error(`console errors: ${consoleErrors.join(' | ')}`);
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  if (failedRequests.length) throw new Error(`failed requests: ${failedRequests.join(' | ')}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        frontendUrl,
        bodyLength: bodyText.length,
        joined: true,
        member: verifyMember,
      },
      null,
      2,
    ),
  );
} finally {
  const apiBase = process.env.FRONTEND_URL
    ? new URL(process.env.FRONTEND_URL).origin
    : 'http://localhost:8787';
  await doFetch(`${apiBase}/api/pods/frontend-pod/members/${encodeURIComponent(verifyMember)}`, {
    method: 'DELETE',
  }).catch(() => {});
  await browser.close();
  await stopChild(preview);
}
