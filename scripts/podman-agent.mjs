#!/usr/bin/env node
/**
 * Local git watcher — polls working tree every 15s and upserts into MongoDB.
 * Usage: node scripts/podman-agent.mjs --name alice --pod demo-pod
 */

import { execSync } from 'node:child_process';
import { MongoClient } from 'mongodb';

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  const name = get('--name');
  const pod = get('--pod');
  if (!name || !pod) {
    console.error('Usage: node scripts/podman-agent.mjs --name <name> --pod <podId>');
    process.exit(1);
  }
  return { name, podId: pod };
}

// ── Environment ───────────────────────────────────────────────────────────────

async function loadEnv() {
  if (!process.env.MONGODB_URI) {
    try {
      const dotenv = await import('dotenv');
      dotenv.config({ path: new URL('../.env', import.meta.url).pathname });
      dotenv.config({ path: new URL('../backend/.env', import.meta.url).pathname });
    } catch {
      // dotenv not available — rely on process.env
    }
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Error: MONGODB_URI not set. Export it or add it to .env');
    process.exit(1);
  }
  return uri;
}

// ── Git helpers ───────────────────────────────────────────────────────────────

function git(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return '';
  }
}

function collectGitState() {
  const statusRaw = git('git status --short');
  const changedFiles = statusRaw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const diffRaw = git('git diff --stat HEAD').trim();
  const diffStat = diffRaw || null;

  const logRaw = git('git log --oneline -1').trim();
  const recentCommit = logRaw || null;

  const branchRaw = git('git branch --show-current').trim();
  const branch = branchRaw || null;

  return { changedFiles, diffStat, recentCommit, branch };
}

// ── Poll ──────────────────────────────────────────────────────────────────────

async function poll(col, engineerId, podId, name) {
  const { changedFiles, diffStat, recentCommit, branch } = collectGitState();
  const now = new Date();

  try {
    await col.updateOne(
      { _id: engineerId },
      {
        $set: {
          changedFiles,
          diffStat,
          recentCommit,
          branch,
          gitUpdatedAt: now,
          updatedAt: now,
        },
        $setOnInsert: {
          podId,
          name,
          confidence: 0,
        },
      },
      { upsert: true },
    );

    const ts = now.toISOString().slice(11, 19);
    const files = changedFiles.length;
    const br = branch ?? '(detached)';
    const commit = recentCommit ? recentCommit.slice(0, 50) : '(no commits)';
    console.log(`[${ts}] ${name}@${podId} | branch=${br} files=${files} commit="${commit}"`);
  } catch (err) {
    console.error(`[poll error] ${err.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { name, podId } = parseArgs();
  const engineerId = `${podId}::${name}`;
  const uri = await loadEnv();

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8_000 });
  await client.connect();

  const col = client.db().collection('engineer_states');
  await col.createIndex({ podId: 1, updatedAt: -1 }, { background: true });

  console.log(`podman-agent started | id=${engineerId} | polling every 15s`);
  console.log('Press Ctrl+C to stop.\n');

  let running = true;

  const shutdown = async () => {
    running = false;
    console.log('\nShutting down...');
    await client.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Run immediately, then loop
  await poll(col, engineerId, podId, name);

  while (running) {
    await new Promise((r) => setTimeout(r, 15_000));
    if (running) await poll(col, engineerId, podId, name);
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
