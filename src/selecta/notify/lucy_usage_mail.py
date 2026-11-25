"""The email that tells a paid workspace's owner before Lucy's allowance changes (ADR-0487
rule 11, LM-0487-05).

`ai.usage_rollout` sets each granted workspace a switch time at least `NOTICE_DAYS` ahead. This
sends one email per switch to the owner of each workspace on a paid plan: what changes on the
date, that the price does not, and where the meter is. Free workspaces get the note in the
product only (`lucy.cloud_settings` sends `usage_cutover` to Free and paid alike).

Why it has its own record. The other emails remember what they sent as `email.sent` outbox
events, which are kept seven days. A switch can be set up to five weeks ahead, so this notice is
remembered in `lucy_usage_state.notice_sent_at` instead, which lasts. Withdrawing or cancelling
the switch clears it, so a switch that is set again is told again.

Order of work, for each workspace: first, in one transaction, mark it told (one caller wins) and
write the `email.sent` event; only then hand the message to the provider. A crash after the mark
therefore sends nothing more, never a second email: the note in the product still tells the
member. A send the provider cannot take yet (rate limit, outage) takes the mark back so the next
run tries again; one it refuses for good stays marked. A workspace whose owner cannot be mailed
(unverified, deleted, or no usable address) is marked too, so it is not looked at every minute,
and is counted in `unreachable`.

Sending needs the `cloud.email` flag, as every other email does.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy.engine import Engine

from selecta.ai import usage_rollout
from selecta.billing import plans
from selecta.notify import billing_mail, mail, templates
from selecta.notify.mail import SENDER_NAME, EmailError, Message, Sender
from selecta.persistence import db_now, transaction
from selecta.work import outbox

log = logging.getLogger(__name__)

KIND = "lucy_usage_notice"
TOPIC = "email.sent"
METER_PATH = "/account"

# DRAFT WORDING ONLY. The owner must approve these words before any paid workspace is switched
# (LM-0487-05, gate 7 in docs/verification/lm-gate-register.md). A change to them reopens that
# gate. `{day}` is the date of the switch in the reader's own time zone and `{plan}` is the name
# of their plan.
SUBJECT = "Lucy's allowance changes on {day}"
LINES = (
    "On {day}, the way we measure Lucy on your {plan} plan changes.",
    "Until then you have a number of turns each month. From {day} you have a share for each "
    "five-hour session and a share for each week. A session's share comes back when the "
    "session ends, and the week's share comes back each week, so you no longer wait for the "
    "next month.",
    "The price of your plan does not change.",
    f"You can see how much you have left at any time in {SENDER_NAME}, under Account, in "
    "\"Lucy on your plan\".",
)
ACTION = "See Lucy on your plan"


@dataclass
class RunResult:
    sent: int = 0
    refused: int = 0
    deferred: int = 0
    unreachable: int = 0
    """Workspaces marked told with no email, because the owner cannot be mailed."""


def key_for(workspace_id: str, cutover_at: float) -> str:
    return f"{KIND}:{workspace_id}:{int(cutover_at)}"


def notice(*, to: str, key: str, plan: str, cutover_at: float, timezone: str | None,
           site_url: str = "") -> Message:
    """The message itself. `timezone` is the reader's own zone."""
    day = billing_mail.day_in(cutover_at, timezone)
    return templates._message(
        to=to, kind=KIND, key=key,
        subject=SUBJECT.format(day=day, plan=plan),
        lines=[line.format(day=day, plan=plan) for line in LINES],
        action=(ACTION, templates._link(site_url, METER_PATH)),
    )


def _claim(engine: Engine, due: usage_rollout.Notice, now: float, site_url: str, fence,
           result: RunResult) -> Message | None:
    """Mark the workspace told and record the send, in one transaction. Returns the message to
    send, or None when another run has it or the owner cannot be mailed."""
    with transaction(engine) as conn:
        if fence is not None:
            fence.check(conn)
        if not usage_rollout.mark_noticed(conn, due.workspace_id, now):
            return None
        key = key_for(due.workspace_id, due.cutover_at)
        owner = billing_mail._owner(conn, due.workspace_id)
        outcome = "sent" if owner is not None else "unreachable"
        outbox.emit(conn, TOPIC, None, {"key": key, "kind": KIND, "outcome": outcome},
                    db_now(conn))
        if owner is None:
            result.unreachable += 1
            return None
        to, timezone = owner
        return notice(
            to=to, key=key, plan=plans.plan_for(due.plan_id, due.plan_version).label,
            cutover_at=due.cutover_at, timezone=timezone or due.time_zone, site_url=site_url,
        )


def run(engine: Engine, sender: Sender, site_url: str = "", fence=None, *,
        now: float | None = None) -> RunResult:
    """One pass: every paid workspace with a switch ahead that has not been told is told once.
    `now` is the database's clock unless a test passes its own."""
    result = RunResult()
    if not mail.enabled():
        return result
    with transaction(engine) as conn:
        at = db_now(conn) if now is None else now
        due = usage_rollout.due_notices(conn, at)
    for one in due:
        message = _claim(engine, one, at, site_url, fence, result)
        if message is None:
            continue
        try:
            sender.send(message)
            result.sent += 1
        except EmailError as error:
            if not error.retry:
                result.refused += 1
                log.warning("Email %s refused for good: %s", KIND, error)
                continue
            result.deferred += 1
            log.warning("Email %s deferred: %s", KIND, error)
            with transaction(engine) as conn:
                usage_rollout.unmark_noticed(conn, one.workspace_id, at)
    if result.unreachable:
        log.warning("Lucy usage notice: %d workspace(s) have no owner who can be mailed",
                    result.unreachable)
    return result


__all__ = ["ACTION", "KIND", "LINES", "METER_PATH", "SUBJECT", "RunResult", "key_for", "notice",
           "run"]
