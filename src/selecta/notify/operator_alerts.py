"""Operator alerts by email: what the Workers page warns about reaches a person (T-20261125-29a0).

The staging worker gateway was down for three days and nobody heard: every alert was a row only
the admin console showed. The `operator_alerts` maintenance task (every minute) looks at what is
wrong now and mails the operator address:

- `queue_stuck:<pool>`: queued work nobody picks up, a pool's oldest queued job waiting over
  15 minutes (`work.queue_health`, the rule of the `work.queue_stuck` alert);
- `gateway`: the worker gateway's `/api/ready` doesn't answer, isn't ready or runs another
  schema (`admin.hosted_status.check_gateway`, as the Workers page asks it);
- `autoscaler`: its last pass, within 5 minutes, couldn't scale a pool on Modal
  (`health.modal` is 0);
- `spend_ceiling:<pool>`: the autoscaler held a pool at its daily spend ceiling within the last
  5 minutes (`autoscale.spend_ceiling` alerts).

At most one mail per condition per hour while it lasts (`REPEAT_S`), and one "resolved" mail when
it clears. What was mailed is kept in the console's read model (`admin_metrics`, name
`alert_mail.condition`, value 1 while firing and 0 once resolved, as of the last mail), so a
restart or a new leader neither repeats a mail nor forgets to say it cleared.

Settings, on the maintenance service: `SELECTA_ALERT_EMAIL` (one address; the owner sets it) and
the transactional mail settings it already uses (`notify.mail`: `SELECTA_EMAIL_PROVIDER`,
`SELECTA_EMAIL_API_KEY`, `SELECTA_EMAIL_FROM`); `SELECTA_WORKER_GATEWAY_URL` for the gateway
check. With no address nothing is sent, and the task reports `alert_mail.configured` 0, which the
console's setup checklist reads. The `cloud.operator_alerts` flag switches the mail off.

A mail says what is wrong, what it means and what to do, in the Workers page's words, with
counts and times only: no secrets, no addresses or tokens, no customer or music details.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from html import escape
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.notify.mail import EmailError, Message, Sender, valid_address
from selecta.persistence import db_now, transaction

log = logging.getLogger(__name__)

FLAG = "cloud.operator_alerts"
TASK_NAME = "operator_alerts"
ADDRESS_ENV = "SELECTA_ALERT_EMAIL"
GATEWAY_ENV = "SELECTA_WORKER_GATEWAY_URL"
EVERY_S = 60.0
REPEAT_S = 3_600.0
FRESH_S = 300.0
STATE_METRIC = "alert_mail.condition"
SETUP_METRIC = "alert_mail.configured"


@dataclass(frozen=True)
class Condition:
    key: str
    title: str
    means: str
    todo: str
    facts: tuple[str, ...] = field(default_factory=tuple)


def _minutes(seconds: float | None) -> str:
    return f"{round((seconds or 0.0) / 60)} minutes"


def _queue(conn: Connection, now: float) -> list[Condition]:
    from selecta.work import queue_health

    found = []
    for pool in queue_health.snapshot(conn, now)["pools"]:
        if not pool["stuck"]:
            continue
        seen = pool["workers_seen"]
        found.append(Condition(
            f"queue_stuck:{pool['pool']}",
            f"Work is waiting in the {pool['pool']} pool and nothing is taking it",
            "Customers' songs, transitions or exports in this pool are not being processed. "
            "Nothing is lost: the jobs wait and start once a worker takes them.",
            "Open the Workers page. If no worker is reporting, check the worker gateway and "
            "the autoscaler (Modal); if workers report but take nothing, read the gateway's "
            "and the workers' logs.",
            (f"Jobs queued: {pool['queued']}; oldest has waited "
             f"{_minutes(pool['oldest_wait_s'])}.",
             f"Workers reporting: {seen}." if seen else
             "No worker of this pool has checked in within 3 minutes.")))
    return found


GATEWAY_WORDS = {
    "unreachable": (
        "Workers can't register or claim jobs, so every job waits.",
        "Open the worker-gateway service in Render: check it is deployed and running, then "
        "read its logs."),
    "not_ready": (
        "It answers, but its database can't be reached or its migrations are behind.",
        "Check SELECTA_GATEWAY_DATABASE_URL on the gateway and run selecta db upgrade."),
    "schema_mismatch": (
        "The gateway and the API run different deploys, so claims and completions can fail.",
        "Deploy the same commit to the API and the gateway."),
}


def _gateway(url: str, check: Callable[[str, str | None], dict]) -> list[Condition]:
    from selecta.persistence.migrate import head

    result = check(url, head())
    state = str(result.get("state"))
    if state == "ok":
        return []
    means, todo = GATEWAY_WORDS.get(state, GATEWAY_WORDS["unreachable"])
    return [Condition("gateway", "The worker gateway is not answering its readiness check",
                      means, todo, (f"Its answer: {state.replace('_', ' ')}.",))]


def _metric(conn: Connection, name: str) -> tuple[float | None, float | None]:
    from selecta.admin.schema import admin_metrics

    row = conn.execute(sa.select(admin_metrics.c.value, admin_metrics.c.as_of).where(
        admin_metrics.c.name == name, admin_metrics.c.labels == "{}")).first()
    return (row[0], row[1]) if row else (None, None)


def _autoscaler(conn: Connection, now: float) -> list[Condition]:
    value, as_of = _metric(conn, "health.modal")
    if value is None or as_of is None or now - float(as_of) > FRESH_S or value >= 1:
        return []
    return [Condition(
        "autoscaler", "The autoscaler can't scale the worker pools on Modal",
        "Its last pass couldn't start or stop Modal workers, so queued work may wait.",
        "Read the maintenance service's logs for \"Couldn't scale the ... pool\" and check "
        "the Modal app is deployed and its token is valid.")]


def _spend(conn: Connection, now: float) -> list[Condition]:
    from selecta.admin.schema import platform_alerts

    rows = conn.execute(sa.select(platform_alerts.c.metadata).where(
        platform_alerts.c.kind == "autoscale.spend_ceiling",
        platform_alerts.c.created_at >= now - FRESH_S)).scalars().all()
    pools = sorted({str((meta or {}).get("pool")) for meta in rows if meta})
    return [Condition(
        f"spend_ceiling:{pool}", f"The {pool} pool reached its daily spend ceiling",
        "The autoscaler holds this pool at the workers today's ceiling can pay for, so its "
        "work waits longer until the day resets (00:00 UTC).",
        "Nothing, if the spend is expected. Otherwise look at Customers on the Workers page "
        "for an account using an unusual share, or raise daily_spend_ceiling_usd in "
        "infra/workers/pools.json.") for pool in pools]


def conditions(conn: Connection, now: float, *, gateway_url: str = "",
               check: Callable[[str, str | None], dict] | None = None) -> list[Condition]:
    """Everything wrong now (module notes)."""
    found = _queue(conn, now) + _autoscaler(conn, now) + _spend(conn, now)
    if gateway_url:
        if check is None:
            from selecta.admin.hosted_status import check_gateway as check
        found += _gateway(gateway_url, check)
    return found


def _when(epoch_s: float) -> str:
    return datetime.fromtimestamp(epoch_s, UTC).strftime("%d %B %Y %H:%M UTC")


def message(to: str, condition: Condition, *, resolved: bool, now: float) -> Message:
    if resolved:
        subject = f"Resolved: {condition.title}"
        lines = [f"This has cleared as of {_when(now)}: {condition.title.lower()}.",
                 "Nothing to do. You get one email when it starts and at most one an hour "
                 "while it lasts."]
    else:
        subject = f"SelectaDJ operations: {condition.title}"
        lines = [f"What is wrong: {condition.title} (seen {_when(now)}).",
                 f"What this means: {condition.means}", f"What to do: {condition.todo}",
                 *condition.facts,
                 "You get this at most once an hour while it lasts, and once when it clears."]
    footer = "SelectaDJ operator alert, sent to the address in SELECTA_ALERT_EMAIL."
    text = "\n\n".join([*lines, footer])
    html = ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            f"<title>{escape(subject)}</title></head><body>"
            + "".join(f"<p>{escape(line)}</p>" for line in lines)
            + f"<p><small>{escape(footer)}</small></p></body></html>")
    state = "resolved" if resolved else "firing"
    return Message(to=to, subject=subject, text=text, html=html, kind="operator_alert",
                   idempotency_key=f"ops:{condition.key}:{state}:{int(now // REPEAT_S)}")


def _states(conn: Connection) -> dict[str, tuple[float, float]]:
    from selecta.admin.schema import admin_metrics

    rows = conn.execute(sa.select(admin_metrics.c.labels, admin_metrics.c.value,
                                  admin_metrics.c.as_of)
                        .where(admin_metrics.c.name == STATE_METRIC)).all()
    out = {}
    for row in rows:
        key = json.loads(row.labels or "{}").get("condition")
        if key:
            out[key] = (float(row.value or 0.0), float(row.as_of))
    return out


def _enabled() -> bool:
    from selecta import flags

    try:
        return flags.on(FLAG)
    except KeyError:
        return False


def run(engine: Engine, env: Mapping[str, str], sender: Sender | None, *,
        now: float | None = None, check: Callable[[str, str | None], dict] | None = None,
        enabled: Callable[[], bool] = _enabled) -> dict[str, Any]:
    """One pass: mail what started or still lasts (once an hour) and what cleared."""
    from selecta.admin import read_models

    address = env.get(ADDRESS_ENV, "").strip()
    ready = bool(valid_address(address) and sender is not None and enabled())
    with transaction(engine) as conn:
        moment = db_now(conn) if now is None else now
        read_models.report(conn, SETUP_METRIC, 1.0 if ready else 0.0, None, moment)
        active = {c.key: c for c in conditions(
            conn, moment, gateway_url=env.get(GATEWAY_ENV, "").strip(), check=check)}
        states = _states(conn)
    done = {"active": sorted(active), "sent": 0, "resolved": 0, "configured": ready}
    if not ready:
        return done
    due: list[tuple[Condition, bool]] = []
    for key, condition in active.items():
        value, as_of = states.get(key, (0.0, 0.0))
        if value < 1 or moment - as_of >= REPEAT_S:
            due.append((condition, False))
    for key, (value, _as_of) in states.items():
        if value >= 1 and key not in active:
            due.append((Condition(key, _title(key), "", ""), True))
    for condition, resolved in due:
        try:
            # `ready` means there is a sender
            sender.send(message(address, condition, resolved=resolved,  # type: ignore[union-attr]
                                now=moment))
        except EmailError as error:
            log.warning("Operator alert %s not sent: %s", condition.key, error)
            if error.retry:
                continue  # tried again next minute
        with transaction(engine) as conn:
            read_models.report(conn, STATE_METRIC, 0.0 if resolved else 1.0,
                               {"condition": condition.key}, moment)
        done["resolved" if resolved else "sent"] += 1
    return done


def _title(key: str) -> str:
    kind, _, pool = key.partition(":")
    return {"queue_stuck": f"Work is waiting in the {pool} pool and nothing is taking it",
            "gateway": "The worker gateway is not answering its readiness check",
            "autoscaler": "The autoscaler can't scale the worker pools on Modal",
            "spend_ceiling": f"The {pool} pool reached its daily spend ceiling"}.get(kind, key)


def configured(conn: Connection) -> bool | None:
    """Whether the maintenance service last reported alert mail set up (None: never ran)."""
    value, _as_of = _metric(conn, SETUP_METRIC)
    return None if value is None else value >= 1


def task(engine: Engine, env: Mapping[str, str]):
    """The maintenance task. Always registered, so the console learns whether it is set up."""
    from selecta.notify import mail
    from selecta.work.maintenance import Task

    sender = mail.sender_from_environment(env)
    return Task(TASK_NAME, EVERY_S, lambda _fence: run(engine, env, sender))


__all__ = ["ADDRESS_ENV", "FLAG", "Condition", "conditions", "configured", "message", "run",
           "task"]
