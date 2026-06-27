import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { AccessToken } from 'livekit-server-sdk';
import { env } from './env.js';
import { createSyncPr } from './github/client.js';
import { recordOutcome, memoryStats } from './memory/store.js';
import { initMemory } from './memory/db.js';
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
  await recordOutcome(req.body as InterventionOutcome);
  res.json({ ok: true });
});

// Memory counts — quick way to confirm Mongo persistence is working.
app.get('/api/memory/stats', async (_req, res) => {
  try {
    res.json(await memoryStats());
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
  initMemory().catch((e) => console.warn(`[memory] init failed: ${(e as Error).message}`));
});
