import asyncio
import json
import logging
import os
import subprocess
import time
from typing import Any
from urllib import error, request

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentServer, AgentSession, RunContext, function_tool
from livekit.plugins import google

load_dotenv(".env.local")
if not os.getenv("GOOGLE_API_KEY") and os.getenv("GEMINI_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

logger = logging.getLogger("podman-live-conversation")

AGENT_NAME = "podman-live-conversation"
MODEL = os.getenv("GEMINI_CONVERSATION_MODEL", "gemini-3.1-flash-live-preview")
VOICE = os.getenv("GEMINI_CONVERSATION_VOICE", "Aoede")
BACKEND_URL = os.getenv("PODMAN_BACKEND_URL", "http://127.0.0.1:8787").rstrip("/")
INTERNAL_AGENT_TOKEN = os.getenv("INTERNAL_AGENT_TOKEN", "")
REPO_SLUG = os.getenv("PODMAN_REPO_SLUG", "karti-ai/podman")


def _resolve_repo_root() -> str:
    override = os.getenv("PODMAN_REPO_ROOT")
    if override:
        return override
    here = os.path.dirname(os.path.abspath(__file__))
    try:
        out = subprocess.run(
            ["git", "-C", here, "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except Exception:
        pass
    return os.path.abspath(os.path.join(here, "..", ".."))


REPO_ROOT = _resolve_repo_root()

INSTRUCTIONS = """You are PodMan, a concise real-time engineering teammate.
You are in a private 1:1 voice conversation with one developer.

Use PodMan tools before making claims about current work, git state, collisions, blockers,
team memory, or recent decisions. Keep spoken answers short. Prefer one useful next step.
If a critical collision event arrives, stop the current turn and state the alert immediately.
To find code, files, symbols, or how something is implemented in the repository, call search_repo.
For complex repository, terminal, GitHub, MongoDB, build, install, deploy, or multi-step tasks,
call delegate_to_hermes. Do not run those actions directly. If the user says stop, wait, cancel,
or change of plans while Hermes is running, call abort_active_hermes_job immediately.
Do not reveal raw secrets, API keys, private tokens, or another teammate's private notes."""


def parse_metadata(raw: str | None) -> dict[str, str]:
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return {str(k): str(v) for k, v in data.items() if v is not None}


def request_json(path: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> Any:
    if not INTERNAL_AGENT_TOKEN:
        raise RuntimeError("INTERNAL_AGENT_TOKEN is not configured")
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = request.Request(
        f"{BACKEND_URL}{path}",
        data=data,
        method=method,
        headers={
            "authorization": f"Bearer {INTERNAL_AGENT_TOKEN}",
            "content-type": "application/json",
        },
    )
    try:
        with request.urlopen(req, timeout=5) as res:
            payload = res.read().decode("utf-8")
            return json.loads(payload) if payload else {}
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"PodMan backend returned {exc.code}: {detail}") from exc


class PodManLiveAgent(Agent):
    def __init__(self, pod_id: str, identity: str, session_id: str, conversation_room: str) -> None:
        super().__init__(instructions=INSTRUCTIONS)
        self.pod_id = pod_id
        self.identity = identity
        self.session_id = session_id
        self.conversation_room = conversation_room
        self.active_hermes_job_id: str | None = None
        self.last_spoken_progress_at = 0.0

    @function_tool()
    async def get_active_pod_context(self, context: RunContext) -> str:
        """Get the current PodMan context for this developer and pod."""
        data = await asyncio.to_thread(
            request_json,
            f"/api/internal/pods/{self.pod_id}/live-context?identity={self.identity}",
        )
        return json.dumps(data, ensure_ascii=True)[:12000]

    @function_tool()
    async def record_conversation_note(self, context: RunContext, note: str, kind: str = "summary") -> str:
        """Store a useful decision, outcome, or preference learned during this conversation."""
        await asyncio.to_thread(
            request_json,
            f"/api/internal/pods/{self.pod_id}/live-conversation/{self.session_id}/note",
            method="POST",
            body={"identity": self.identity, "kind": kind, "note": note},
        )
        return "Saved to PodMan memory."

    @function_tool()
    async def get_recent_changes(self, context: RunContext) -> str:
        """Get recent local git and activity signals for this developer."""
        data = await asyncio.to_thread(
            request_json,
            f"/api/internal/pods/{self.pod_id}/live-context?identity={self.identity}",
        )
        focused = {
            "identity": data.get("identity"),
            "currentGitState": data.get("currentGitState"),
            "memberHistory": data.get("memberHistory"),
            "recentCollisions": data.get("recentCollisions"),
        }
        return json.dumps(focused, ensure_ascii=True)[:8000]

    @function_tool()
    async def search_team_memory(self, context: RunContext, query: str) -> str:
        """Search current compact team memory for information relevant to a query."""
        data = await asyncio.to_thread(
            request_json,
            f"/api/internal/pods/{self.pod_id}/live-context?identity={self.identity}",
        )
        haystack = json.dumps(data, ensure_ascii=True)
        query_terms = [term.lower() for term in query.split() if len(term) > 2]
        if not query_terms:
            return haystack[:6000]
        snippets = []
        lower = haystack.lower()
        for term in query_terms[:8]:
            idx = lower.find(term)
            if idx >= 0:
                snippets.append(haystack[max(0, idx - 400) : idx + 1200])
        return "\n---\n".join(snippets)[:8000] or haystack[:6000]

    @function_tool()
    async def search_repo(self, context: RunContext, query: str, max_results: int = 12) -> str:
        """Search the team's code repository (github.com/karti-ai/podman) for code, symbols,
        filenames, config, or any text. Use this to find where something is implemented or which
        files mention a term before answering questions about the codebase. Searches the live
        local checkout of the main branch, so results are always current.
        """
        cleaned = " ".join(query.split()).strip()
        if not cleaned:
            return "Provide a non-empty search query."
        limit = max(1, min(int(max_results or 12), 40))
        cmd = [
            "rg",
            "--line-number",
            "--no-heading",
            "--color",
            "never",
            "--smart-case",
            "--max-count",
            "3",
            "--max-columns",
            "240",
            "-g",
            "!*.lock",
            "-g",
            "!pnpm-lock.yaml",
            "-g",
            "!uv.lock",
            "-g",
            "!*.min.*",
            "--",
            cleaned,
            REPO_ROOT,
        ]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
        except asyncio.TimeoutError:
            return "Repo search timed out. Try a more specific query."
        except FileNotFoundError:
            return "Repo search is unavailable on this host (ripgrep is not installed)."
        if proc.returncode not in (0, 1):  # rg: 0=match, 1=no match, 2=error
            return f"Repo search failed: {stderr.decode('utf-8', 'replace')[:300]}"
        prefix = REPO_ROOT + os.sep
        lines: list[str] = []
        for line in stdout.decode("utf-8", "replace").splitlines():
            lines.append(line[len(prefix) :] if line.startswith(prefix) else line)
            if len(lines) >= limit:
                break
        if not lines:
            return f'No matches for "{cleaned}" in {REPO_SLUG}.'
        body = "\n".join(lines)
        return f'Matches for "{cleaned}" in {REPO_SLUG} (path:line):\n{body}'[:7000]

    @function_tool()
    async def delegate_to_hermes(
        self,
        context: RunContext,
        prompt: str,
        context_scope: str = "current_repo",
        target_repository: str = "",
        risk_level: str = "read_only",
        requires_confirmation: bool = False,
        success_criteria: list[str] | None = None,
    ) -> str:
        """Hand off a complex engineering task to Hermes, PodMan's autonomous backend execution engine.

        Use this for filesystem, terminal, GitHub, MongoDB, build, install, deploy, test,
        or multi-step repository tasks. Do not use this for simple conversational answers.
        """
        body = {
            "prompt": prompt,
            "contextScope": context_scope,
            "targetRepository": target_repository or "karti-ai/podman",
            "riskLevel": risk_level,
            "requiresConfirmation": requires_confirmation,
            "successCriteria": success_criteria or ["Hermes completes the requested inspection."],
            "podId": self.pod_id,
            "identity": self.identity,
            "sessionId": self.session_id,
            "conversationRoom": self.conversation_room,
        }
        job = await asyncio.to_thread(request_json, "/api/internal/hermes/jobs", method="POST", body=body)
        self.active_hermes_job_id = str(job["id"])
        return json.dumps(
            {
                "status": "accepted",
                "job_id": self.active_hermes_job_id,
                "spoken_ack": "Hermes is starting that now. I will keep you posted.",
            },
            ensure_ascii=True,
        )

    @function_tool()
    async def abort_active_hermes_job(self, context: RunContext, reason: str = "User changed plans") -> str:
        """Abort the currently running Hermes job immediately."""
        if not self.active_hermes_job_id:
            return "No active Hermes job is running."
        job = await asyncio.to_thread(
            request_json,
            f"/api/internal/hermes/jobs/{self.active_hermes_job_id}/abort",
            method="POST",
            body={"reason": reason},
        )
        return json.dumps(
            {
                "status": job.get("status", "aborting"),
                "job_id": self.active_hermes_job_id,
                "spoken_ack": "Stopped. Hermes is aborting the job before making further changes.",
            },
            ensure_ascii=True,
        )

    def should_speak_progress(self, event: dict[str, Any]) -> bool:
        event_type = event.get("type")
        if event_type in {"completed", "failed", "aborted", "needs_confirmation"}:
            return True
        if event_type not in {"heartbeat", "step_started", "step_completed"}:
            return False
        monotonic = time.monotonic()
        if monotonic - self.last_spoken_progress_at < 8:
            return False
        self.last_spoken_progress_at = monotonic
        return True


server = AgentServer()


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: agents.JobContext):
    metadata = parse_metadata(getattr(ctx.job, "metadata", None))
    pod_id = metadata.get("podId", "demo-pod")
    identity = metadata.get("identity", "developer")
    session_id = metadata.get("sessionId", "unknown")

    session = AgentSession(
        llm=google.realtime.RealtimeModel(
            model=MODEL,
            voice=VOICE,
        ),
    )
    agent = PodManLiveAgent(
        pod_id=pod_id,
        identity=identity,
        session_id=session_id,
        conversation_room=ctx.room.name,
    )

    def on_data_received(*args: Any):
        payload = args[0] if args else b""
        if isinstance(payload, str):
            raw = payload
        else:
            raw = bytes(payload).decode("utf-8", "replace")
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return
        msg_type = msg.get("type")
        if msg_type == "HERMES_JOB_EVENT":
            event = msg.get("event") or {}
            summary = str(event.get("message") or "").strip()
            if str(event.get("type")) in {"completed", "failed", "aborted"}:
                agent.active_hermes_job_id = None
        elif msg_type == "LIVE_CONVERSATION_EVENT":
            event = msg.get("event") or {}
            summary = str(event.get("summary") or "").strip()
        else:
            return
        if not summary:
            return

        async def interrupt_and_say() -> None:
            try:
                if msg_type == "LIVE_CONVERSATION_EVENT":
                    await session.interrupt(force=True)
            except Exception as exc:
                logger.warning("interrupt failed: %s", exc)
            if msg_type == "LIVE_CONVERSATION_EVENT" or agent.should_speak_progress(event):
                await session.say(summary, allow_interruptions=True, add_to_chat_ctx=True)

        asyncio.create_task(interrupt_and_say())

    ctx.room.on("data_received", on_data_received)
    await session.start(room=ctx.room, agent=agent)
    await ctx.connect()


if __name__ == "__main__":
    agents.cli.run_app(server)
