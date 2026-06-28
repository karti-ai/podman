import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer } from 'ws';
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';
import { env } from './env.js';
import { createSyncPr } from './github/client.js';
import {
  recordCollision,
  recordIntervention,
  recordOutcome,
  hasRecentInterventionForCollision,
  memoryStats,
  recordUserPodContext,
} from './memory/store.js';
import { clerkAuthMiddleware, requestUser } from './auth.js';
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
import { listPodActivity } from './activity/store.js';
import { getMemberWorkHistory } from './activity/member-history.js';
import { speakInRoom } from './voice/live.js';
import { getPodMusic } from './voice/music.js';
import { notifyHermesInterventionInRoom } from './action/hermes.js';
import {
  activeLiveConversation,
  startLiveConversation,
  stopLiveConversation,
} from './live-conversation/sessions.js';
import {
  getLiveConversationContext,
  recordLiveConversationNote,
} from './live-conversation/context.js';
import {
  listUserLearningProfiles,
  refreshUserLearningProfiles,
} from './memory/user-learning.js';
import {
  abortHermesJob,
  appendHermesJobEvent,
  createHermesJob,
  getActiveHermesJobForSession,
  getHermesJob,
  getLatestHermesJobForSession,
  listHermesJobEvents,
} from './hermes/jobs.js';
import type {
  Collision,
  HermesJobEventType,
  Intervention,
  InterventionOutcome,
  SuggestedActionKind,
} from '@podman/shared';

const app = express();
app.use(cors());
app.use(express.json());
app.use(clerkAuthMiddleware);
app.get('/health', (_req, res) => res.json({ ok: true }));

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function suggestedAction(value: unknown): SuggestedActionKind {
  return value === 'open_sync_pr' || value === 'ping_teammate' || value === 'none'
    ? value
    : 'ping_teammate';
}

function stringMeta(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function hermesJobEventType(value: unknown): HermesJobEventType | null {
  return value === 'accepted' ||
    value === 'heartbeat' ||
    value === 'step_started' ||
    value === 'step_output' ||
    value === 'needs_confirmation' ||
    value === 'step_completed' ||
    value === 'aborted' ||
    value === 'failed' ||
    value === 'completed'
    ? value
    : null;
}

// Mint a LiveKit token for an engineer joining a pod.
app.post('/api/token', async (req, res) => {
  const { room, identity, name, githubLogin } = req.body ?? {};
  if (!room || !identity) return res.status(400).json({ error: 'room+identity required' });
  const user = requestUser(req);
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity,
    name,
    ttl: '4h',
    metadata: JSON.stringify({
      githubLogin: githubLogin ?? name,
      email: stringMeta(req.body?.profile?.email),
      imageUrl: stringMeta(req.body?.profile?.imageUrl),
    }),
  });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
  const agents = env.LIVEKIT_AGENT_NAME
    ? [
        new RoomAgentDispatch({
          agentName: env.LIVEKIT_AGENT_NAME,
          metadata: JSON.stringify({ podId: room }),
        }),
      ]
    : undefined;
  // Auto-clean the room: close 60s after it empties, drop a participant 20s
  // after they disconnect. Applied when LiveKit auto-creates the room.
  at.roomConfig = new RoomConfiguration({
    name: room,
    emptyTimeout: 60,
    departureTimeout: 20,
    agents,
  });
  if (user) {
    await recordUserPodContext({
      clerkUserId: user.clerkUserId,
      podId: String(room),
      memberName: typeof name === 'string' ? name : String(identity),
      action: 'joined_pod',
      metadata: {
        identity: String(identity),
        email: stringMeta(req.body?.profile?.email) ?? null,
        imageUrl: stringMeta(req.body?.profile?.imageUrl) ?? null,
      },
    });
  }
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

app.get('/api/memory/users', async (_req, res) => {
  try {
    res.json(await listUserLearningProfiles());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/memory/users/refresh', async (_req, res) => {
  try {
    res.json({ profiles: await refreshUserLearningProfiles() });
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
    const pod = await createPod(req.body ?? {});
    const user = requestUser(req);
    if (user) {
      await recordUserPodContext({
        clerkUserId: user.clerkUserId,
        podId: pod.id,
        memberName: stringMeta(req.body?.profile?.displayName),
        action: 'created_pod',
        metadata: {
          podName: pod.name,
          repo: pod.repo,
          identity: stringMeta(req.body?.profile?.displayName) ?? null,
          email: stringMeta(req.body?.profile?.email) ?? null,
          imageUrl: stringMeta(req.body?.profile?.imageUrl) ?? null,
        },
      });
    }
    res.status(201).json(await getPod(pod.id));
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
    const user = requestUser(req);
    if (user) {
      await recordUserPodContext({
        clerkUserId: user.clerkUserId,
        podId: pod.id,
        action: 'updated_pod',
        metadata: { podName: pod.name, repo: pod.repo },
      });
    }
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
    const user = requestUser(req);
    if (user) {
      await recordUserPodContext({
        clerkUserId: user.clerkUserId,
        podId: pod.id,
        memberName: typeof req.body?.name === 'string' ? req.body.name.trim() : undefined,
        action: 'added_member',
        metadata: {
          identity: typeof req.body?.name === 'string' ? req.body.name.trim() : null,
          email: stringMeta(req.body?.profile?.email) ?? null,
          imageUrl: stringMeta(req.body?.profile?.imageUrl) ?? null,
        },
      });
    }
    res.json(await getPod(pod.id));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post('/api/pods/:id/voice-test', async (req, res) => {
  const podId = req.params.id;
  const message =
    typeof req.body?.message === 'string' && req.body.message.trim()
      ? req.body.message.trim()
      : 'PodMan voice test. Gemini TTS is playing through LiveKit.';
  try {
    await speakInRoom(podId, message);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/pods/:id/live-conversation/start', async (req, res) => {
  try {
    const identity = typeof req.body?.identity === 'string' ? req.body.identity.trim() : '';
    const displayName =
      typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : identity;
    if (!identity) return res.status(400).json({ error: 'identity is required' });
    const pod = await getPod(req.params.id);
    if (!pod) return res.status(404).json({ error: 'pod not found' });
    res.json(await startLiveConversation({ podId: req.params.id, identity, displayName }));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/pods/:id/live-conversation/:sessionId/stop', async (req, res) => {
  try {
    const session = await stopLiveConversation(req.params.id, req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'session not found' });
    res.json({ ok: true, session });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/pods/:id/live-conversation/status', (req, res) => {
  const identity = typeof req.query.identity === 'string' ? req.query.identity.trim() : '';
  if (!identity) return res.status(400).json({ error: 'identity is required' });
  res.json({ active: activeLiveConversation(req.params.id, identity) });
});

app.get('/api/pods/:id/live-conversation/:sessionId/hermes-job', async (req, res) => {
  try {
    const job = await getLatestHermesJobForSession(req.params.sessionId);
    if (!job || job.podId !== req.params.id) return res.json({ job: null, events: [] });
    res.json({ job, events: await listHermesJobEvents(job.id, 12) });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/pods/:id/live-conversation/:sessionId/hermes-job/abort', async (req, res) => {
  try {
    const job = await getActiveHermesJobForSession(req.params.sessionId);
    if (!job || job.podId !== req.params.id)
      return res.status(404).json({ error: 'active job not found' });
    res.json({ job: await abortHermesJob(job.id) });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

function requireInternalAgent(req: express.Request, res: express.Response): boolean {
  const expected = env.INTERNAL_AGENT_TOKEN;
  if (!expected) {
    res.status(503).json({ error: 'INTERNAL_AGENT_TOKEN is not configured' });
    return false;
  }
  const header = req.header('authorization') ?? '';
  const actual = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (actual !== expected) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

app.get('/api/internal/pods/:id/live-context', async (req, res) => {
  if (!requireInternalAgent(req, res)) return;
  try {
    const identity = typeof req.query.identity === 'string' ? req.query.identity.trim() : '';
    if (!identity) return res.status(400).json({ error: 'identity is required' });
    res.json(await getLiveConversationContext(req.params.id, identity));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/internal/pods/:id/live-conversation/:sessionId/note', async (req, res) => {
  if (!requireInternalAgent(req, res)) return;
  try {
    const note = typeof req.body?.note === 'string' ? req.body.note : '';
    const identity = typeof req.body?.identity === 'string' ? req.body.identity : undefined;
    const kind = typeof req.body?.kind === 'string' ? req.body.kind : undefined;
    const saved = await recordLiveConversationNote({
        podId: req.params.id,
        sessionId: req.params.sessionId,
        identity,
        kind,
        note,
      });
    res.status(201).json(saved);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post('/api/internal/hermes/jobs', async (req, res) => {
  if (!requireInternalAgent(req, res)) return;
  try {
    res.status(202).json(await createHermesJob(req.body ?? {}));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get('/api/internal/hermes/jobs/:jobId', async (req, res) => {
  if (!requireInternalAgent(req, res)) return;
  const job = await getHermesJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

app.post('/api/internal/hermes/jobs/:jobId/abort', async (req, res) => {
  if (!requireInternalAgent(req, res)) return;
  const job = await abortHermesJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

app.get('/api/internal/hermes/jobs/:jobId/events', async (req, res) => {
  if (!requireInternalAgent(req, res)) return;
  const job = await getHermesJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(await listHermesJobEvents(req.params.jobId, 100));
});

app.post('/api/internal/hermes/jobs/:jobId/events', async (req, res) => {
  if (!requireInternalAgent(req, res)) return;
  try {
    const { type, message, data } = req.body ?? {};
    const eventType = hermesJobEventType(type);
    if (!eventType || typeof message !== 'string') {
      return res.status(400).json({ error: 'type and message are required' });
    }
    res.status(201).json(await appendHermesJobEvent(req.params.jobId, eventType, message, data));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get('/api/internal/hermes/jobs/:jobId/events/stream', async (req, res) => {
  if (!requireInternalAgent(req, res)) return;
  const job = await getHermesJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;
  let lastIds = new Set<string>();
  const send = async () => {
    if (closed) return;
    try {
      const events = await listHermesJobEvents(req.params.jobId, 100);
      const fresh = events.filter((event) => !lastIds.has(event.id));
      lastIds = new Set(events.map((event) => event.id));
      for (const event of fresh) {
        res.write(`event: job-event\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      const current = await getHermesJob(req.params.jobId);
      if (current && ['completed', 'failed', 'aborted'].includes(current.status)) {
        res.write(`event: done\n`);
        res.write(`data: ${JSON.stringify(current)}\n\n`);
        closed = true;
        res.end();
      } else {
        res.write(`: keepalive ${Date.now()}\n\n`);
      }
    } catch (e) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: (e as Error).message })}\n\n`);
    }
  };
  await send();
  const interval = setInterval(() => void send(), 1500);
  req.on('close', () => {
    closed = true;
    clearInterval(interval);
  });
});

// Per-pod background music (Lyria), generated once and cached. Streams MP3 the
// frontend loops as a pod-wide LiveKit track (replaces the synthesized beat).
app.get('/api/pods/:id/music', async (req, res) => {
  try {
    const pod = await getPod(req.params.id);
    if (!pod) return res.status(404).json({ error: 'pod not found' });
    const mp3 = await getPodMusic(pod.id, pod.name);
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(mp3);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/pods/:id/hermes/notify', async (req, res) => {
  const podId = req.params.id;
  const pod = await getPod(podId);
  if (!pod) return res.status(404).json({ error: 'pod not found' });

  const body = req.body ?? {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'message is required' });

  const now = new Date().toISOString();
  const engineers = stringArray(body.engineers);
  const recipients = engineers.length ? engineers : pod.members.slice(0, 2);
  const file =
    typeof body.file === 'string' && body.file.trim() ? body.file.trim() : 'Hermes signal';
  const urgent = body.urgency === 'urgent' || body.severity === 'critical';
  const collision: Collision = {
    id:
      typeof body.collisionId === 'string' && body.collisionId
        ? body.collisionId
        : `col_${Date.now()}`,
    podId,
    file,
    symbol: typeof body.symbol === 'string' && body.symbol ? body.symbol : undefined,
    engineers: recipients,
    severity: urgent ? 'critical' : 'warn',
    githubState: { unpushed: body.unpushed !== false },
    detectedAt: now,
  };
  const intervention: Intervention = {
    id:
      typeof body.interventionId === 'string' && body.interventionId
        ? body.interventionId
        : `int_${Date.now()}`,
    collisionId: collision.id,
    podId,
    kind: urgent ? 'voice' : 'card',
    message,
    suggestedAction: {
      kind: suggestedAction(body.suggestedAction),
      params: {
        file,
        engineers: recipients,
        source: 'local-hermes',
      },
    },
    status: 'pending',
    createdAt: now,
  };
  const voiceLine =
    urgent && body.speak !== false
      ? typeof body.voiceLine === 'string' && body.voiceLine.trim()
        ? body.voiceLine.trim()
        : message
      : undefined;

  try {
    if (body.force !== true && (await hasRecentInterventionForCollision(collision))) {
      return res.status(202).json({ ok: true, collision, intervention, livekit: 'suppressed' });
    }
    await recordCollision(collision);
    await recordIntervention(intervention);
    if (body.dryRun === true) {
      return res.status(202).json({ ok: true, collision, intervention, livekit: 'dry-run' });
    }
    await notifyHermesInterventionInRoom(podId, collision, intervention, voiceLine);
    res.status(202).json({ ok: true, collision, intervention, livekit: 'notified' });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.delete('/api/pods/:id/members/:name', async (req, res) => {
  const pod = await removeMember(req.params.id, req.params.name);
  if (!pod) return res.status(404).json({ error: 'pod not found' });
  res.json(pod);
});

app.get('/api/pods/:id/members/:name/history', async (req, res) => {
  try {
    const hours = Number(req.query.hours ?? 24) || 24;
    const limit = Number(req.query.limit ?? 80) || 80;
    res.json(await getMemberWorkHistory(req.params.id, req.params.name, { hours, limit }));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
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

app.get('/api/pods/:id/activity', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 80) || 80, 200);
    res.json(await listPodActivity(req.params.id, limit));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/pods/:id/activity/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;
  let lastPayload = '';

  const send = async () => {
    if (closed) return;
    try {
      const events = await listPodActivity(req.params.id, 80);
      const payload = JSON.stringify(events);
      if (payload !== lastPayload) {
        lastPayload = payload;
        res.write(`event: snapshot\n`);
        res.write(`data: ${payload}\n\n`);
      } else {
        res.write(`: keepalive ${Date.now()}\n\n`);
      }
    } catch (e) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: (e as Error).message })}\n\n`);
    }
  };

  await send();
  const interval = setInterval(() => void send(), 1500);

  req.on('close', () => {
    closed = true;
    clearInterval(interval);
  });
});

const http = createServer(app);
const sockets = new Set<Socket>();

http.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

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
  for (const socket of sockets) socket.destroy();
  await Promise.race([
    new Promise<void>((resolve) => http.close(() => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5000)),
  ]);
  await closeMemory().catch((e) => console.warn(`[memory] close failed: ${(e as Error).message}`));
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
