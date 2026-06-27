# DigitalOcean Deployment Spec

PodMan backend (Hermes) runs on DigitalOcean. Frontend is served as a static site. Both are deployed from the same monorepo.

---

## Services

### 1. Hermes — Backend API + LiveKit Agent

**Type:** DigitalOcean App Platform — Web Service (or Droplet if App Platform has issues)

**Runtime:** Node.js 20

**Build command:** `pnpm --filter backend build`

**Run command:** `node dist/index.js`

**Port:** `8787` (set via `PORT` env var)

**Resources:** Basic ($12/mo) — 1 vCPU, 1GB RAM. Sufficient for hackathon load.

---

### 2. Frontend PWA — Static Site

**Type:** DigitalOcean App Platform — Static Site

**Build command:** `pnpm --filter frontend build`

**Output directory:** `frontend/dist`

**Routes:** SPA — all routes → `index.html`

---

## Environment variables (set in App Platform dashboard)

```
# LiveKit
LIVEKIT_URL=wss://your-livekit-server.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

# Gemini
GEMINI_API_KEY=
GEMINI_VISION_MODEL=gemini-2.0-flash
GEMINI_LIVE_MODEL=gemini-live-2.5-flash

# MongoDB Atlas
MONGODB_URI=mongodb+srv://...

# Server
PORT=8787

# Frontend (Vite — set in App Platform as static site env vars)
VITE_BACKEND_URL=https://your-hermes-app.ondigitalocean.app
VITE_LIVEKIT_URL=wss://your-livekit-server.livekit.cloud
```

---

## Dockerfile (backend)

Located at `infra/Dockerfile`. Already scaffolded. Ensure it:

1. Uses `node:20-slim`
2. Installs `pnpm`
3. Copies workspace root + backend package
4. Runs `pnpm install --frozen-lockfile`
5. Runs `pnpm --filter backend build`
6. `CMD ["node", "backend/dist/index.js"]`

---

## App Platform spec (`infra/app.yaml`)

Already scaffolded. Key fields to confirm before deploy:

```yaml
services:
  - name: hermes
    source_dir: /
    dockerfile_path: infra/Dockerfile
    http_port: 8787
    instance_size_slug: basic-xxs
    envs:
      - key: LIVEKIT_URL
        scope: RUN_TIME
        value: ${LIVEKIT_URL}
      # ... other vars

static_sites:
  - name: frontend
    source_dir: frontend
    build_command: pnpm build
    output_dir: dist
    index_document: index.html
    error_document: index.html
```

---

## Deploy checklist

- [ ] MongoDB Atlas IP allowlist: add DigitalOcean outbound IPs (or allow all: `0.0.0.0/0` for hackathon)
- [ ] LiveKit Cloud: confirm `LIVEKIT_URL` points to your LiveKit Cloud project
- [ ] Gemini API key has quota for `gemini-2.0-flash` + `gemini-live-2.5-flash`
- [ ] `VITE_BACKEND_URL` set to the deployed Hermes URL (not localhost)
- [ ] Test `GET /health` returns `{ ok: true }` after deploy

---

## Fallback plan (if App Platform deploy fails on stage)

Run Hermes locally:
```bash
cd backend && pnpm dev
```

Frontend already points to `http://localhost:8787` by default via `VITE_BACKEND_URL` fallback. Demo works fully local — no DigitalOcean dependency for the live demo itself.
