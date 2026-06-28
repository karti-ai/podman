#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { config as loadEnv } from 'dotenv';

const envPath = process.env.DOTENV_CONFIG_PATH ?? (existsSync('.env') ? '.env' : 'backend/.env');
loadEnv({ path: envPath, quiet: true });

const port = Number(process.env.VERIFY_BACKEND_PORT ?? 18978);
const baseUrl = `http://127.0.0.1:${port}`;
const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/podman';
const doFetch = globalThis.fetch;

const env = {
  ...process.env,
  PORT: String(port),
  LIVEKIT_URL: process.env.LIVEKIT_URL ?? 'REPLACE_ME',
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY ?? 'verify-key',
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET ?? 'verify-secret',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? 'verify-gemini',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? 'verify-github',
  GITHUB_REPO: process.env.GITHUB_REPO ?? 'karti-ai/podman',
  MONGODB_URI: mongoUri,
  INTERNAL_AGENT_TOKEN: process.env.INTERNAL_AGENT_TOKEN ?? 'verify-internal-agent-token',
};

function fail(message) {
  throw new Error(message);
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(2000).then(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }),
  ]);
}

async function waitForHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await doFetch(`${baseUrl}/health`);
      const body = await res.json();
      if (body.ok === true) return;
    } catch {
      // server still starting
    }
    await delay(250);
  }
  fail('backend /health did not become ready');
}

async function json(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) fail(`${res.url} returned ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function verifyApi() {
  const token = await json(
    await doFetch(`${baseUrl}/api/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room: 'verify-pod', identity: 'verify-user', name: 'Verify User' }),
    }),
  );
  if (typeof token.token !== 'string' || token.token.split('.').length !== 3) {
    fail('token endpoint did not return a JWT');
  }

  const podName = `Verify Pod ${Date.now()}`;
  const created = await json(
    await doFetch(`${baseUrl}/api/pods`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: podName,
        repo: 'karti-ai/podman',
        members: ['Alice', 'Bob'],
        description: 'temporary backend verification pod',
      }),
    }),
  );
  if (!created.id || created.name !== podName) fail('pod create returned unexpected payload');

  const withMember = await json(
    await doFetch(`${baseUrl}/api/pods/${encodeURIComponent(created.id)}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Hermes' }),
    }),
  );
  if (!withMember.members.includes('Hermes')) fail('member add did not persist');

  const hermesNotify = await json(
    await doFetch(`${baseUrl}/api/pods/${encodeURIComponent(created.id)}/hermes/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'Hermes verification notification.',
        engineers: ['Alice', 'Bob'],
        file: 'src/verify-hermes.ts',
        dryRun: true,
      }),
    }),
  );
  if (
    hermesNotify.livekit !== 'dry-run' ||
    hermesNotify.intervention?.message !== 'Hermes verification notification.'
  ) {
    fail('Hermes notify endpoint returned unexpected payload');
  }

  const liveConversation = await json(
    await doFetch(`${baseUrl}/api/pods/${encodeURIComponent(created.id)}/live-conversation/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'Alice', displayName: 'Alice' }),
    }),
  );
  if (
    typeof liveConversation.token !== 'string' ||
    liveConversation.token.split('.').length !== 3 ||
    typeof liveConversation.room !== 'string' ||
    !liveConversation.room.includes('podman-live:')
  ) {
    fail('live conversation start did not return a private room JWT');
  }
  const liveStatus = await json(
    await doFetch(
      `${baseUrl}/api/pods/${encodeURIComponent(
        created.id,
      )}/live-conversation/status?identity=Alice`,
    ),
  );
  if (liveStatus.active?.sessionId !== liveConversation.sessionId) {
    fail('live conversation status did not return the active session');
  }
  await json(
    await doFetch(
      `${baseUrl}/api/pods/${encodeURIComponent(
        created.id,
      )}/live-conversation/${encodeURIComponent(liveConversation.sessionId)}/stop`,
      { method: 'POST' },
    ),
  );

  const hermesJob = await json(
    await doFetch(`${baseUrl}/api/internal/hermes/jobs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.INTERNAL_AGENT_TOKEN}`,
      },
      body: JSON.stringify({
        prompt: 'Check repository state for backend verification.',
        contextScope: 'current_repo',
        riskLevel: 'read_only',
        successCriteria: ['Git status is inspected.'],
        podId: created.id,
        identity: 'Alice',
        sessionId: liveConversation.sessionId,
      }),
    }),
  );
  if (!hermesJob.id || hermesJob.status !== 'queued') {
    fail('Hermes job create returned unexpected payload');
  }
  let finalJob = hermesJob;
  for (let i = 0; i < 30; i++) {
    finalJob = await json(
      await doFetch(`${baseUrl}/api/internal/hermes/jobs/${encodeURIComponent(hermesJob.id)}`, {
        headers: { authorization: `Bearer ${env.INTERNAL_AGENT_TOKEN}` },
      }),
    );
    if (['completed', 'failed', 'aborted'].includes(finalJob.status)) break;
    await delay(500);
  }
  if (finalJob.status !== 'completed') {
    fail(`Hermes job did not complete: ${JSON.stringify(finalJob)}`);
  }
  const hermesEvents = await json(
    await doFetch(
      `${baseUrl}/api/internal/hermes/jobs/${encodeURIComponent(hermesJob.id)}/events`,
      {
        headers: { authorization: `Bearer ${env.INTERNAL_AGENT_TOKEN}` },
      },
    ),
  );
  if (!Array.isArray(hermesEvents) || hermesEvents.length < 1) {
    fail('Hermes job events were not persisted');
  }

  await json(
    await doFetch(`${baseUrl}/api/pods/${encodeURIComponent(created.id)}`, { method: 'DELETE' }),
  );
}

async function verifyCollisionAndMessages() {
  const { detectCollisions } = await import('../backend/dist/collision/detector.js');
  const { DATA_TOPIC } = await import('../shared/dist/messages.js');

  if (DATA_TOPIC !== 'podman.intervention') fail('shared DATA_TOPIC changed unexpectedly');

  const out = detectCollisions(
    [
      {
        engineerId: 'alice',
        podId: 'verify-pod',
        currentFile: 'src/auth.ts',
        currentSymbol: 'loadSession',
        hasUnpushedChanges: true,
        confidence: 1,
        observedAt: new Date().toISOString(),
      },
      {
        engineerId: 'bob',
        podId: 'verify-pod',
        currentFile: './auth.ts',
        hasUnpushedChanges: false,
        confidence: 1,
        observedAt: new Date().toISOString(),
      },
    ],
    { branches: { main: 'sha' } },
  );
  if (out.length !== 1 || out[0].file !== 'src/auth.ts')
    fail('collision detector did not find expected overlap');
}

async function verifyMemoryRecall() {
  process.env.LIVEKIT_URL = env.LIVEKIT_URL;
  process.env.LIVEKIT_API_KEY = env.LIVEKIT_API_KEY;
  process.env.LIVEKIT_API_SECRET = env.LIVEKIT_API_SECRET;
  process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
  process.env.GITHUB_TOKEN = env.GITHUB_TOKEN;
  process.env.GITHUB_REPO = env.GITHUB_REPO;
  process.env.MONGODB_URI = env.MONGODB_URI;

  const { recordCollision } = await import('../backend/dist/memory/store.js');
  const { recallSimilar } = await import('../backend/dist/memory/vectors.js');

  const seed = {
    id: `verify_memory_${Date.now()}`,
    podId: 'verify-pod',
    file: 'src/verify-memory.ts',
    symbol: 'verifyMemory',
    engineers: ['alice', 'bob'],
    severity: 'warn',
    githubState: { unpushed: true },
    detectedAt: new Date().toISOString(),
  };
  await recordCollision(seed);
  const { getDb } = await import('../backend/dist/memory/db.js');
  const db = await getDb();
  const stored = await db.collection('collisions').findOne({ id: seed.id });
  if (!Array.isArray(stored?.embedding) || stored.embedding.length < 1) {
    fail('memory collision was not enriched with an embedding');
  }
  const recalled = await recallSimilar({ ...seed, id: `${seed.id}_query` });
  if (!recalled) fail('memory recall did not find seeded collision');
  const vectorRecalled = await recallSimilar({
    ...seed,
    id: `${seed.id}_vector_query`,
    file: 'src/nearby-memory.ts',
    symbol: 'nearbyMemory',
  });
  if (!vectorRecalled) fail('vector memory recall did not find semantically similar collision');
}

async function verifyGraph() {
  process.env.LIVEKIT_URL = env.LIVEKIT_URL;
  process.env.LIVEKIT_API_KEY = env.LIVEKIT_API_KEY;
  process.env.LIVEKIT_API_SECRET = env.LIVEKIT_API_SECRET;
  process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
  process.env.GITHUB_TOKEN = env.GITHUB_TOKEN;
  process.env.GITHUB_REPO = env.GITHUB_REPO;
  process.env.MONGODB_URI = env.MONGODB_URI;

  const podId = `verify-graph-${Date.now()}`;
  const { seedGraph } = await import('../backend/dist/graph/store.js');
  await seedGraph(podId);

  const graph = await json(await doFetch(`${baseUrl}/api/pods/${encodeURIComponent(podId)}/graph`));
  if (!Array.isArray(graph.nodes) || graph.nodes.length < 1)
    fail('graph endpoint returned no nodes');
  if (!Array.isArray(graph.edges) || graph.edges.length < 1)
    fail('graph endpoint returned no edges');

  const reach = await json(
    await doFetch(
      `${baseUrl}/api/pods/${encodeURIComponent(podId)}/graph/reach/${encodeURIComponent(
        'engineer:karti',
      )}`,
    ),
  );
  if (!Array.isArray(reach.reaches) || reach.reaches.length < 1) {
    fail('graph reachability endpoint returned no reachable edges');
  }
}

async function verifyGitWatcher() {
  const child = spawn(
    process.execPath,
    ['scripts/podman-agent.mjs', '--name', 'verify-user', '--pod', 'verify-pod'],
    {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  for (let i = 0; i < 20; i++) {
    if (output.includes('podman-agent started') && output.includes('verify-user@verify-pod')) {
      await stopChild(child);
      return;
    }
    await delay(250);
  }
  await stopChild(child);
  fail(`git watcher did not produce expected output: ${output}`);
}

const server = spawn(process.execPath, ['backend/dist/server.js'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString();
});

let exitCode = 0;
try {
  await waitForHealth();
  await verifyApi();
  await verifyCollisionAndMessages();
  await verifyMemoryRecall();
  await verifyGraph();
  await verifyGitWatcher();
  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        mongoUri,
        checks: [
          'health',
          'token',
          'pod-crud',
          'hermes-notify',
          'live-conversation-session',
          'hermes-job-lifecycle',
          'collision',
          'memory-recall',
          'graph',
          'git-watcher',
        ],
      },
      null,
      2,
    ),
  );
} catch (err) {
  console.error(serverOutput);
  console.error(err);
  exitCode = 1;
} finally {
  await stopChild(server);
}

process.exit(exitCode);
