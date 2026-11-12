"""The DMCA designated agent's renewal reminder (ADR-0413, SC-0413-04).

A designation with the US Copyright Office lapses three years after it was made or last renewed,
and a lapsed designation loses the safe harbour. Registering the agent is the owner's job; this
module only makes sure the renewal can't be forgotten: the maintenance leader checks the date
once a day and raises one owner alert a week from 90 days before the designation lapses, and
every day once it has lapsed.

The date comes from `SELECTA_DMCA_AGENT_REGISTERED_ON` (ISO `YYYY-MM-DD`, the date of the last
registration or renewal). Without it the task is left out and the start-up log says so.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Mapping
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.admin.alerts import raise_alert
from selecta.admin.schema import platform_alerts
from selecta.persistence import db_now

FLAG = "cloud.dmca_renewal_reminder"
ENV = "SELECTA_DMCA_AGENT_REGISTERED_ON"
KIND = "legal.dmca_agent_renewal"
TERM_YEARS = 3
WARN_DAYS = 90
REPEAT_DUE_S = 7 * 86_400.0
REPEAT_LAPSED_S = 86_400.0


@dataclass(frozen=True)
class Renewal:
    registered_on: dt.date
    lapses_on: dt.date
    days_left: int

    @property
    def state(self) -> str:
        if self.days_left < 0:
            return "lapsed"
        return "due" if self.days_left <= WARN_DAYS else "ok"

    def summary(self) -> str:
        if self.state == "lapsed":
            return (
                f"The DMCA designated agent lapsed on {self.lapses_on.isoformat()}. Renew it with "
                "the US Copyright Office now, then update " + ENV + "."
            )
        return (
            f"The DMCA designated agent lapses on {self.lapses_on.isoformat()} "
            f"({self.days_left} days). Renew it with the US Copyright Office, then update {ENV}."
        )


def _add_years(day: dt.date, years: int) -> dt.date:
    try:
        return day.replace(year=day.year + years)
    except ValueError:  # 29 February in a year without one
        return day.replace(year=day.year + years, day=28)


def parse(value: str | None) -> dt.date | None:
    """The registration date, or None when it isn't set or isn't a real date."""
    try:
        return dt.date.fromisoformat((value or "").strip())
    except ValueError:
        return None


def renewal(registered_on: dt.date, today: dt.date) -> Renewal:
    lapses = _add_years(registered_on, TERM_YEARS)
    return Renewal(registered_on, lapses, (lapses - today).days)


def remind(conn: Connection, registered_on: dt.date, today: dt.date | None = None) -> str | None:
    """Raise the renewal alert when it's due and not raised recently. Returns its id, or None."""
    now = db_now(conn)
    today = today or dt.datetime.fromtimestamp(now, dt.UTC).date()
    status = renewal(registered_on, today)
    if status.state == "ok":
        return None
    gap = REPEAT_LAPSED_S if status.state == "lapsed" else REPEAT_DUE_S
    last = conn.execute(
        sa.select(sa.func.max(platform_alerts.c.created_at)).where(platform_alerts.c.kind == KIND)
    ).scalar()
    if last is not None and now - float(last) < gap:
        return None
    return raise_alert(
        conn,
        KIND,
        status.summary(),
        metadata={
            "registered_on": status.registered_on.isoformat(),
            "lapses_on": status.lapses_on.isoformat(),
            "days_left": status.days_left,
            "state": status.state,
        },
    )


def configured(env: Mapping[str, str]) -> dt.date | str:
    """The registration date, or the reason the reminder can't run."""
    value = env.get(ENV, "")
    if not value.strip():
        return f"set {ENV}"
    day = parse(value)
    return day if day is not None else f"{ENV} must be a date like 2026-11-12"
