"""Check the usage ledger against its rollups and the storage inventory (ADR-0402, SC-0402-02).

The ledger is the record every meter and bill comes from, so the numbers derived from it must
agree with it, and with what is actually stored:

- **Rollups.** Each `usage_daily` row must equal the ledger summed for that workspace, UTC day
  and kind (total and number of entries), and every day of ledger entries must have its rows.
- **Storage.** For each workspace, the ledger's `storage_bytes` entries add up to the bytes it
  has committed (`quota_state.committed_bytes`), and those equal the sizes of the originals it
  still keeps (`assets` not deleted). Bytes are given back the moment a deletion is recorded, so a
  deleted asset counts for nothing here even during its recovery window.

`reconcile` only reads. It returns every difference as a `Drift`, so the nightly job can alert
and a person can decide what's wrong: a missing rollup is cheap to rebuild with
`ledger.rollup_day`, but a ledger that disagrees with the inventory means something was charged
or released wrongly, and silently overwriting either side would hide that.
"""

from __future__ import annotations

import datetime as dt
import math
from collections import defaultdict
from dataclasses import dataclass, field

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.storage.schema import assets
from selecta.usage.ledger import Kind, day_bounds
from selecta.usage.schema import quota_state, usage_daily, usage_ledger
from selecta.work.schema import artifacts

TOLERANCE = 1e-6


@dataclass(frozen=True)
class Drift:
    """One difference. `expected` is what the ledger (or inventory) says; `found` the other."""

    check: str
    workspace_id: str
    detail: str
    expected: float
    found: float
    day: dt.date | None = None
    kind: str | None = None

    def __str__(self) -> str:
        where = f" on {self.day.isoformat()}" if self.day else ""
        return f"{self.check}: {self.workspace_id}{where}: {self.detail}"


@dataclass(frozen=True)
class Report:
    first: dt.date | None
    last: dt.date | None
    drifts: tuple[Drift, ...] = field(default_factory=tuple)

    @property
    def ok(self) -> bool:
        return not self.drifts

    def lines(self) -> list[str]:
        return [str(drift) for drift in self.drifts]


def _differs(a: float, b: float) -> bool:
    return not math.isclose(a, b, rel_tol=0.0, abs_tol=TOLERANCE)


def _day(epoch: float) -> dt.date:
    return dt.datetime.fromtimestamp(epoch, dt.UTC).date()


def _ledger_span(
    connection: Connection, workspace_id: str | None
) -> tuple[dt.date, dt.date] | None:
    when = usage_ledger.c.occurred_at
    query = sa.select(sa.func.min(when), sa.func.max(when))
    daily = sa.select(sa.func.min(usage_daily.c.day), sa.func.max(usage_daily.c.day))
    if workspace_id is not None:
        query = query.where(usage_ledger.c.workspace_id == workspace_id)
        daily = daily.where(usage_daily.c.workspace_id == workspace_id)
    low, high = connection.execute(query).one()
    days = [_day(low), _day(high)] if low is not None else []
    first, last = connection.execute(daily).one()
    days += [day for day in (first, last) if day is not None]
    return (min(days), max(days)) if days else None


def rollup_drift(
    connection: Connection, first: dt.date, last: dt.date, workspace_id: str | None = None
) -> list[Drift]:
    """Rollups that disagree with the ledger, for each UTC day from `first` to `last`."""
    found: list[Drift] = []
    day = first
    while day <= last:
        start, end = day_bounds(day)
        query = (
            sa.select(
                usage_ledger.c.workspace_id,
                usage_ledger.c.kind,
                sa.func.sum(usage_ledger.c.amount),
                sa.func.count(),
            )
            .where(usage_ledger.c.occurred_at >= start, usage_ledger.c.occurred_at < end)
            .group_by(usage_ledger.c.workspace_id, usage_ledger.c.kind)
        )
        rolled = sa.select(usage_daily).where(usage_daily.c.day == day)
        if workspace_id is not None:
            query = query.where(usage_ledger.c.workspace_id == workspace_id)
            rolled = rolled.where(usage_daily.c.workspace_id == workspace_id)
        truth = {
            (workspace, kind): (float(total or 0), int(entries))
            for workspace, kind, total, entries in connection.execute(query)
        }
        stored = {
            (row.workspace_id, row.kind): (float(row.total), int(row.entries))
            for row in connection.execute(rolled)
        }
        for key in sorted(set(truth) | set(stored)):
            workspace, kind = key
            want, have = truth.get(key), stored.get(key)
            if have is None:
                found.append(
                    Drift(
                        "rollup",
                        workspace,
                        f"no {kind} rollup for ledger entries",
                        want[0],
                        0.0,
                        day,
                        kind,
                    )
                )
            elif want is None:
                found.append(
                    Drift(
                        "rollup",
                        workspace,
                        f"{kind} rollup has no ledger entries",
                        0.0,
                        have[0],
                        day,
                        kind,
                    )
                )
            elif _differs(want[0], have[0]) or want[1] != have[1]:
                found.append(
                    Drift(
                        "rollup",
                        workspace,
                        f"{kind} rollup is {have[0]:g} from {have[1]} entries; the ledger says "
                        f"{want[0]:g} from {want[1]}",
                        want[0],
                        have[0],
                        day,
                        kind,
                    )
                )
        day += dt.timedelta(days=1)
    return found


def storage_drift(connection: Connection, workspace_id: str | None = None) -> list[Drift]:
    """Workspaces whose storage ledger, committed bytes and kept originals disagree."""
    ledger_q = (
        sa.select(usage_ledger.c.workspace_id, sa.func.sum(usage_ledger.c.amount))
        .where(usage_ledger.c.kind == Kind.STORAGE_BYTES.value)
        .group_by(usage_ledger.c.workspace_id)
    )
    kept_q = (
        sa.select(assets.c.workspace_id, sa.func.sum(assets.c.size))
        .where(assets.c.deleted_at.is_(None))
        .group_by(assets.c.workspace_id)
    )
    # Kept exports count against storage too (ADR-0402), charged when they're written.
    exports_q = (
        sa.select(artifacts.c.workspace_id, sa.func.sum(artifacts.c.size_bytes))
        .where(artifacts.c.kind == "export")
        .group_by(artifacts.c.workspace_id)
    )
    quota_q = sa.select(quota_state.c.workspace_id, quota_state.c.committed_bytes)
    if workspace_id is not None:
        ledger_q = ledger_q.where(usage_ledger.c.workspace_id == workspace_id)
        kept_q = kept_q.where(assets.c.workspace_id == workspace_id)
        exports_q = exports_q.where(artifacts.c.workspace_id == workspace_id)
        quota_q = quota_q.where(quota_state.c.workspace_id == workspace_id)
    numbers: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for workspace, total in connection.execute(ledger_q):
        numbers[workspace]["ledger"] = float(total or 0)
    for workspace, total in connection.execute(kept_q):
        numbers[workspace]["kept"] = float(total or 0)
    for workspace, total in connection.execute(exports_q):
        numbers[workspace]["kept"] += float(total or 0)
    for workspace, committed in connection.execute(quota_q):
        numbers[workspace]["committed"] = float(committed)
    found: list[Drift] = []
    for workspace in sorted(numbers):
        ledger_bytes = numbers[workspace]["ledger"]
        committed = numbers[workspace]["committed"]
        kept = numbers[workspace]["kept"]
        if _differs(ledger_bytes, committed):
            found.append(
                Drift(
                    "storage",
                    workspace,
                    f"the ledger records {ledger_bytes:.0f} bytes but "
                    f"{committed:.0f} are committed",
                    ledger_bytes,
                    committed,
                )
            )
        if _differs(committed, kept):
            found.append(
                Drift(
                    "inventory",
                    workspace,
                    f"{committed:.0f} bytes are committed but the kept originals are {kept:.0f}",
                    kept,
                    committed,
                )
            )
    return found


def reconcile(
    connection: Connection,
    *,
    first: dt.date | None = None,
    last: dt.date | None = None,
    workspace_id: str | None = None,
) -> Report:
    """Every drift between the ledger, its rollups and the storage inventory. Reads only.

    `first` and `last` bound the rollup days checked (both included); by default every day the
    ledger or the rollups cover. Run it on a system connection to see every workspace."""
    span = _ledger_span(connection, workspace_id)
    if span is not None:
        first = first or span[0]
        last = last or span[1]
    drifts: list[Drift] = []
    if first is not None and last is not None:
        drifts += rollup_drift(connection, first, last, workspace_id)
    drifts += storage_drift(connection, workspace_id)
    return Report(first, last, tuple(drifts))


__all__ = ["Drift", "Report", "reconcile", "rollup_drift", "storage_drift"]
