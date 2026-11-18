"""Marginal cost per account mode, computed from the real meters (ADR-0464, BF-0464-05).

ADR-0464 asks for unit economics as a dashboard, not a sketch: what one default (local-first)
account costs at the margin compared with one hosted (`cloud.hosted_media`) account, from the
meters the server already writes. This module is that computation. It reads:

- **Stored bytes** from `quota_state.committed_bytes` (the same row quota enforcement locks), at
  the R2 Standard rate, plus the Infrequent Access backup copy rate.
- **Upload writes** from `usage_ledger` `storage_bytes` entries with a positive amount in the
  month: each is one accepted original or kept export, so it is a *lower bound* on R2 Class A
  operations (a multipart upload makes several). Class B reads are **not metered** per account
  today; the report says so instead of inventing a number.
- **Egress**: nominal R2 egress pricing does not establish actual object delivery. Signed URLs
  bypass the API, and Render bandwidth is not metered per account; both stay unknown.
- **Worker compute** from `usage_ledger` `compute_seconds`. No researched per-second rate exists
  yet (Modal pools are priced per GPU/CPU class), so it is reported raw and priced only when the
  caller passes a rate.
- **Lucy dollars** from `ai_usage.cost_usd` for the month: the gateway's own reconciled spend.

The mode of an account is the truthful storage state (`usage.meters.storage_mode`): "hosted" when
the workspace holds the `cloud.hosted_media` grant or has bytes stored, "default" otherwise. Before
the cutover rules exist every account is hosted (the flag is on for everyone), and the report says
exactly that.

Rates are inputs, never facts: `Rates` carries the ADR-0464 figures checked 2026-11-17, and the
dashboard is reconciled against one month of provider invoices before anyone relies on it (the
ADR's required verification, a person task). `summarise` is pure; `cost_report` gathers the rows
through a connection and must run in a system transaction (no workspace scope) so it sees every
workspace.
"""

from __future__ import annotations

import datetime as dt
import statistics
from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

GB = 1_000_000_000
MODES = ("default", "hosted")


@dataclass(frozen=True)
class Rates:
    """Provider rates in US dollars. Defaults are ADR-0464's research (checked 2026-11-17)."""

    r2_standard_usd_per_gb_month: float = 0.015
    r2_backup_usd_per_gb_month: float = 0.01
    r2_class_a_usd_per_million: float = 4.50
    r2_class_b_usd_per_million: float = 0.36
    r2_egress_usd_per_gb: float = 0.0
    compute_usd_per_second: float | None = None
    source: str = "ADR-0464 research, checked 2026-11-17; reconcile against invoices"


DEFAULT_RATES = Rates()


@dataclass(frozen=True)
class AccountUsage:
    """One workspace's metered month."""

    workspace_id: str
    mode: str
    stored_bytes: int = 0
    upload_writes: int = 0
    compute_seconds: float = 0.0
    lucy_usd: float = 0.0
    lucy_turns: int = 0
    object_read_bytes_observed: int = 0
    object_read_ops_observed: int = 0
    object_read_auth_bytes: int = 0
    object_read_auth_ops: int = 0
    object_write_bytes_observed: int = 0
    object_write_ops_observed: int = 0
    object_write_auth_ops: int = 0
    egress_bytes_observed: int = 0
    render_seconds_observed: float = 0.0


@dataclass(frozen=True)
class AccountCost:
    workspace_id: str
    mode: str
    storage_usd: float
    class_a_usd: float
    compute_usd: float | None
    lucy_usd: float

    @property
    def total_usd(self) -> float:
        """Everything that is priced; unpriced compute counts as nothing (and is a named gap)."""
        return self.storage_usd + self.class_a_usd + (self.compute_usd or 0.0) + self.lucy_usd


def price(usage: AccountUsage, rates: Rates) -> AccountCost:
    """One account's month at `rates`."""
    gigabytes = usage.stored_bytes / GB
    storage = gigabytes * (rates.r2_standard_usd_per_gb_month + rates.r2_backup_usd_per_gb_month)
    class_a = usage.upload_writes * rates.r2_class_a_usd_per_million / 1_000_000
    compute = (
        None
        if rates.compute_usd_per_second is None
        else usage.compute_seconds * rates.compute_usd_per_second
    )
    return AccountCost(usage.workspace_id, usage.mode, storage, class_a, compute, usage.lucy_usd)


def _round(value: float) -> float:
    return round(value, 6)


def _mode_summary(costs: list[AccountCost], usages: list[AccountUsage]) -> dict[str, Any]:
    totals = [cost.total_usd for cost in costs]
    count = len(costs)
    return {
        "accounts": count,
        "total_usd": _round(sum(totals)),
        "mean_usd_per_account": _round(sum(totals) / count) if count else None,
        "median_usd_per_account": _round(statistics.median(totals)) if count else None,
        "max_usd_per_account": _round(max(totals)) if count else None,
        "components_usd": {
            "r2_storage": _round(sum(cost.storage_usd for cost in costs)),
            "r2_class_a_lower_bound": _round(sum(cost.class_a_usd for cost in costs)),
            "r2_class_b": None,
            # An unmetered signal is unknown, even when a provider's nominal rate is zero.
            "r2_egress": None,
            "render_bandwidth": None,
            "object_read": None,
            "object_write": None,
            "render_compute": None,
            "compute": (
                None
                if any(cost.compute_usd is None for cost in costs)
                else _round(sum(cost.compute_usd or 0.0 for cost in costs))
            ),
            "lucy": _round(sum(cost.lucy_usd for cost in costs)),
        },
        "meters": {
            "stored_bytes": sum(usage.stored_bytes for usage in usages),
            "upload_writes": sum(usage.upload_writes for usage in usages),
            "compute_seconds": _round(sum(usage.compute_seconds for usage in usages)),
            "lucy_turns": sum(usage.lucy_turns for usage in usages),
            "object_read_bytes_observed": sum(u.object_read_bytes_observed for u in usages),
            "object_read_ops_observed": sum(u.object_read_ops_observed for u in usages),
            "object_read_authorized_bytes": sum(u.object_read_auth_bytes for u in usages),
            "object_read_authorizations": sum(u.object_read_auth_ops for u in usages),
            "object_write_bytes_observed": sum(u.object_write_bytes_observed for u in usages),
            "object_write_ops_observed": sum(u.object_write_ops_observed for u in usages),
            "object_write_authorizations": sum(u.object_write_auth_ops for u in usages),
            "egress_bytes_observed": sum(u.egress_bytes_observed for u in usages),
            "render_seconds_observed": _round(sum(u.render_seconds_observed for u in usages)),
        },
        "signal_status": {
            "object_reads": "partial: server-side reads and signed URL authorizations only;"
            " client fetches are not observable",
            "object_writes": "partial: server-side writes and signed URL authorizations only;"
            " multipart client transfers are not observable",
            "egress": "partial: application-observed bytes exclude direct object-store delivery",
            "render_compute": "partial: only explicitly instrumented worker durations are counted",
            "priced_total": "partial: excludes unknown object operations, egress and render compute",
        },
    }


def gaps(rates: Rates) -> list[str]:
    """What the dashboard cannot measure yet, said plainly so nobody reads a zero as a fact."""
    found = [
        "R2 Class B (read) operations are not metered per account: playback and export reads"
        " are uncounted",
        "R2 Class A operations are a lower bound: one write per accepted upload or kept export;"
        " multipart parts are not counted",
        "Render bandwidth (API and SSE egress) is not metered per account",
        "Object-store direct client transfer bytes and completed operations cannot be confirmed"
        " from signed URLs; authorization counts are not completed transfers",
        "Render/API/SSE egress and render CPU duration are not fully metered per account",
    ]
    if rates.compute_usd_per_second is None:
        found.append(
            "worker compute seconds are reported but not priced: no researched per-second rate"
        )
    return found


def summarise(usages: Iterable[AccountUsage], rates: Rates = DEFAULT_RATES) -> dict[str, Any]:
    """The dashboard body for a set of metered accounts: per mode, totals and per-account cost."""
    usages = list(usages)
    by_mode: dict[str, tuple[list[AccountCost], list[AccountUsage]]] = {
        mode: ([], []) for mode in MODES
    }
    for usage in usages:
        if usage.mode not in by_mode:
            raise ValueError(f"unknown account mode {usage.mode!r}; modes are {MODES}")
        by_mode[usage.mode][0].append(price(usage, rates))
        by_mode[usage.mode][1].append(usage)
    modes = {mode: _mode_summary(costs, rows) for mode, (costs, rows) in by_mode.items()}
    default_mean = modes["default"]["mean_usd_per_account"]
    hosted_mean = modes["hosted"]["mean_usd_per_account"]
    return {
        "rates": asdict(rates),
        "modes": modes,
        "hosted_minus_default_usd_per_account": (
            _round(hosted_mean - default_mean)
            if default_mean is not None and hosted_mean is not None
            else None
        ),
        "gaps": gaps(rates),
        "live": is_live(modes),
    }


def is_live(modes: Mapping[str, Mapping[str, Any]]) -> bool:
    """Whether the dashboard shows real data for both modes: at least one account in each, and
    some metered use somewhere. An empty or one-mode dashboard is not evidence for step 4."""
    if any(modes[mode]["accounts"] == 0 for mode in MODES):
        return False
    metered = [modes[mode]["meters"] for mode in MODES]
    return any(
        meter["stored_bytes"] or meter["upload_writes"] or meter["lucy_turns"]
        or meter["compute_seconds"] or meter["object_read_ops_observed"]
        or meter["object_read_authorizations"] or meter["object_write_ops_observed"]
        or meter["object_write_authorizations"]
        for meter in metered
    )


def month_bounds(month: str) -> tuple[float, float]:
    """UTC epoch bounds of "YYYY-MM" (end excluded)."""
    start = dt.datetime.strptime(month, "%Y-%m").replace(tzinfo=dt.UTC)
    end = (start + dt.timedelta(days=32)).replace(day=1)
    return start.timestamp(), end.timestamp()


@dataclass
class _Row:
    stored_bytes: int = 0
    upload_writes: int = 0
    compute_seconds: float = 0.0
    lucy_usd: float = 0.0
    lucy_turns: int = 0
    object_read_bytes_observed: int = 0
    object_read_ops_observed: int = 0
    object_read_auth_bytes: int = 0
    object_read_auth_ops: int = 0
    object_write_bytes_observed: int = 0
    object_write_ops_observed: int = 0
    object_write_auth_ops: int = 0
    egress_bytes_observed: int = 0
    render_seconds_observed: float = 0.0


def gather(conn: Connection, month: str, *, rules: Any = None) -> list[AccountUsage]:
    """Every live workspace's metered month, with its mode decided by the real grant."""
    from selecta.ai.schema import ai_usage
    from selecta.hosted_coexistence.grant import hosted_media_granted
    from selecta.identity.schema import users, workspaces
    from selecta.usage.meters import storage_mode
    from selecta.usage.schema import quota_state, usage_ledger

    since, until = month_bounds(month)
    live = conn.execute(
        sa.select(workspaces.c.id)
        .select_from(workspaces.join(users, workspaces.c.owner_user_id == users.c.id))
        .where(users.c.deleted_at.is_(None))
        .order_by(workspaces.c.id)
    ).scalars().all()
    rows = {workspace_id: _Row() for workspace_id in live}

    for workspace_id, committed in conn.execute(
        sa.select(quota_state.c.workspace_id, quota_state.c.committed_bytes)
    ):
        if workspace_id in rows:
            rows[workspace_id].stored_bytes = int(committed or 0)

    in_month = sa.and_(usage_ledger.c.occurred_at >= since, usage_ledger.c.occurred_at < until)
    # Keep per-event dimensions explicit. Signed URL issuance is not counted as a completed
    # transfer; detail.source separates those authorizations from server-side object I/O.
    for event in conn.execute(
        sa.select(
            usage_ledger.c.workspace_id, usage_ledger.c.kind,
            usage_ledger.c.amount, usage_ledger.c.detail,
        ).where(in_month)
    ):
        workspace_id, kind, amount, detail = event
        row = rows.get(workspace_id)
        if row is None:
            continue
        amount = int(amount or 0) if float(amount or 0).is_integer() else float(amount or 0)
        if kind == "storage_bytes" and amount > 0:
            row.upload_writes += 1
        elif kind == "compute_seconds":
            row.compute_seconds += float(amount)
        elif kind == "object_read_bytes":
            row.object_read_bytes_observed += int(amount)
        elif kind == "object_read_ops":
            row.object_read_ops_observed += int(amount)
        elif kind == "object_read_auth_bytes":
            row.object_read_auth_bytes += int(amount)
        elif kind == "object_read_auth_ops":
            row.object_read_auth_ops += int(amount)
        elif kind == "object_write_bytes":
            row.object_write_bytes_observed += int(amount)
        elif kind == "object_write_ops":
            row.object_write_ops_observed += int(amount)
        elif kind == "object_write_auth_ops":
            row.object_write_auth_ops += int(amount)
        elif kind == "egress_bytes":
            row.egress_bytes_observed += int(amount)
        elif kind == "render_seconds":
            row.render_seconds_observed += float(amount)
    lucy = conn.execute(
        sa.select(
            ai_usage.c.workspace_id, sa.func.sum(ai_usage.c.cost_usd), sa.func.sum(ai_usage.c.turns)
        )
        .where(ai_usage.c.month == month)
        .group_by(ai_usage.c.workspace_id)
    )
    for workspace_id, dollars, turns in lucy:
        if workspace_id in rows:
            rows[workspace_id].lucy_usd = float(dollars or 0.0)
            rows[workspace_id].lucy_turns = int(turns or 0)

    out = []
    for workspace_id, row in rows.items():
        granted = hosted_media_granted(conn, workspace_id, rules=rules)
        mode = "hosted" if storage_mode(granted, row.stored_bytes) == "hosted" else "default"
        out.append(
            AccountUsage(
                workspace_id,
                mode,
                stored_bytes=row.stored_bytes,
                upload_writes=row.upload_writes,
                compute_seconds=row.compute_seconds,
                lucy_usd=row.lucy_usd,
                lucy_turns=row.lucy_turns,
                object_read_bytes_observed=row.object_read_bytes_observed,
                object_read_ops_observed=row.object_read_ops_observed,
                object_read_auth_bytes=row.object_read_auth_bytes,
                object_read_auth_ops=row.object_read_auth_ops,
                object_write_bytes_observed=row.object_write_bytes_observed,
                object_write_ops_observed=row.object_write_ops_observed,
                object_write_auth_ops=row.object_write_auth_ops,
                egress_bytes_observed=row.egress_bytes_observed,
                render_seconds_observed=row.render_seconds_observed,
            )
        )
    return out


def cost_report(
    conn: Connection, month: str, *, rates: Rates = DEFAULT_RATES, rules: Any = None
) -> dict[str, Any]:
    """The per-mode cost dashboard for one month, from the database the connection reads."""
    return {"month": month, **summarise(gather(conn, month, rules=rules), rates)}


__all__ = [
    "MODES",
    "AccountCost",
    "AccountUsage",
    "Rates",
    "cost_report",
    "gather",
    "gaps",
    "is_live",
    "month_bounds",
    "price",
    "summarise",
]
