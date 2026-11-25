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
from dataclasses import dataclass, field, replace
from typing import Any

from sqlalchemy.engine import Engine

from selecta.ai import gateway, registry
from selecta.ai.allowance import month_resets_at
from selecta.ai.registry import Provider, RequestClass, Tier
from selecta.ai.runs import Outcome
from selecta.billing import plans, stripe_sync
from selecta.lucy import cloud_health, cloud_prompt, cloud_store, cloud_tools, cloud_world
from selecta.lucy.providers import (
    AnthropicProvider,
    OpenAICompatibleProvider,
    ProviderError,
    TurnResult,
)
from selecta.persistence import db_now, new_id, transaction
from selecta.work import outbox

STOP_CHECK_SECONDS = 1.0
CUT_OFF = ("(Your last reply was cut off before you finished. Think briefly, then answer "
           "or make the proposal now, in few words.)")
LAST_ROUND = ("\n(This is your last round of work for this message: answer now, and make the "
              "proposal if you have the songs for it.)")
FLUSH_CHARS = 80
FLUSH_SECONDS = 0.15
HISTORY_MESSAGES = 200
HISTORY_CHARS = {"free": 12_000, "standard": 40_000, "premium": 80_000}
"""How much earlier conversation is sent verbatim, per plan (about 3k, 10k and 20k tokens)."""
NOTE_CHARS = 700
# A length is a number and a unit that ends there: "2 hours", "90min", "2h30", never "2 house
# tracks" or "10 minor-key songs" (the unit must not run on into another word).
_HOURS = r"(?:hours?|hrs?|h)(?![a-z])"
_MINUTES = r"(?:minutes?|mins?)(?![a-z])"
PLANNING = re.compile(
    r"\b(make|build|create|plan|start)\b.{0,40}\b(mix|set|playlist)\b"
    rf"|\b\d+(?:\.\d+)?[\s-]*(?:{_HOURS}|{_MINUTES})",
    re.IGNORECASE,
)
_COUNT = {name: number for number, name in enumerate(
    "one two three four five six seven eight nine ten eleven twelve".split(), start=1)}
ASKED_HOURS = re.compile(
    rf"\b(\d+(?:\.\d+)?|{'|'.join(_COUNT)})[\s-]*{_HOURS}", re.IGNORECASE)
ASKED_MINUTES = re.compile(rf"\b(\d+(?:\.\d+)?)[\s-]*{_MINUTES}", re.IGNORECASE)
LONG_EVENT = re.compile(
    r"\b(all[\s-]night(?:er)?|all[\s-]day|(?:whole|entire) (?:night|evening|day|party|event)"
    r"|wedding|festival)\b",
    re.IGNORECASE,
)
DEEP_PLAN_MINUTES = 120
"""A whole new mix this long or longer, or for a named long event, is a deep plan."""
QUESTION = re.compile(
    r"^\W*(?:what|whats|who|whos|whose|which|when|where|how\s+(?:long|many|much))\b",
    re.IGNORECASE,
)
QUICK_WORDS = 8
"""A question this short that asks for no new mix is a quick turn."""

BUSY_WORDS = ("Lucy is busy right now. Try again in a moment; this didn't use one of your "
              "turns, and your mixes and music are unaffected.")
ProviderFactory = Callable[[gateway.ProviderSettings, gateway.TurnPlan], Any]


def asked_minutes(text: str) -> float:
    """The longest length the words ask for, in minutes: "2 hours 30 min" is 150, "three hour"
    is 180, and words that name no length are 0."""
    hours = [float(_COUNT.get(found.lower()) or found) for found in ASKED_HOURS.findall(text)]
    minutes = [float(found) for found in ASKED_MINUTES.findall(text)]
    return max(hours, default=0.0) * 60 + max(minutes, default=0.0)


def request_class(text: str | None) -> RequestClass:
    """Which of the four kinds of turn the plans sell these words ask for (ADR-0404).

    - A whole new mix, or anything naming a length, is a planning turn; one of two hours or
      more, or for a long event (a wedding, a festival, all night), is a deep plan.
    - A short question that asks for no new mix ("what's playing next?") is a quick turn.
    - Everything else is an everyday turn.

    Every class is answered by the plan's own model, so this only decides which allowance the
    turn counts against (`ai.allowance.BUCKETS`). A wrong guess never refuses a turn on its
    own: a used-up allowance steps down to the next one (`ai.allowance.STEP_DOWN`).
    """
    words = (text or "").strip()
    if not words:
        return RequestClass.EVERYDAY
    if PLANNING.search(words):
        long = asked_minutes(words) >= DEEP_PLAN_MINUTES or LONG_EVENT.search(words)
        return RequestClass.DEEP_PLAN if long else RequestClass.PLANNING
    if len(words.split()) <= QUICK_WORDS and QUESTION.search(words):
        return RequestClass.QUICK
    return RequestClass.EVERYDAY


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


CALL_SECONDS = 25.0
"""One model call's own limit, so a stalled request is retried once well inside the turn's
limit (Free's is 60 s) instead of using all of it."""


def default_provider(settings: gateway.ProviderSettings, plan: gateway.TurnPlan) -> Any:
    if settings.provider["kind"] == Provider.OPENAI.value:
        return OpenAICompatibleProvider(**settings.provider_args())
    provider = AnthropicProvider(**settings.provider_args())
    provider.client = provider.client.with_options(timeout=CALL_SECONDS, max_retries=1)
    return provider


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
    device_id: str | None = None
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

    def alive_turns(self) -> set[str]:
        with self.lock:
            return {job.turn_id for job in self.jobs.values()}

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
    """Writes one turn's events, each in its own short transaction, so every device can read
    them while the turn is still going. A conversation deleted meanwhile (from any device)
    takes no more events: nothing a running turn writes can bring it back."""

    def __init__(self, job: Job, run: str) -> None:
        self.job, self.run = job, run
        self.gone = False

    def emit(self, kind: str, payload: dict, *, plan: str | None = None,
             step: str | None = None) -> None:
        job = self.job
        if self.gone:
            return
        with transaction(job.engine, job.workspace_id) as conn:
            if not cloud_store.exists(conn, job.workspace_id, job.conversation_id):
                self.gone = True
                job.stop.set()
                return
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
    """The whole conversation for the model, up to the plan's budget (`HISTORY_CHARS`): the
    newest messages verbatim, each answer carrying the note of the tool work it did (so "add
    two more" has the ids it needs), and anything older as one line listing what the person
    asked. A tool call and its result live inside one answer's note, so a cut never splits
    them. Alternating, starting with the person, as the providers need."""
    with transaction(job.engine, job.workspace_id) as conn:
        rows = cloud_store.history(conn, job.workspace_id, job.conversation_id, before_seq,
                                   HISTORY_MESSAGES)
    budget = HISTORY_CHARS.get(job.plan.tier.value, HISTORY_CHARS["free"])
    kept: list[dict[str, Any]] = []
    used = 0
    for row in reversed(rows):
        content = (row["content"] or "").strip()
        note = (row["meta"] or {}).get("note")
        if row["role"] == "assistant" and note:
            content = f"{content}\n\n[Tool results I used: {note}]".strip()
        if not content:
            continue
        if used + len(content) > budget and kept:
            break
        used += len(content)
        kept.append({"role": row["role"], "content": content})
    older = [r for r in rows[: len(rows) - len(kept)] if r["role"] == "user" and r["content"]]
    kept.reverse()
    out: list[dict[str, Any]] = []
    if older and len(kept) < len(rows):
        asked = "; ".join(" ".join(r["content"].split())[:80] for r in older[-12:])
        out = [{"role": "user", "content": f"(Earlier in this conversation I asked: {asked})"},
               {"role": "assistant", "content": "(Noted.)"}]
    for message in kept:
        if out and out[-1]["role"] == message["role"]:
            out[-1]["content"] += "\n\n" + message["content"]
        else:
            out.append(message)
    while out and out[0]["role"] != "user":
        out.pop(0)
    if out and out[-1]["role"] == "user":
        # an earlier turn that never got an answer: keep its words with this one
        out[-1]["content"] += "\n\n(That message got no answer.)"
        out.append({"role": "assistant", "content": "Sorry, I couldn't answer that one."})
    return out


def _resets_words(job: Job) -> str:
    """The first day of the month after the turn's month, as "1 December". The turn's month is
    already the account's own (`gateway.plan_turn` reads it in the account's time zone), so UTC
    here only turns that month into a date and the day is right in every zone."""
    when = dt.datetime.fromtimestamp(month_resets_at(job.plan.month, "UTC"), dt.UTC)
    return f"{when.day} {when:%B}"


def builtin_words(job: Job, ctx: cloud_tools.CloudCtx) -> str:
    """What Lucy says when no model answers this turn: why, and what still works."""
    limited = job.plan.limited
    if limited == "allowance":
        why = (f"You've used this month's Lucy turns on your plan, so I can't think this one "
               f"through. They come back on {_resets_words(job)}.")
    elif limited == "spend":
        # The plan's monthly dollar ceiling, not its turns: turns may well be left, so saying
        # they are used up would be untrue. Both start again with the account's month.
        why = (f"You've reached your plan's monthly limit on Lucy's AI, which is separate from "
               f"your turns, so I can't think this one through. It comes back on "
               f"{_resets_words(job)}.")
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
    changed = _plan_change(job)
    if changed:
        events.emit("run.limit", {"limit": "plan", "text": changed})
    ctx = cloud_tools.CloudCtx(job.engine, job.workspace_id, job.user_id, job.conversation_id,
                               job.turn_id, proposals_on=job.proposals_on)

    checked = {"at": 0.0}

    def stopped() -> bool:
        """Stop pressed on any device: this process hears it at once; another server
        running the turn reads the turn's `stopping` mark within a second."""
        if job.stop.is_set():
            return True
        now = time.monotonic()
        if now - checked["at"] >= STOP_CHECK_SECONDS:
            checked["at"] = now
            with transaction(job.engine, job.workspace_id) as conn:
                row = cloud_store.turn_row(conn, job.workspace_id, job.turn_id)
            if row is None or row.status == "stopping":
                job.stop.set()
        return job.stop.is_set()

    writer = Writer(events, message["id"], stopped)
    # one attempt's tokens: a step down the model chain starts the count again
    usage = {"tokens_in": 0, "tokens_out": 0, "cache_read": 0, "cache_write": 0}
    attempts = Attempts(plan)
    notes: list[str] = []
    outcome, error_code, final, error = Outcome.COMPLETED, None, "completed", None
    cycles = steps = 0
    try:
        events.state("interpreting")
        if plan.is_builtin:
            events.state("streaming")
            await writer.write(builtin_words(job, ctx))
        else:
            cycles, steps = await _model_loop(job, ctx, events, writer, usage, notes, attempts)
            if not writer.text().strip():
                # never a blank bubble
                await writer.write("I don't have an answer for that. Could you say it another "
                                   "way?")
    except Stopped:
        outcome, final, error_code = Outcome.CANCELLED, "cancelled", "stopped"
        done = ("I had already proposed a change, which is in the Your mix pane; nothing was "
                "saved." if ctx.proposed else "Nothing was changed.")
        await _say(writer, f"(Stopped. {done})")
    except gateway.GatewayError as problem:
        outcome, final, error_code, error = Outcome.FAILED, "failed", problem.code, problem.message
        cloud_health.log.warning(
            "lucy gateway failure conversation=%s turn=%s tier=%s deployment=%s code=%s",
            job.conversation_id, job.turn_id, plan.tier.value, plan.deployment.id, problem.code)
        if problem.code == "secret_missing":
            cloud_health.raise_once(
                job.engine, f"Lucy can't reach Anthropic: no API key is set for "
                f"{plan.deployment.id}. Fix: set {plan.deployment.secret_ref}.",
                {"deployment": plan.deployment.id, "tier": plan.tier.value})
        events.emit("error", {"code": problem.code, "message": "Lucy couldn't start.",
                              "recoverable": True})
        await _say(writer, "Lucy couldn't start this one. Your mixes and music are safe; "
                           "try again in a moment.")
    except ProviderError as problem:
        said = bool(writer.text())
        outcome = Outcome.INCOMPLETE if said else Outcome.FAILED
        final, error_code, error = "failed", problem.code, str(problem)
        words = (BUSY_WORDS if problem.recoverable else
                 "Lucy can't answer right now because of a problem on SelectaDJ's side. Your "
                 "mixes and music are safe, and this didn't use one of your turns.")
        events.emit("error", {"code": problem.code, "message": words,
                              "recoverable": problem.recoverable})
        await _say(writer, words)
    except TimeoutError:
        outcome, final, error_code = Outcome.INCOMPLETE, "interrupted", "timeout"
        await _say(writer, "(I ran out of time for this message. Say \"continue\" to go on.)")
    except Exception:  # noqa: BLE001 - a turn must always end truthfully and give its slot back
        cloud_health.log.exception("lucy turn failed conversation=%s turn=%s",
                                   job.conversation_id, job.turn_id)
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
        followups = follow_ups(ctx, notes) if final == "completed" else []
        meta: dict[str, Any] = {"note": " | ".join(notes)[-NOTE_CHARS:]} if notes else {}
        if followups:
            meta["followups"] = followups
        with transaction(job.engine, job.workspace_id) as conn:
            cloud_store.finish_message(
                conn, job.workspace_id, message["id"], writer.content, status, revision, meta,
            )
            cloud_store.set_turn(conn, job.workspace_id, job.turn_id, status=final)
            # every device's Lucy settings card reads its turns again (ADR-0476 item 31)
            outbox.emit(conn, "lucy.turns", job.workspace_id, {"run": plan.run_id},
                        db_now(conn))
            summary = gateway.finish_turn(
                conn, plan, outcome=outcome, tokens_in=usage["tokens_in"],
                tokens_out=usage["tokens_out"], cache_read_tokens=usage["cache_read"],
                cache_write_tokens=usage["cache_write"], error_code=error_code,
                answered_by=attempts.plan.deployment, earlier_cost_usd=attempts.earlier_usd,
            )
        events.emit("message.completed", {"message": message["id"], "status": status,
                                          "content": writer.content,
                                          "meta": {"followups": followups}})
        events.state(final, cycles, steps, error)
        with transaction(job.engine, job.workspace_id) as conn:
            cloud_store.prune_deltas(conn, job.workspace_id, job.conversation_id, plan.run_id)
        job.result.update(
            outcome=outcome.value, text=writer.content, cost_usd=summary.cost_usd, **usage,
            proposals=list(ctx.proposed), tools=list(notes), cycles=cycles,
            deployment=plan.deployment.id, model=plan.deployment.model_id,
            limited=plan.limited, answered_deployment=summary.answered_deployment_id,
            account_cost_usd=summary.account_cost_usd,
        )


def follow_ups(ctx: cloud_tools.CloudCtx, notes: list[str]) -> list[str]:
    """At most two next asks, and only after work they continue: a proposal can be made
    shorter or calmer; songs found can become a mix. Small talk gets none."""
    if ctx.proposed:
        return ["Make it shorter", "Leave out the slowest songs"]
    if any(note.startswith("search_songs") and "=" in note for note in notes):
        return ["Make a mix from these"]
    return []


async def _say(writer: Writer, words: str) -> None:
    writer.stopped = lambda: False
    await writer.write(("\n\n" if writer.text() else "") + words)


@dataclass
class Attempts:
    """Which model is answering the turn now, and what the attempts before it cost. The
    account pays for the attempt that answers; the platform books them all (ADR-0481 rule 5)."""

    plan: gateway.TurnPlan
    earlier_usd: float = 0.0


def _step_down_plans(engine: Engine, plan: gateway.TurnPlan) -> list[gateway.TurnPlan]:
    """The turn's own deployment, then each one down its fallback chain (Opus, Sonnet,
    Haiku) that the tier may use; never the built-in planner, never up."""
    from selecta.ai.spend import turn_limits

    chain = [plan]
    try:
        with transaction(engine) as conn:
            deployments = registry.load_deployments(conn)
    except Exception:  # noqa: BLE001 - no registry, no step-down: the turn's own model only
        return chain
    step = deployments.get(plan.deployment.fallback_id or "")
    while step is not None and not step.is_builtin and len(chain) < 4:
        if step.allowed_for(plan.tier) and step.status.value == "active":
            chain.append(replace(plan, deployment=step, limits=turn_limits(step, plan.tier)))
        step = deployments.get(step.fallback_id or "")
    return chain


async def _model_loop(
    job: Job, ctx: cloud_tools.CloudCtx, events: Events, writer: Writer,
    usage: dict[str, int], notes: list[str], attempts: Attempts,
) -> tuple[int, int]:
    """The model's work for this turn. A failure that isn't the key or a missing header
    (both shared by every model) steps down to the next model, quietly, before nothing has
    been said; the last failure is the person's to hear. `usage` holds the tokens of the
    attempt in `attempts.plan`; what the attempts before it cost is kept apart."""
    chain = _step_down_plans(job.engine, job.plan)
    for index, plan in enumerate(chain):
        attempts.plan = plan
        try:
            return await _one_model(job, ctx, events, writer, usage, notes, plan)
        except ProviderError as problem:
            cloud_health.report_failure(
                job.engine, problem, conversation=job.conversation_id, turn=job.turn_id,
                tier=job.plan.tier.value, deployment=plan.deployment.id,
                model=plan.deployment.model_id,
            )
            shared = problem.status in {401} or (problem.status == 400 and problem.configuration)
            if shared or writer.text().strip() or index == len(chain) - 1:
                raise
            attempts.earlier_usd += plan.deployment.prices.cost(
                usage["tokens_in"], usage["tokens_out"], usage["cache_read"],
                usage["cache_write"])
            usage.update(dict.fromkeys(usage, 0))
    raise AssertionError("unreachable")


async def _one_model(
    job: Job, ctx: cloud_tools.CloudCtx, events: Events, writer: Writer,
    usage: dict[str, int], notes: list[str], plan: gateway.TurnPlan,
) -> tuple[int, int]:
    settings = gateway.provider_settings_for(plan)
    provider = job.provider_factory(settings, plan)
    try:
        return await _model_turns(job, ctx, events, writer, usage, notes, provider, plan)
    finally:
        client = getattr(provider, "client", None)
        if client is not None and hasattr(client, "close"):
            await client.close()  # its connections belong to this turn's event loop


async def _model_turns(
    job: Job, ctx: cloud_tools.CloudCtx, events: Events, writer: Writer,
    usage: dict[str, int], notes: list[str], provider: Any, plan: gateway.TurnPlan,
) -> tuple[int, int]:
    tools = [provider.tool(spec["name"], spec["description"], spec["schema"])
             for spec in cloud_prompt.tool_specs(job.proposals_on)]
    with transaction(job.engine, job.workspace_id) as conn:
        seq = cloud_store.turn_row(conn, job.workspace_id, job.turn_id).seq
    messages = _model_history(job, seq) + [provider.user(job.text)]
    system = [
        cloud_prompt.INSTRUCTIONS,
        cloud_prompt.dynamic(cloud_tools.library_summary(ctx),
                             dt.datetime.now(dt.UTC).strftime("%A %d %B %Y"), job.proposals_on),
        _right_now(job),
    ]
    limits = plan.limits
    deadline = time.monotonic() + limits.max_seconds
    cycles = steps = 0
    cut_once = False
    while True:
        if writer.stopped():
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
            if result.stop == "max_tokens" and not cut_once and cycles < limits.max_cycles:
                # cut off before it could act (long thinking or a long list): once, ask again
                # for a shorter go, rather than leaving the person with nothing
                cut_once = True
                _tell(messages, CUT_OFF)
                continue
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
        if cycles == limits.max_cycles - 1 and outputs:
            # the next round is the last this message allows: say so, so it ends with an answer
            call, text, ok = outputs[-1]
            outputs[-1] = (call, text + LAST_ROUND, ok)
        messages += provider.results(result, outputs)
        events.state("evaluating", cycles, steps)
    return cycles, steps


TIER_WORDS = {"free": "Lucy Basic", "standard": "Lucy Standard", "premium": "Lucy Advanced"}


def _plan_change(job: Job) -> str | None:
    """Said once, on the first turn after the plan changed: which level answers now."""
    import sqlalchemy as sa

    from selecta.ai.schema import ai_runs
    from selecta.lucy.cloud_schema import lucy_cloud_turns

    with transaction(job.engine, job.workspace_id) as conn:
        before = conn.execute(
            sa.select(ai_runs.c.tier)
            .select_from(lucy_cloud_turns.join(ai_runs, ai_runs.c.id == lucy_cloud_turns.c.run_id))
            .where(lucy_cloud_turns.c.workspace_id == job.workspace_id)
            .where(lucy_cloud_turns.c.conversation_id == job.conversation_id)
            .where(lucy_cloud_turns.c.id != job.turn_id)
            .order_by(lucy_cloud_turns.c.seq.desc())
            .limit(1)
        ).scalar()
    now = job.plan.tier.value
    if before is None or before == now:
        return None
    return (f"Your plan changed, so {TIER_WORDS.get(now, 'Lucy')} answers from here on; "
            "the conversation so far is kept.")


def _tell(messages: list[dict], note: str) -> None:
    """Add a note to the last message (the person's, or the tool results), keeping turns
    alternating as the providers need."""
    last = messages[-1]
    if isinstance(last.get("content"), list):
        last["content"] = [*last["content"], {"type": "text", "text": note}]
    else:
        last["content"] = f"{last.get('content') or ''}\n\n{note}"


def _right_now(job: Job) -> str:
    """Fresh state for this message (items 22-25): read now, never remembered."""
    with transaction(job.engine, job.workspace_id) as conn:
        state = cloud_world.snapshot(conn, job.workspace_id, job.user_id, job.device_id)
    return cloud_world.words(state)


def _note(name: str, arguments: Any, text: str) -> str:
    """A short memory of one tool call for later turns: the ids and names it returned."""
    try:
        body = json.loads(text)
    except ValueError:
        return name
    songs = _songs_in(body)
    listed = ", ".join(
        f"{s['id']}={s['title']} - {s['artist']}" + (f" ({s['min']} min)" if s.get("min") else "")
        for s in songs[:12]
    )
    if body.get("proposal"):
        return f"{name}: proposed {body['proposal']['songs']} songs"
    args = json.dumps(arguments, ensure_ascii=False)[:80] if arguments else ""
    return f"{name}({args}): {listed or body.get('error') or 'done'}"


def _count_of(text: str) -> int | None:
    try:
        body = json.loads(text)
    except ValueError:
        return None
    songs = _songs_in(body)
    return len(songs) if songs or "songs" in body or "results" in body else None


def _songs_in(body: dict) -> list[dict]:
    """The songs a tool answer holds: one search, several searches, or the mix."""
    if isinstance(body.get("results"), list):
        return [s for one in body["results"] for s in (one.get("songs") or [])]
    return body.get("songs") or (body.get("mix") or {}).get("order") or []


def _error_of(text: str) -> str:
    try:
        return str(json.loads(text).get("error") or "That didn't work.")[:300]
    except ValueError:
        return "That didn't work."


RUNNER = Runner()

__all__ = ["RUNNER", "Job", "Runner", "admit", "builtin_words", "request_class", "run_turn"]
