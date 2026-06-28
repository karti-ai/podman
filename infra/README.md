# infra

Deploy targets for PodMan on DigitalOcean.

- `Dockerfile` — builds the backend runtime image from the monorepo root
- `app.yaml` — DigitalOcean App Platform spec: static site, API service, agent worker
- `systemd/` — local droplet service units for the API and agent worker

Full deploy spec and env var reference in [`docs/digitalocean.md`](../docs/digitalocean.md).

## Local development

```bash
pnpm --filter @podman/backend dev:server
pnpm --filter @podman/backend dev:agent
pnpm --filter @podman/frontend dev
```

## Local container

```bash
docker build -f infra/Dockerfile -t podman-backend .
docker run --env-file backend/.env -e PODMAN_PROCESS=server -p 8787:8787 podman-backend
docker run --env-file backend/.env -e PODMAN_PROCESS=agent podman-backend
```

## Local production services

On the demo droplet, serve the API and worker with systemd instead of tmux:

```bash
sudo install -m 0644 infra/systemd/podman-platform-api.service /etc/systemd/system/
sudo install -m 0644 infra/systemd/podman-platform-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now podman-platform-api podman-platform-agent
sudo systemctl status podman-platform-api podman-platform-agent
```

The services expect:

- built backend artifacts in `backend/dist`
- runtime env in `backend/.env`
- Caddy proxying `/api/*` to `127.0.0.1:8787`

Useful checks:

```bash
curl http://127.0.0.1:8787/health
journalctl -u podman-platform-api -u podman-platform-agent -f
```

## DigitalOcean deploy

```bash
doctl apps create --spec infra/app.yaml
```

Set secret env vars (LiveKit, Gemini, GitHub, MongoDB) in the DO dashboard after app creation.
Run `pnpm deploy:doctor:strict` with the same environment loaded before treating the
deployment as production-ready.

## Droplet/systemd fallback

The `infra/systemd/` units run the compiled API and LiveKit/Gemini agent from
`/root/podman` and load `/root/podman/backend/.env`, matching the current
droplet layout. `pnpm deploy:doctor` also falls back to that file when root
`.env` is absent. Set `FRONTEND_URL` when the static frontend is served from a
different public origin than `VITE_BACKEND_URL`.

The matching Caddy config is in `infra/Caddyfile`; it serves `/var/www/podman`,
proxies `/api/*` and `/health` to `localhost:8787`, and proxies the optional
local LiveKit host.

```bash
sudo cp infra/systemd/podman-platform-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now podman-platform-api podman-platform-agent
systemctl status podman-platform-api podman-platform-agent
```

## Fallback (demo safety)

If DO deploy is flaky on stage, run the API and agent locally. In dev, the PWA
defaults to `http://localhost:8787`; in production it falls back to same-origin.
