"""One Lucy turn in browser-first Cloud (ADR-0476), from admission to the last event.

`admit` asks the AI gateway (`selecta.ai.gateway.plan_turn`) before anything else: it takes the
account's run slot, routes the turn down never up, counts it against the month's allowance and
checks the dollar ceilings. A refusal (the slot is busy, Lucy is paused) is answered at once and
nothing is counted. `Runner` then runs the turn on its own thread: with a model, a bounded loop
of model calls and tool calls under the plan's ceilings (cycles, seconds, output tokens, the
turn's cost cap); without one (allowance used, ceiling reached, no model reachable) the built-in
answer, which says plainly why and still searches the library. Either way `finish_turn` settles
the run with the real tokens, and a failed or stopped turn is given back.

Everything the page sees is an event in the conversation's log, in the local page's shapes:
`run.state`, `message.started`, batched `message.delta`, `message.completed`, a card per tool
call, `run.usage`, `run.limit`, `error`.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.engine import Engine

from selecta.ai import gateway, registry
from selecta.ai.allowance import month_resets_at
from selecta.ai.registry import Provider, RequestClass, Tier
from selecta.ai.runs import Outcome
from selecta.billing import plans, stripe_sync
from selecta.lucy import cloud_prompt, cloud_store, cloud_tools
from selecta.lucy.providers import (
    AnthropicProvider,
    OpenAICompatibleProvider,
    ProviderError,
    TurnResult,
)
from selecta.persistence import new_id, transaction

FLUSH_CHARS = 80
FLUSH_SECONDS = 0.15
HISTORY_MESSAGES = 16
NOTE_CHARS = 700
PLANNING = re.compile(
    r"\b(make|build|create|plan|start)\b.{0,40}\b(mix|set|playlist)\b|\b\d+\s*(hour|hr|h|min)",
    re.IGNORECASE,
)

ProviderFactory = Callable[[gateway.ProviderSettings, gateway.TurnPlan], Any]


def request_class(text: str) -> RequestClass:
    """A whole new mix is a planning turn; anything else an everyday one (ADR-0404)."""
    return RequestClass.PLANNING if PLANNING.search(text or "") else RequestClass.EVERYDAY


def tier_of(conn, workspace_id: str) -> Tier:
    entitlement = stripe_sync.effective_entitlement(conn, workspace_id)
    plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
    try:
        return Tier(plan.id)
    except ValueError:
        return Tier.FREE


_SEEDED: set[int] = set()


def _seed_once(conn) -> None:
    """The model registry's starting deployments and routing, once per database per process:
    without them every turn would go to the built-in planner. Safe on every start."""
    key = id(conn.engine)
    if key in _SEEDED:
        return
    registry.seed_defaults(conn)
    _SEEDED.add(key)


def admit(
    conn, workspace_id: str, conversation_id: str, text: str, *, timezone: str | None,
    tier: Tier | None = None,
) -> gateway.TurnPlan:
    """Plan the turn inside the caller's workspace transaction. Raises `gateway.TurnRefused`."""
    _seed_once(conn)
    return gateway.plan_turn(
        conn, workspace_id=workspace_id, tier=tier or tier_of(conn, workspace_id),
        request_class=request_class(text), prompt_version=cloud_prompt.PROMPT_VERSION,
        tool_schema_version=cloud_tools.TOOL_SCHEMA_VERSION, conversation_id=conversation_id,
        timezone=timezone or "UTC",
    )


def default_provider(settings: gateway.ProviderSettings, plan: gateway.TurnPlan) -> Any:
    if settings.provider["kind"] == Provider.OPENAI.value:
        return OpenAICompatibleProvider(**settings.provider_args())
    return AnthropicProvider(**settings.provider_args())


@dataclass
class Job:
    engine: Engine
    workspace_id: str
    user_id: str
    conversation_id: str
    turn_id: str
    text: str
    plan: gateway.TurnPlan
    timezone: str | None
    proposals_on: bool = True
    provider_factory: ProviderFactory = default_provider
    stop: threading.Event = field(default_factory=threading.Event)
    result: dict[str, Any] = field(default_factory=dict)


class Runner:
    """Runs turns on their own threads; the API never waits on a model."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.jobs: dict[str, Job] = {}
        self.threads: list[threading.Thread] = []

    def start(self, job: Job) -> None:
        with self.lock:
            self.jobs[job.conversation_id] = job
        thread = threading.Thread(target=self._run, args=(job,), daemon=True,
                                  name=f"lucy-cloud-{job.turn_id}")
        self.threads = [t for t in self.threads if t.is_alive()] + [thread]
        thread.start()

    def _run(self, job: Job) -> None:
        try:
            asyncio.run(run_turn(job))
        finally:
            with self.lock:
                if self.jobs.get(job.conversation_id) is job:
                    del self.jobs[job.conversation_id]

    def stop(self, conversation_id: str) -> bool:
        with self.lock:
            job = self.jobs.get(conversation_id)
        if job is None:
            return False
        job.stop.set()
        return True

    def wait(self, timeout: float = 60.0) -> None:
        deadline = time.monotonic() + timeout
        for thread in list(self.threads):
            thread.join(max(0.0, deadline - time.monotonic()))


class Events:
    """Writes one turn's events, each in its own short transaction, so the page can read them
    while the turn is still going."""

    def __init__(self, job: Job, run: str) -> None:
        self.job, self.run = job, run

    def emit(self, kind: str, payload: dict, *, plan: str | None = None,
             step: str | None = None) -> None:
        job = self.job
        with transaction(job.engine, job.workspace_id) as conn:
            cloud_store.append_event(conn, job.workspace_id, job.conversation_id, kind, payload,
                                     turn=job.turn_id, run=self.run, plan=plan, step=step)

    def state(self, state: str, cycles: int = 0, steps: int = 0, error: str | None = None):
        payload: dict[str, Any] = {"state": state, "cycles": cycles, "steps": steps}
        if error:
            payload["error"] = error
        self.emit("run.state", payload)


class Stopped(Exception):
    pass


class Writer:
    """The reply's text as it arrives, batched so a reply is a handful of rows, not hundreds."""

    def __init__(self, events: Events, message: str, stopped: Callable[[], bool]) -> None:
        self.events, self.message, self.stopped = events, message, stopped
        self.content, self.buffer = "", ""
        self.flushed_at = time.monotonic()

    async def write(self, text: str) -> None:
        if self.stopped():
            raise Stopped()
        if not text:
            return
        self.buffer += text
        if len(self.buffer) >= FLUSH_CHARS or time.monotonic() - self.flushed_at >= FLUSH_SECONDS:
            self.flush()
        await asyncio.sleep(0)

    def flush(self) -> None:
        if not self.buffer:
            return
        self.events.emit("message.delta", {"message": self.message, "text": self.buffer})
        self.content += self.buffer
        self.buffer = ""
        self.flushed_at = time.monotonic()

    def text(self) -> str:
        return self.content + self.buffer


def _model_history(job: Job, before_seq: int) -> list[dict[str, Any]]:
    """Earlier messages for the model, alternating and starting with the person, each answer
    carrying the note of the tool work it did (so "add two more" has the ids it needs)."""
    with transaction(job.engine, job.workspace_id) as conn:
        rows = cloud_store.history(conn, job.workspace_id, job.conversation_id, before_seq,
                                   HISTORY_MESSAGES)
    out: list[dict[str, Any]] = []
    for row in rows:
        content = (row["content"] or "").strip()
        note = (row["meta"] or {}).get("note")
        if row["role"] == "assistant" and note:
            content = f"{content}\n\n[Tool results I used: {note}]".strip()
        if not content:
            continue
        if out and out[-1]["role"] == row["role"]:
            out[-1]["content"] += "\n\n" + content
        else:
            out.append({"role": row["role"], "content": content})
    while out and out[0]["role"] != "user":
        out.pop(0)
    if out and out[-1]["role"] == "user":
        # an earlier turn that never got an answer: keep its words with this one
        out[-1]["content"] += "\n\n(That message got no answer.)"
        out.append({"role": "assistant", "content": "Sorry, I couldn't answer that one."})
    return out


def _resets_words(job: Job) -> str:
    when = dt.datetime.fromtimestamp(month_resets_at(job.plan.month, "UTC"), dt.UTC)
    return f"{when.day} {when:%B}"


def builtin_words(job: Job, ctx: cloud_tools.CloudCtx) -> str:
    """What Lucy says when no model answers this turn: why, and what still works."""
    limited = job.plan.limited
    if limited in {"allowance", "spend"}:
        why = (f"You've used this month's Lucy turns on your plan, so I can't think this one "
               f"through. They come back on {_resets_words(job)}.")
    elif limited == "platform":
        why = "Lucy's AI is very busy right now, so I can't think this one through."
    else:
        why = "Lucy's AI isn't reachable right now, so I can't think this one through."
    found = cloud_tools.search_songs(ctx, query=job.text, limit=5)
    songs = found.get("songs") or []
    if songs:
        listed = "; ".join(f"{s['title']} - {s['artist']}" for s in songs)
        return f"{why} I looked for your words in your library and found: {listed}."
    return f"{why} Your mixes and music are unaffected, and Make a Mix still works."


async def run_turn(job: Job) -> None:
    plan = job.plan
    events = Events(job, plan.run_id)
    with transaction(job.engine, job.workspace_id) as conn:
        message = cloud_store.add_assistant_message(
            conn, job.workspace_id, job.conversation_id, job.turn_id, plan.run_id
        )
        cloud_store.set_turn(conn, job.workspace_id, job.turn_id, status="running",
                             run_id=plan.run_id)
    events.emit("message.started", {"message": message["id"], "role": "assistant",
                                    "seq": message["seq"]})
    ctx = cloud_tools.CloudCtx(job.engine, job.workspace_id, job.user_id, job.conversation_id,
                               job.turn_id, proposals_on=job.proposals_on)

    def stopped() -> bool:
        return job.stop.is_set()

    writer = Writer(events, message["id"], stopped)
    usage = {"tokens_in": 0, "tokens_out": 0, "cache_read": 0, "cache_write": 0}
    notes: list[str] = []
    outcome, error_code, final, error = Outcome.COMPLETED, None, "completed", None
    cycles = steps = 0
    try:
        events.state("interpreting")
        if plan.is_builtin:
            events.state("streaming")
            await writer.write(builtin_words(job, ctx))
        else:
            cycles, steps = await _model_loop(job, ctx, events, writer, usage, notes)
    except Stopped:
        outcome, final, error_code = Outcome.CANCELLED, "cancelled", "stopped"
    except gateway.GatewayError as problem:
        outcome, final, error_code, error = Outcome.FAILED, "failed", problem.code, problem.message
        events.emit("error", {"code": problem.code, "message": "Lucy couldn't start.",
                              "recoverable": True})
        await _say(writer, "Lucy couldn't start this one. Your mixes and music are safe; "
                           "try again in a moment.")
    except ProviderError as problem:
        said = bool(writer.text())
        outcome = Outcome.INCOMPLETE if said else Outcome.FAILED
        final, error_code, error = "failed", problem.code, str(problem)
        events.emit("error", {"code": problem.code, "message": str(problem),
                              "recoverable": problem.recoverable})
        await _say(writer, f"{problem} Your mixes and music are unaffected; try again.")
    except TimeoutError:
        outcome, final, error_code = Outcome.INCOMPLETE, "interrupted", "timeout"
        await _say(writer, "(I ran out of time for this message. Say \"continue\" to go on.)")
    except Exception:  # noqa: BLE001 - a turn must always end truthfully and give its slot back
        outcome, final, error_code = Outcome.FAILED, "failed", "internal"
        events.emit("error", {"code": "internal", "message": "Something went wrong inside "
                              "Lucy.", "recoverable": True})
        await _say(writer, "Something went wrong inside Lucy. Your mixes and music are safe; "
                           "try again.")
    finally:
        writer.flush()
        status = {"completed": "complete", "cancelled": "cancelled",
                  "interrupted": "interrupted"}.get(final, "failed")
        revision = ctx.proposed[-1] if ctx.proposed else None
        with transaction(job.engine, job.workspace_id) as conn:
            cloud_store.finish_message(
                conn, job.workspace_id, message["id"], writer.content, status, revision,
                {"note": " | ".join(notes)[-NOTE_CHARS:]} if notes else {},
            )
            cloud_store.set_turn(conn, job.workspace_id, job.turn_id, status=final)
            summary = gateway.finish_turn(
                conn, plan, outcome=outcome, tokens_in=usage["tokens_in"],
                tokens_out=usage["tokens_out"], cache_read_tokens=usage["cache_read"],
                cache_write_tokens=usage["cache_write"], error_code=error_code,
            )
        events.emit("message.completed", {"message": message["id"], "status": status,
                                          "content": writer.content})
        events.state(final, cycles, steps, error)
        with transaction(job.engine, job.workspace_id) as conn:
            cloud_store.prune_deltas(conn, job.workspace_id, job.conversation_id, plan.run_id)
        job.result.update(
            outcome=outcome.value, text=writer.content, cost_usd=summary.cost_usd, **usage,
            proposals=list(ctx.proposed), tools=list(notes), cycles=cycles,
            deployment=plan.deployment.id, model=plan.deployment.model_id,
            limited=plan.limited,
        )


async def _say(writer: Writer, words: str) -> None:
    writer.stopped = lambda: False
    await writer.write(("\n\n" if writer.text() else "") + words)


async def _model_loop(
    job: Job, ctx: cloud_tools.CloudCtx, events: Events, writer: Writer,
    usage: dict[str, int], notes: list[str],
) -> tuple[int, int]:
    plan = job.plan
    settings = gateway.provider_settings_for(plan)
    provider = job.provider_factory(settings, plan)
    tools = [provider.tool(spec["name"], spec["description"], spec["schema"])
             for spec in cloud_prompt.tool_specs(job.proposals_on)]
    with transaction(job.engine, job.workspace_id) as conn:
        seq = cloud_store.turn_row(conn, job.workspace_id, job.turn_id).seq
    messages = _model_history(job, seq) + [provider.user(job.text)]
    system = [
        cloud_prompt.INSTRUCTIONS,
        cloud_prompt.dynamic(cloud_tools.library_summary(ctx),
                             dt.datetime.now(dt.UTC).strftime("%A %d %B %Y"), job.proposals_on),
    ]
    limits = plan.limits
    deadline = time.monotonic() + limits.max_seconds
    cycles = steps = 0
    while True:
        if job.stop.is_set():
            raise Stopped()
        if cycles >= limits.max_cycles:
            events.emit("run.limit", {"limit": "cycles", "used": cycles, "max": limits.max_cycles,
                                      "text": "Lucy reached its limit of work rounds."})
            await writer.write("\n\n(I stopped after a few rounds of work, my limit for one "
                               "message. Say \"continue\" to keep going.)")
            break
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError()
        cycles += 1
        events.state("streaming", cycles, steps)
        written = writer.text()
        if written and not written.endswith("\n"):
            await writer.write("\n\n")
        result: TurnResult = await asyncio.wait_for(
            provider.turn(system, messages, tools, writer.write), remaining
        )
        usage["tokens_in"] += result.tokens_in
        usage["tokens_out"] += result.tokens_out
        usage["cache_read"] += getattr(result, "cache_read", 0)
        usage["cache_write"] += getattr(result, "cache_write", 0)
        spent = plan.deployment.prices.cost(usage["tokens_in"], usage["tokens_out"],
                                            usage["cache_read"], usage["cache_write"])
        events.emit("run.usage", {"tokens_in": usage["tokens_in"],
                                  "tokens_out": usage["tokens_out"], "cost_usd": spent,
                                  "estimated": False})
        if result.stop == "refusal":
            await writer.write("\n\n(I can't help with that one.)")
            break
        if not result.calls:
            if result.stop == "max_tokens":
                await writer.write("\n\n(That answer got too long; ask me for the rest.)")
            break
        if spent >= limits.max_cost_usd:
            events.emit("run.limit", {"limit": "spend", "used": spent,
                                      "max": limits.max_cost_usd,
                                      "text": "Lucy reached the cost limit for one message."})
            await writer.write("\n\n(I stopped here: that was as much work as one message "
                               "allows.)")
            break
        events.state("running_tools", cycles, steps)
        outputs = []
        plan_id = new_id()
        listed = [{"id": f"s{steps + i + 1}", "op": call.name,
                   "family": cloud_tools.TITLES.get(call.name, ("", "other"))[1],
                   "title": cloud_tools.TITLES.get(call.name, (call.name, ""))[0], "note": None}
                  for i, call in enumerate(result.calls)]
        events.emit("plan.started", {"steps": listed}, plan=plan_id)
        started = time.monotonic()
        for call, card in zip(result.calls, listed, strict=True):
            steps += 1
            events.emit("step.started", {**card, "status": "running", "attempt": 1,
                                         "notices": [], "visual": {}},
                        plan=plan_id, step=card["id"])
            if call.problem:
                text, ok = json.dumps({"error": call.problem}), False
            else:
                text, ok = cloud_tools.run_tool(ctx, call.name, call.input)
            outputs.append((call, text, ok))
            notes.append(_note(call.name, call.input, text))
            count = _count_of(text)
            events.emit(f"step.{'completed' if ok else 'failed'}",
                        {**card, "status": "completed" if ok else "failed", "attempt": 1,
                         "count": count, "notices": [], "visual": {},
                         "error": None if ok else _error_of(text)},
                        plan=plan_id, step=card["id"])
        events.emit("plan.completed", {"ok": all(ok for _c, _t, ok in outputs),
                                       "duration_ms": int((time.monotonic() - started) * 1000)},
                    plan=plan_id)
        messages += provider.results(result, outputs)
        events.state("evaluating", cycles, steps)
    return cycles, steps


def _note(name: str, arguments: Any, text: str) -> str:
    """A short memory of one tool call for later turns: the ids and names it returned."""
    try:
        body = json.loads(text)
    except ValueError:
        return name
    songs = body.get("songs") or (body.get("mix") or {}).get("order") or []
    listed = ", ".join(f"{s['id']}={s['title']} - {s['artist']}" for s in songs[:12])
    if body.get("proposal"):
        return f"{name}: proposed {body['proposal']['songs']} songs"
    args = json.dumps(arguments, ensure_ascii=False)[:80] if arguments else ""
    return f"{name}({args}): {listed or body.get('error') or 'done'}"


def _count_of(text: str) -> int | None:
    try:
        body = json.loads(text)
    except ValueError:
        return None
    if isinstance(body.get("songs"), list):
        return len(body["songs"])
    return None


def _error_of(text: str) -> str:
    try:
        return str(json.loads(text).get("error") or "That didn't work.")[:300]
    except ValueError:
        return "That didn't work."


RUNNER = Runner()

__all__ = ["RUNNER", "Job", "Runner", "admit", "builtin_words", "request_class", "run_turn"]
