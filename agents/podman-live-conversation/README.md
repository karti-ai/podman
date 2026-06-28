# PodMan Live Conversation Agent

Private 1:1 LiveKit Agent worker for PodMan Live Conversation.

Run locally:

```bash
cd agents/podman-live-conversation
uv sync --extra test
cp .env.example .env.local
uv run agent.py dev
```

Required env:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `GOOGLE_API_KEY` or `GEMINI_API_KEY`
- `PODMAN_BACKEND_URL`
- `INTERNAL_AGENT_TOKEN`

