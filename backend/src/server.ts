import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { AccessToken, RoomConfiguration } from 'livekit-server-sdk';
import { env } from './env.js';
import { createSyncPr } from './github/client.js';
import { recordOutcome, memoryStats } from './memory/store.js';
import { closeMemory, initMemory } from './memory/db.js';
import {
  listPods,
  getPod,
  createPod,
  updatePod,
  deletePod,
  addMember,
  removeMember,
  seedDefaultPods,
} from './pods/store.js';
import { getPresence, closeRoom } from './livekit/rooms.js';
import { loadPodGraph, reachFrom } from './graph/store.js';
import type { InterventionOutcome } from '@podman/shared';

const app = express();
app.use(cors());
app.use(express.json());
app.get('/health', (_req, res) => res.json({ ok: true }));

// Mint a LiveKit token for an engineer joining a pod.
app.post('/api/token', async (req, res) => {
  const { room, identity, name, githubLogin } = req.body ?? {};
  if (!room || !identity) return res.status(400).json({ error: 'room+identity required' });
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity,
    name,
    ttl: '4h',
    metadata: JSON.stringify({ githubLogin: githubLogin ?? name }),
  });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
  // Auto-clean the room: close 60s after it empties, drop a participant 20s
  // after they disconnect. Applied when LiveKit auto-creates the room.
  at.roomConfig = new RoomConfiguration({ name: room, emptyTimeout: 60, departureTimeout: 20 });
  res.json({ token: await at.toJwt(), url: env.LIVEKIT_URL });
});

// PodMan's hero action: open a real sync PR on the PUBLIC repo.
app.post('/api/sync-pr', async (req, res) => {
  try {
    const { headBranch, file, summary } = req.body ?? {};
    const pr = await createSyncPr({ headBranch, file, summary });
    res.json({ url: pr.html_url, number: pr.number });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Outcome ACK -> closes the continual-learning policy loop.
app.post('/api/outcome', async (req, res) => {
  try {
    const o = (req.body ?? {}) as Partial<InterventionOutcome>;
    if (typeof o.interventionId !== 'string' || !o.interventionId) {
      return res.status(400).json({ error: 'interventionId is required' });
    }
    await recordOutcome(req.body as InterventionOutcome);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Memory counts — quick way to confirm Mongo persistence is working.
app.get('/api/memory/stats', async (_req, res) => {
  try {
    res.json(await memoryStats());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Live presence: who is currently connected in each pod's LiveKit room.
app.get('/api/presence', async (_req, res) => {
  try {
    res.json(await getPresence());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- Pods CRUD (Mongo-backed) ---
app.get('/api/pods', async (_req, res) => {
  try {
    res.json(await listPods());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/pods', async (req, res) => {
  try {
    res.status(201).json(await createPod(req.body ?? {}));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get('/api/pods/:id', async (req, res) => {
  const pod = await getPod(req.params.id);
  if (!pod) return res.status(404).json({ error: 'pod not found' });
  res.json(pod);
});

app.patch('/api/pods/:id', async (req, res) => {
  try {
    const pod = await updatePod(req.params.id, req.body ?? {});
    if (!pod) return res.status(404).json({ error: 'pod not found' });
    res.json(pod);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.delete('/api/pods/:id', async (req, res) => {
  const ok = await deletePod(req.params.id);
  if (!ok) return res.status(404).json({ error: 'pod not found' });
  await closeRoom(req.params.id); // end the live LiveKit room too (kicks anyone connected)
  res.json({ ok: true });
});

app.post('/api/pods/:id/members', async (req, res) => {
  try {
    const pod = await addMember(req.params.id, req.body?.name ?? '');
    if (!pod) return res.status(404).json({ error: 'pod not found' });
    res.json(pod);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.delete('/api/pods/:id/members/:name', async (req, res) => {
  const pod = await removeMember(req.params.id, req.params.name);
  if (!pod) return res.status(404).json({ error: 'pod not found' });
  res.json(pod);
});

// --- Continual-learning graph (team_model view) ---
app.get('/api/pods/:id/graph', async (req, res) => {
  try {
    res.json(await loadPodGraph(req.params.id));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/pods/:id/graph/reach/:node', async (req, res) => {
  try {
    res.json(await reachFrom(req.params.id, req.params.node));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

const http = createServer(app);

// ws relay: the agent pushes collision/intervention JSON here; PWAs subscribed by pod receive it.
const wss = new WebSocketServer({ server: http, path: '/api/events' });
const clients = new Set<import('ws').WebSocket>();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('message', (buf) => {
    // fan out agent->PWA events; (auth/pod-scoping omitted for hackathon brevity)
    for (const c of clients) if (c !== ws && c.readyState === 1) c.send(buf.toString());
  });
});

http.listen(env.PORT, '0.0.0.0', () => {
  console.log(`[server] :${env.PORT}`);
  initMemory()
    .then(() => seedDefaultPods())
    .catch((e) => {
      // MongoDB is mandatory — do not run a half-dead API against a broken DB.
      console.error(`[memory] init FAILED, exiting: ${(e as Error).message}`);
      process.exit(1);
    });
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received; shutting down`);
  for (const client of clients) client.close();
  wss.close();
  await new Promise<void>((resolve) => http.close(() => resolve()));
  await closeMemory().catch((e) => console.warn(`[memory] close failed: ${(e as Error).message}`));
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
