import express from 'express';
import cors from 'cors';
import { env } from './env.js';
import { createPodToken } from './livekit/token.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'podman-backend' });
});

/**
 * Mint a LiveKit token for an engineer to join a pod room.
 * POST /pods/:podId/token  { identity, name }
 */
app.post('/pods/:podId/token', async (req, res) => {
  const { podId } = req.params;
  const { identity, name } = req.body ?? {};
  if (!identity) {
    res.status(400).json({ error: 'identity is required' });
    return;
  }
  try {
    const token = await createPodToken(podId, identity, name);
    res.json({ token, url: env.livekit.url });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.listen(env.port, () => {
  console.log(`[podman] backend listening on http://localhost:${env.port}`);
});
