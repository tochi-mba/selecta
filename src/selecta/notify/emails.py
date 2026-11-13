"""The `emails` maintenance task: decide which promised emails are due and send each once.

It needs no table of its own. Each run looks back over a short window and skips anything it
already sent, which it remembers as an `email.sent` outbox event (workspace-less, so no event
stream carries it; the outbox keeps rows seven days, longer than every look-back below):

- **Long job finished**: a top-level job that succeeded within the last `JOB_LOOKBACK_S` and ran
  `LONG_JOB_S` or more from creation, mailed to the person who started it.
- **Over quota**: a workspace that went over its storage limit within the last `QUOTA_LOOKBACK_S`
  (`quota_state.over_since`), mailed to its owner once per time it goes over.

Storage deletion warnings and silent-zone alerts have their words (`templates`) and go through
`send_once`, but nothing schedules them yet: the retention deletion they warn of and the silent
zone detector are not built, and an email must never promise something the code won't do.

Only verified addresses of people who are not deleted get mail. A send the provider refuses for
good (a bad or suppressed address) is remembered as sent, so it is not retried every minute; one
that may pass later (rate limit, outage) is left for the next run. Delivery is at least once: a
crash between the provider's answer and the marker can repeat one email, which Resend's
idempotency key absorbs.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.identity.schema import users, workspaces
from selecta.notify import templates
from selecta.notify.mail import EmailError, Message, Sender, enabled, valid_address
from selecta.persistence import db_now, transaction
from selecta.usage.schema import quota_state
from selecta.work import outbox
from selecta.work.schema import jobs, outbox_events

log = logging.getLogger(__name__)

TOPIC = "email.sent"
EVERY_S = 60.0
LONG_JOB_S = 10 * 60.0
"""A job is "long" when it took ten minutes or more; shorter ones finish while people watch."""
JOB_LOOKBACK_S = 6 * 3600.0
QUOTA_LOOKBACK_S = 6 * 86_400.0
SITE_URL_ENV = "SELECTA_EMAIL_SITE_URL"


@dataclass
class RunResult:
    sent: int = 0
    refused: int = 0
    deferred: int = 0


def sent_keys(conn: Connection, since: float) -> set[str]:
    rows = conn.execute(
        sa.select(outbox_events.c.payload).where(
            outbox_events.c.topic == TOPIC, outbox_events.c.created_at >= since
        )
    )
    return {str((payload or {}).get("key")) for (payload,) in rows}


def _address(conn: Connection, user_id: str | None) -> str | None:
    if not user_id:
        return None
    row = conn.execute(
        sa.select(users.c.email, users.c.email_verified, users.c.deleted_at).where(
            users.c.id == user_id
        )
    ).one_or_none()
    if row is None or row.deleted_at is not None or not row.email_verified:
        return None
    return row.email if valid_address(row.email) else None


def _owner(conn: Connection, workspace_id: str) -> str | None:
    owner = conn.execute(
        sa.select(workspaces.c.owner_user_id).where(workspaces.c.id == workspace_id)
    ).scalar_one_or_none()
    return _address(conn, owner)


def due_job_emails(conn: Connection, now: float, site_url: str) -> list[Message]:
    events = conn.execute(
        sa.select(outbox_events.c.payload).where(
            outbox_events.c.topic == "job.succeeded",
            outbox_events.c.created_at >= now - JOB_LOOKBACK_S,
        )
    )
    job_ids = {str((payload or {}).get("job_id")) for (payload,) in events}
    job_ids.discard("None")
    if not job_ids:
        return []
    rows = conn.execute(
        sa.select(
            jobs.c.id, jobs.c.type, jobs.c.created_by, jobs.c.parent_id,
            jobs.c.created_at, jobs.c.updated_at,
        ).where(jobs.c.id.in_(sorted(job_ids)), jobs.c.state == "succeeded")
    )
    due = []
    for job in rows:
        took = float(job.updated_at) - float(job.created_at)
        if job.parent_id is not None or took < LONG_JOB_S:
            continue
        to = _address(conn, job.created_by)
        if to:
            due.append(templates.long_job_finished(
                to=to, key=f"long_job_finished:{job.id}", job_type=job.type,
                minutes=round(took / 60), site_url=site_url,
            ))
    return due


def due_quota_emails(conn: Connection, now: float, site_url: str) -> list[Message]:
    rows = conn.execute(
        sa.select(quota_state).where(
            quota_state.c.state == "over_quota_read_only",
            quota_state.c.over_since >= now - QUOTA_LOOKBACK_S,
        )
    )
    due = []
    for row in rows:
        to = _owner(conn, row.workspace_id)
        if to:
            due.append(templates.over_quota(
                to=to, key=f"over_quota:{row.workspace_id}:{int(float(row.over_since))}",
                used_bytes=int(row.committed_bytes), limit_bytes=int(row.limit_bytes),
                site_url=site_url,
            ))
    return due


def send_once(
    engine: Engine, sender: Sender, message: Message, already: set[str], result: RunResult,
    fence=None,
) -> None:
    """Send `message` unless its key was sent before, and remember that it was."""
    key = message.idempotency_key
    if key in already:
        return
    outcome = "sent"
    try:
        sender.send(message)
        result.sent += 1
    except EmailError as error:
        if error.retry:
            result.deferred += 1
            log.warning("Email %s deferred: %s", message.kind, error)
            return
        outcome = "refused"
        result.refused += 1
        log.warning("Email %s refused for good: %s", message.kind, error)
    with transaction(engine) as conn:
        if fence is not None:
            fence.check(conn)
        payload = {"key": key, "kind": message.kind, "outcome": outcome}
        outbox.emit(conn, TOPIC, None, payload, db_now(conn))
    already.add(key)


def run(engine: Engine, sender: Sender, site_url: str = "", fence=None) -> RunResult:
    """One pass: every due email, each sent at most once."""
    result = RunResult()
    if not enabled():
        return result
    with transaction(engine) as conn:
        now = db_now(conn)
        already = sent_keys(conn, now - outbox.KEEP_S)
        due = due_job_emails(conn, now, site_url) + due_quota_emails(conn, now, site_url)
    for message in due:
        send_once(engine, sender, message, already, result, fence)
    return result


def task(engine: Engine, env: Mapping[str, str], sender: Sender):
    """The maintenance `Task` body."""
    site_url = env.get(SITE_URL_ENV, "").strip()
    return lambda fence: run(engine, sender, site_url, fence).sent


__all__ = [
    "EVERY_S",
    "LONG_JOB_S",
    "SITE_URL_ENV",
    "TOPIC",
    "RunResult",
    "due_job_emails",
    "due_quota_emails",
    "run",
    "send_once",
    "sent_keys",
    "task",
]
