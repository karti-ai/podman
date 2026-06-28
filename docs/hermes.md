# Hermes Spec

Status: active / matches code.

"Hermes" is PodMan's **action layer** — the part that turns a detected problem
into something a teammate sees, hears, or gets done. It spans three things:

1. **Interventions** — cards, messages, and urgent voice in the pod room.
2. **Async jobs** — longer tasks delegated from the live conversation agent.
3. **Ops watchdog** — keeps the production services healthy.

The LiveKit identity for the main agent is `podman-hermes`.

---

## 1. Interventions

**Code:** `backend/src/agent/podman.ts`, `backend/src/action/hermes.ts`,
`backend/src/voice/live.ts`.

When the agent detects a collision, it runs the learning loop (recall → policy
gate; see `docs/cont_learning.md`) and then publishes the **least intrusive**
intervention that fits:

- **Card / message** — a data-channel packet on the `podman.intervention` topic
  (`publishHermesIntervention` / `publishHermesMessage`). Default path.
- **Urgent voice** — only for `critical` collisions. `speak()` generates Gemini
  TTS audio and publishes it as a LiveKit audio track.
- **Research overlap nudge** — a collaboration card when one engineer is editing
  a file while another is researching the same topic in docs/browser context.
  This uses `suggestedAction.kind = "ping_teammate"` and is spoken once for the
  demo beat, but it is explicitly **not** a merge conflict.

Intervention text is short and deterministic (template, not an LLM call):
`Conflict: alice + bob both on detector.ts (unpushed). Seen before.` The spoken
line is phrased for natural TTS prosody. Each intervention is persisted to the
`interventions` collection; the teammate's accept/dismiss returns via
`POST /api/outcome`.

Research-overlap text is also deterministic:
`🤝 bob is researching LiveKit agents (docs.livekit.io) while alice edits livekit.py — sync up before duplicating effort.`

A per-pod cooldown (`NUDGE_COOLDOWN_MS`, default 3 min) and a single-shot
"active conflict" guard prevent repeat nagging; a conflict re-arms once it
resolves.

---

## 2. Async Hermes jobs

**Code:** `backend/src/hermes/jobs.ts`. **Storage:** `hermes_jobs` +
`hermes_job_events` (see `docs/mongodb.md`).

The live conversation agent can hand a longer task to Hermes via its
`delegate_to_hermes` tool. Lifecycle:

```
queued → running → (waiting_for_confirmation) → completed | aborted | failed
```

`createHermesJob()` records the job, emits an `accepted` event, and kicks off
`runHermesJob()` in the background. The runner gathers context and runs scoped,
read-mostly steps based on the prompt and success criteria:

- always: `git status --short --branch`, `git diff --stat`
- if the ask mentions GitHub: a repo reachability check via the GitHub API
- if it mentions Mongo/memory/telemetry: collection counts
- if it mentions build/test/typecheck/broken: `pnpm typecheck`

**Confirmation gate:** if `riskLevel === 'deploy_allowed'` and
`requiresConfirmation`, the job parks at `waiting_for_confirmation` instead of
acting. **Abort:** `abortHermesJob()` signals the runner's `AbortController`.

Every step appends a `hermes_job_event` (redacted + truncated), which is both
stored and published live to the room as a `HERMES_JOB_EVENT` data message from a
short-lived `podman-hermes-job-*` identity. The conversation UI streams these via
`GET /api/.../hermes-job/events/stream`.

**Endpoints:** `POST /api/internal/hermes/jobs`,
`GET /api/internal/hermes/jobs/:jobId`, `.../abort`, `.../events`,
`.../events/stream`, plus the pod-scoped `.../live-conversation/:sessionId/hermes-job`.

---

## 3. Ops watchdog

**Code:** `scripts/hermes-watchdog.mjs`, `scripts/hermes-sync-deploy.mjs`,
`scripts/hermes-notify.mjs`. **Detail:** `docs/digitalocean.md`.

systemd supervises the app processes; Hermes owns the loop around them:

- `pnpm hermes:watchdog` checks systemd services, public routes, `/health`,
  `/api/pods`, and `pnpm deploy:doctor`. Failures trigger targeted restarts.
- `podman-hermes-watchdog.timer` runs it every 5 minutes.
- `podman-hermes-sync-deploy.timer` polls `origin/main` every 2 minutes and, on a
  clean tree, fast-forwards, builds, publishes `frontend/dist`, restarts
  API/agent/Caddy, and runs the strict watchdog.
- Reports go to `/var/log/podman/hermes-watchdog-latest.json`; set
  `PODMAN_ALERT_WEBHOOK_URL` to forward failures to Discord/Slack/webhook.

---

## What Hermes is NOT

- Not an autonomous code-writing agent. Job steps are scoped, read-mostly checks;
  deploy-level actions require explicit confirmation.
- Not a second collision detector. Detection is deterministic
  (`collision/detector.ts`); Hermes only acts on the result.
