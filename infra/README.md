# infra

Deploy targets for PodMan on DigitalOcean.

- `Dockerfile` — builds the Hermes backend from the monorepo root
- `app.yaml` — DigitalOcean App Platform spec (Hermes web service + frontend static site)

Full deploy spec and env var reference in [`docs/digitalocean.md`](../docs/digitalocean.md).

## Local development

```bash
pnpm --filter backend dev    # Hermes on :8787
pnpm --filter frontend dev   # PWA on :5173
```

## Local container

```bash
docker build -f infra/Dockerfile -t podman-hermes .
docker run --env-file .env -p 8787:8787 podman-hermes
```

## DigitalOcean deploy

```bash
doctl apps create --spec infra/app.yaml
```

Set secret env vars (LiveKit, Gemini, MongoDB) in the DO dashboard after app creation.

## Fallback (demo safety)

If DO deploy is flaky on stage, run Hermes locally. The PWA defaults to `http://localhost:8787` via `VITE_BACKEND_URL` fallback — no code change needed.
