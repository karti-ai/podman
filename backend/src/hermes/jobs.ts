import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Room as LiveKitRoom } from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import {
  DATA_TOPIC,
  type DataMessage,
  type HermesJob,
  type HermesJobEvent,
  type HermesJobEventType,
  type HermesJobInput,
  type HermesJobStatus,
  type HermesRiskLevel,
} from '@podman/shared';
import { env, repoParts } from '../env.js';
import { getDb } from '../memory/db.js';

const execFileAsync = promisify(execFile);
const encoder = new TextEncoder();
const MAX_OUTPUT = 3_000;
const COMMAND_TIMEOUT_MS = 45_000;
const runners = new Map<string, AbortController>();

function now(): string {
  return new Date().toISOString();
}

function truncate(value: string): string {
  return value.length > MAX_OUTPUT ? `${value.slice(0, MAX_OUTPUT)}\n...[truncated]` : value;
}

function redact(value: string): string {
  return value
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted-google-key]')
    .replace(/API[_-]?SECRET=[^\s]+/gi, 'API_SECRET=[redacted]')
    .replace(/TOKEN=[^\s]+/gi, 'TOKEN=[redacted]')
    .replace(/mongodb(\+srv)?:\/\/[^@\s]+@/gi, 'mongodb$1://[redacted]@');
}

function normalizeRisk(value: unknown): HermesRiskLevel {
  return value === 'safe_write' ||
    value === 'commit_allowed' ||
    value === 'deploy_allowed' ||
    value === 'read_only'
    ? value
    : 'read_only';
}

async function hermesJobs() {
  return (await getDb()).collection<HermesJob>('hermes_jobs');
}

async function hermesJobEvents() {
  return (await getDb()).collection<HermesJobEvent>('hermes_job_events');
}

export async function ensureHermesJobIndexes(): Promise<void> {
  const db = await getDb();
  await Promise.allSettled([
    db.collection('hermes_jobs').createIndex({ id: 1 }, { unique: true }),
    db.collection('hermes_jobs').createIndex({ sessionId: 1, status: 1, updatedAt: -1 }),
    db.collection('hermes_jobs').createIndex({ podId: 1, updatedAt: -1 }),
    db.collection('hermes_job_events').createIndex({ jobId: 1, createdAt: 1 }),
    db.collection('hermes_job_events').createIndex({ sessionId: 1, createdAt: -1 }),
  ]);
}

export async function createHermesJob(input: Partial<HermesJobInput>): Promise<HermesJob> {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) throw new Error('prompt is required');
  const createdAt = now();
  const job: HermesJob = {
    id: `hermes_job_${randomUUID()}`,
    podId: input.podId || 'demo-pod',
    identity: input.identity || 'developer',
    sessionId: input.sessionId || 'unknown',
    conversationRoom: input.conversationRoom,
    prompt,
    contextScope: input.contextScope || 'current_repo',
    targetRepository: input.targetRepository || env.GITHUB_REPO,
    riskLevel: normalizeRisk(input.riskLevel),
    requiresConfirmation: input.requiresConfirmation === true,
    successCriteria: Array.isArray(input.successCriteria)
      ? input.successCriteria.map(String).filter(Boolean).slice(0, 8)
      : ['Hermes reports what it inspected and what changed.'],
    parentJobId: input.parentJobId,
    status: 'queued',
    createdAt,
    updatedAt: createdAt,
  };
  await (await hermesJobs()).insertOne(job);
  await appendHermesJobEvent(job.id, 'accepted', 'Hermes accepted the task.', {
    riskLevel: job.riskLevel,
    contextScope: job.contextScope,
  });
  void runHermesJob(job.id);
  return job;
}

export async function getHermesJob(jobId: string): Promise<HermesJob | null> {
  return (await hermesJobs()).findOne({ id: jobId }, { projection: { _id: 0 } });
}

export async function getActiveHermesJobForSession(sessionId: string): Promise<HermesJob | null> {
  return (await hermesJobs()).findOne(
    { sessionId, status: { $in: ['queued', 'running', 'waiting_for_confirmation', 'aborting'] } },
    { projection: { _id: 0 }, sort: { updatedAt: -1 } },
  );
}

export async function getLatestHermesJobForSession(sessionId: string): Promise<HermesJob | null> {
  return (await hermesJobs()).findOne(
    { sessionId },
    { projection: { _id: 0 }, sort: { updatedAt: -1 } },
  );
}

export async function listHermesJobEvents(jobId: string, limit = 40): Promise<HermesJobEvent[]> {
  return (await hermesJobEvents())
    .find({ jobId }, { projection: { _id: 0 } })
    .sort({ createdAt: 1 })
    .limit(Math.min(limit, 200))
    .toArray();
}

export async function appendHermesJobEvent(
  jobId: string,
  type: HermesJobEventType,
  message: string,
  data?: Record<string, unknown>,
): Promise<HermesJobEvent> {
  const job = await getHermesJob(jobId);
  if (!job) throw new Error('job not found');
  const event: HermesJobEvent = {
    id: `hermes_evt_${randomUUID()}`,
    jobId,
    podId: job.podId,
    sessionId: job.sessionId,
    type,
    message: redact(truncate(message)),
    data,
    createdAt: now(),
  };
  await (await hermesJobEvents()).insertOne(event);
  await (
    await hermesJobs()
  ).updateOne(
    { id: jobId },
    { $set: { updatedAt: event.createdAt, lastHeartbeatAt: event.createdAt } },
  );
  if (job.conversationRoom) {
    void publishHermesJobEvent(job.conversationRoom, event).catch((err) =>
      console.warn(`[hermes-job] data publish failed: ${(err as Error).message}`),
    );
  }
  return event;
}

export async function abortHermesJob(jobId: string): Promise<HermesJob | null> {
  const job = await getHermesJob(jobId);
  if (!job) return null;
  const abortAt = now();
  await (
    await hermesJobs()
  ).updateOne(
    { id: jobId },
    { $set: { status: 'aborting', abortRequestedAt: abortAt, updatedAt: abortAt } },
  );
  runners.get(jobId)?.abort();
  await appendHermesJobEvent(jobId, 'heartbeat', 'Hermes is aborting the current job.');
  return getHermesJob(jobId);
}

async function setStatus(jobId: string, status: HermesJobStatus, patch: Partial<HermesJob> = {}) {
  await (
    await hermesJobs()
  ).updateOne({ id: jobId }, { $set: { status, updatedAt: now(), ...patch } });
}

async function publishHermesJobEvent(roomName: string, event: HermesJobEvent): Promise<void> {
  const room = new LiveKitRoom();
  try {
    const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity: `podman-hermes-job-${Date.now()}`,
      name: 'PodMan Hermes jobs',
      ttl: '5m',
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: false,
      canPublishData: true,
    });
    await room.connect(env.LIVEKIT_URL, await at.toJwt(), {
      autoSubscribe: false,
      dynacast: false,
    });
    const data: DataMessage = { type: 'HERMES_JOB_EVENT', event };
    await room.localParticipant?.publishData(encoder.encode(JSON.stringify(data)), {
      reliable: true,
      topic: DATA_TOPIC,
    });
  } finally {
    await room.disconnect().catch(() => {});
  }
}

async function runCommand(
  jobId: string,
  label: string,
  command: string,
  args: string[],
  signal: AbortSignal,
): Promise<string> {
  await appendHermesJobEvent(jobId, 'step_started', `${label} started.`);
  const started = Date.now();
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: process.cwd(),
    timeout: COMMAND_TIMEOUT_MS,
    signal,
    maxBuffer: 1024 * 1024,
  });
  const output = redact(truncate([stdout, stderr].filter(Boolean).join('\n').trim()));
  await appendHermesJobEvent(jobId, 'step_output', output || `${label} produced no output.`, {
    label,
    durationMs: Date.now() - started,
  });
  await appendHermesJobEvent(jobId, 'step_completed', `${label} completed.`);
  return output;
}

function wantsBuild(prompt: string, criteria: string[]): boolean {
  const haystack = `${prompt} ${criteria.join(' ')}`.toLowerCase();
  return /build|typecheck|test|lint|broken|failing|verify/.test(haystack);
}

function wantsMongo(prompt: string, scope: string): boolean {
  return scope === 'mongodb' || /mongo|database|telemetry|logs?|memory/.test(prompt.toLowerCase());
}

function wantsGithub(prompt: string, scope: string): boolean {
  return (
    scope === 'github' || /github|branch|pr|pull request|commit|diff/.test(prompt.toLowerCase())
  );
}

async function inspectMongo(jobId: string) {
  await appendHermesJobEvent(jobId, 'step_started', 'MongoDB inspection started.');
  const db = await getDb();
  const [observations, collisions, interventions, outcomes, jobs] = await Promise.all([
    db.collection('observations').estimatedDocumentCount(),
    db.collection('collisions').estimatedDocumentCount(),
    db.collection('interventions').estimatedDocumentCount(),
    db.collection('outcomes').estimatedDocumentCount(),
    db.collection('hermes_jobs').estimatedDocumentCount(),
  ]);
  await appendHermesJobEvent(
    jobId,
    'step_output',
    `MongoDB is reachable. Counts: observations=${observations}, collisions=${collisions}, interventions=${interventions}, outcomes=${outcomes}, hermes_jobs=${jobs}.`,
  );
  await appendHermesJobEvent(jobId, 'step_completed', 'MongoDB inspection completed.');
}

async function inspectGithub(jobId: string) {
  await appendHermesJobEvent(jobId, 'step_started', 'GitHub repository inspection started.');
  const { owner, repo } = repoParts();
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub repo check returned ${res.status}`);
  const body = (await res.json()) as {
    full_name?: string;
    default_branch?: string;
    open_issues_count?: number;
  };
  await appendHermesJobEvent(
    jobId,
    'step_output',
    `GitHub ${body.full_name ?? `${owner}/${repo}`} is reachable. Default branch=${body.default_branch ?? 'unknown'}, open issue count=${body.open_issues_count ?? 0}.`,
  );
  await appendHermesJobEvent(jobId, 'step_completed', 'GitHub repository inspection completed.');
}

async function runHermesJob(jobId: string): Promise<void> {
  const job = await getHermesJob(jobId);
  if (!job) return;
  const controller = new AbortController();
  runners.set(jobId, controller);
  try {
    await setStatus(jobId, 'running', { startedAt: now() });
    await appendHermesJobEvent(jobId, 'heartbeat', 'Hermes is gathering repository context.');
    const outputs: string[] = [];
    outputs.push(
      await runCommand(
        jobId,
        'Git status',
        'git',
        ['status', '--short', '--branch'],
        controller.signal,
      ),
    );
    outputs.push(
      await runCommand(jobId, 'Git diff summary', 'git', ['diff', '--stat'], controller.signal),
    );

    if (wantsGithub(job.prompt, job.contextScope)) await inspectGithub(jobId);
    if (wantsMongo(job.prompt, job.contextScope)) await inspectMongo(jobId);

    if (wantsBuild(job.prompt, job.successCriteria)) {
      outputs.push(
        await runCommand(jobId, 'TypeScript typecheck', 'pnpm', ['typecheck'], controller.signal),
      );
    }

    if (job.riskLevel === 'deploy_allowed' && job.requiresConfirmation) {
      await setStatus(jobId, 'waiting_for_confirmation');
      await appendHermesJobEvent(
        jobId,
        'needs_confirmation',
        'Hermes needs confirmation before deploy-level actions.',
      );
      return;
    }

    const finalSummary = `Hermes completed the task. It inspected repository state${wantsMongo(job.prompt, job.contextScope) ? ', MongoDB' : ''}${wantsGithub(job.prompt, job.contextScope) ? ', and GitHub' : ''}. ${outputs.some((o) => /error|failed/i.test(o)) ? 'Review the recorded output for warnings.' : 'No blocking error was reported by the completed checks.'}`;
    await setStatus(jobId, 'completed', { completedAt: now(), finalSummary });
    await appendHermesJobEvent(jobId, 'completed', finalSummary);
  } catch (err) {
    const aborted = controller.signal.aborted;
    const message = aborted
      ? 'Hermes aborted the job before making further changes.'
      : (err as Error).message;
    await setStatus(jobId, aborted ? 'aborted' : 'failed', {
      completedAt: now(),
      finalSummary: message,
      error: aborted ? undefined : message,
    });
    await appendHermesJobEvent(jobId, aborted ? 'aborted' : 'failed', message);
  } finally {
    runners.delete(jobId);
  }
}
