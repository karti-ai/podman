import asyncio
import json
import logging
import os
from typing import Any
from urllib import error, request

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentServer, AgentSession, RunContext, function_tool
from livekit.plugins import google

load_dotenv(".env.local")

logger = logging.getLogger("podman-live-conversation")

AGENT_NAME = "podman-live-conversation"
MODEL = os.getenv("GEMINI_CONVERSATION_MODEL", "gemini-3.1-flash-live-preview")
VOICE = os.getenv("GEMINI_CONVERSATION_VOICE", "Aoede")
BACKEND_URL = os.getenv("PODMAN_BACKEND_URL", "http://127.0.0.1:8787").rstrip("/")
INTERNAL_AGENT_TOKEN = os.getenv("INTERNAL_AGENT_TOKEN", "")

INSTRUCTIONS = """You are PodMan, a concise real-time engineering teammate.
You are in a private 1:1 voice conversation with one developer.

Use PodMan tools before making claims about current work, git state, collisions, blockers,
team memory, or recent decisions. Keep spoken answers short. Prefer one useful next step.
If a critical collision event arrives, stop the current turn and state the alert immediately.
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
    def __init__(self, pod_id: str, identity: str, session_id: str) -> None:
        super().__init__(instructions=INSTRUCTIONS)
        self.pod_id = pod_id
        self.identity = identity
        self.session_id = session_id

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
    agent = PodManLiveAgent(pod_id=pod_id, identity=identity, session_id=session_id)

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
        if msg.get("type") != "LIVE_CONVERSATION_EVENT":
            return
        event = msg.get("event") or {}
        summary = str(event.get("summary") or "").strip()
        if not summary:
            return

        async def interrupt_and_say() -> None:
            try:
                await session.interrupt(force=True)
            except Exception as exc:
                logger.warning("interrupt failed: %s", exc)
            await session.say(summary, allow_interruptions=True, add_to_chat_ctx=True)

        asyncio.create_task(interrupt_and_say())

    ctx.room.on("data_received", on_data_received)
    await session.start(room=ctx.room, agent=agent)
    await ctx.connect()


if __name__ == "__main__":
    agents.cli.run_app(server)
