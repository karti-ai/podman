# DigitalOcean Deployment Spec

PodMan deploys as three App Platform components from the same monorepo:

- `web`: static Vite/React frontend
- `api`: health-checked HTTP backend on port `8787`
- `podman-agent`: background LiveKit/Gemini worker with no HTTP health check

This split is intentional. The LiveKit agent subscribes to rooms and samples
screen-share frames, so it must run as a worker rather than as a web service.

---

## Canonical Spec

Use [`infra/app.yaml`](../infra/app.yaml):

```bash
doctl apps create --spec infra/app.yaml
```

The mirror at `infra/.do/app.yaml` is kept identical for DO UI/import workflows.

---

## Components

### Static Site: `web`

- Source: monorepo root
- Build:
  `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @podman/shared build && pnpm --filter @podman/frontend build`
- Output: `frontend/dist`
- Routes: `/`
- Build-time env:
  - `VITE_BACKEND_URL`
  - `VITE_LIVEKIT_URL`
  - In the App Platform spec, `VITE_BACKEND_URL=${APP_URL}` keeps frontend API
    calls on the same deployed origin. If it is omitted, the production frontend
    also falls back to same-origin.

### HTTP Service: `api`

- Source: monorepo root
- Dockerfile: `infra/Dockerfile`
- Runtime selector: `PODMAN_PROCESS=server`
- Port: `8787`
- Health check: `/health`
- Routes:
  - `/api` with `preserve_path_prefix: true`
  - `/health`

### Worker: `podman-agent`

- Source: monorepo root
- Dockerfile: `infra/Dockerfile`
- Runtime selector: `PODMAN_PROCESS=agent`
- No HTTP route and no HTTP health check
- Default room: `POD_ROOM=demo-pod`

---

## Required Runtime Environment

```bash
LIVEKIT_URL=wss://your-livekit-server.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...

GEMINI_API_KEY=...
GEMINI_VISION_MODEL=gemini-2.0-flash
GEMINI_LIVE_MODEL=gemini-live-2.5-flash

GITHUB_TOKEN=...
GITHUB_REPO=karti-ai/podman

MONGODB_URI=mongodb+srv://...
VOYAGE_API_KEY=...
VOYAGE_EMBEDDING_MODEL=voyage-4-lite

PORT=8787
POD_ROOM=demo-pod
```

`VOYAGE_API_KEY` is optional for local/demo fallback. Without it, Mongo exact
signature recall still works; Atlas Vector Search recall is skipped.

---

## Container Checks

Build once:

```bash
docker build -f infra/Dockerfile -t podman-backend .
```

The image entrypoint runs `node backend/dist/server.js` when
`PODMAN_PROCESS=server`, and `node backend/dist/agent.js` when
`PODMAN_PROCESS=agent`. Do not run the combined Hermes supervisor inside App
Platform; DO already supervises the service and worker separately.

Run the API:

```bash
docker run --env-file backend/.env -e PODMAN_PROCESS=server -p 8787:8787 podman-backend
```

Run the worker:

```bash
docker run --env-file backend/.env -e PODMAN_PROCESS=agent podman-backend
```

---

## Deploy Checklist

- [ ] `VITE_BACKEND_URL` is `${APP_URL}` or points to the deployed API origin.
- [ ] `FRONTEND_URL` is set for `pnpm deploy:doctor:strict` if the SPA is on a
      different origin than the API.
- [ ] `LIVEKIT_URL` points to the LiveKit Cloud project.
- [ ] LiveKit API key/secret are set for both `api` and `podman-agent`.
- [ ] Gemini API key is set for both backend components.
- [ ] MongoDB Atlas allows DigitalOcean outbound access.
- [ ] `GET /` returns the built frontend HTML and JavaScript bundle.
- [ ] `GET /health` returns `{ "ok": true }`.
- [ ] `GET /api/pods` returns pod data.
- [ ] Worker logs show `podman-hermes joined room demo-pod`.
- [ ] `pnpm deploy:doctor:strict` passes with production env loaded.

Run a non-failing readiness report any time:

```bash
pnpm deploy:doctor
```

Use the strict gate before calling a deployment production-ready:

```bash
pnpm deploy:doctor:strict
```

---

## Local Fallback

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @podman/backend start:server
pnpm --filter @podman/backend start:agent
pnpm --filter @podman/frontend dev
```

For this droplet deployment, Caddy serves `frontend/dist` from
`/var/www/podman` and proxies `/api/*` to `localhost:8787`.

The systemd fallback units live in `infra/systemd/` and load
`/root/podman/backend/.env` on the current droplet:

```bash
sudo cp infra/systemd/podman-platform-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now podman-platform-api podman-platform-agent
```

The droplet production fallback uses systemd units from `infra/systemd/`:

```bash
sudo install -m 0644 infra/systemd/podman-platform-api.service /etc/systemd/system/
sudo install -m 0644 infra/systemd/podman-platform-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now podman-platform-api podman-platform-agent
```

Expected runtime proof:

```bash
systemctl is-active podman-platform-api podman-platform-agent
curl http://127.0.0.1:8787/health
journalctl -u podman-platform-agent -n 20 --no-pager
```
