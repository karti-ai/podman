# infra

Deploy targets for PodMan (DigitalOcean prize track).

- `Dockerfile` — builds the backend agent from the monorepo root.
- `app.yaml` — DigitalOcean App Platform spec (auto-deploy on push to `main`).

## Local container

```bash
docker build -f infra/Dockerfile -t podman-backend .
docker run --env-file .env -p 8787:8787 podman-backend
```

## DigitalOcean

```bash
doctl apps create --spec infra/app.yaml
```

Set the `SECRET` env vars (LiveKit, Gemini, GitHub, Atlas, Voyage) in the DO
dashboard or via `doctl` after the app is created.
