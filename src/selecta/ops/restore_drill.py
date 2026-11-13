"""The restore drill: everything after a database restore, timed, before reopening (SC-0409-04).

`docs/saas/13-hosting-and-cost.md` §13.5 orders the steps after any restore: replay the
deletions ledger, run storage reconciliation, re-run Stripe reconciliation, expire leases, then
reopen. Before reopening, the drill also checks that every song in the deletions ledger is still
hidden (SC-0412-03: data deleted since the backup stays gone). `after_restore` runs them in
that order against the restored database, stops at the
first failure (customer traffic stays closed), and returns a report with each step's time. The
monthly drill (`infra/backup/restore_drill.sh`) restores last night's dump into a scratch
database first and passes the time the restore began, so the report's total is the whole
recovery time, judged against the 60-minute target.

Run as `python -m selecta.ops.restore_drill --restore-started <epoch> --report <file.md>` with
the same environment as `selecta replay-deletions-after-restore`, plus the Stripe settings when
billing reconciliation should run. It belongs to the `cloud.operations` flag.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy.engine import Engine

from selecta import flags
from selecta.persistence import transaction

TARGET_S = 60 * 60.0
FLAG = "cloud.operations"


@dataclass(frozen=True)
class Step:
    name: str
    ok: bool
    seconds: float
    detail: str = ""


@dataclass
class DrillReport:
    restore_started: float
    finished: float = 0.0
    steps: list[Step] = field(default_factory=list)
    target_s: float = TARGET_S

    @property
    def total_s(self) -> float:
        return max(self.finished - self.restore_started, 0.0)

    @property
    def completed(self) -> bool:
        return bool(self.steps) and all(step.ok for step in self.steps)

    @property
    def passed(self) -> bool:
        """Every step succeeded and the whole recovery fit inside the target."""
        return self.completed and self.total_s < self.target_s

    def as_dict(self) -> dict[str, Any]:
        return {**asdict(self), "total_s": self.total_s, "passed": self.passed}

    def markdown(self) -> str:
        verdict = "PASSED" if self.passed else "FAILED"
        lines = [
            f"# Restore drill: {verdict}",
            "",
            f"- Restore started: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(self.restore_started))}",  # noqa: E501
            f"- Total recovery time: {self.total_s / 60:.1f} min (target under "
            f"{self.target_s / 60:.0f} min)",
            "",
            "| Step | Result | Seconds | Detail |",
            "|---|---|---|---|",
        ]
        lines += [
            f"| {s.name} | {'ok' if s.ok else 'FAILED'} | {s.seconds:.1f} | {s.detail} |"
            for s in self.steps
        ]
        if not self.completed:
            lines += ["", "Keep customer traffic closed: a step failed."]
        return "\n".join(lines) + "\n"


StepFn = Callable[[], str]


def after_restore(
    engine: Engine,
    objects: Any,
    ledger_bucket: str,
    *,
    restore_started: float,
    store: Any = None,
    stripe: Any = None,
    price_map: Any = None,
    clock: Callable[[], float] = time.time,
) -> DrillReport:
    """Run every post-restore step in order, stopping at the first failure."""
    from selecta.identity.deletion_ledger import replay_account_deletions_after_restore
    from selecta.storage.offsite_ledger import replay_storage_tombstones_after_restore
    from selecta.usage.reconcile import storage_drift
    from selecta.work.store import JobStore

    def storage_tombstones() -> str:
        replay = replay_storage_tombstones_after_restore(engine, objects, ledger_bucket)
        return (
            f"{replay.tombstones_replayed} tombstones, {replay.storage.assets_hidden} assets hidden"
        )

    def account_deletions() -> str:
        replay = replay_account_deletions_after_restore(engine, objects, ledger_bucket)
        return f"{replay.accounts_requeued} account workflows requeued"

    def storage_reconciliation() -> str:
        with transaction(engine) as connection:
            drifts = storage_drift(connection)
        if drifts:
            raise RuntimeError(f"{len(drifts)} storage drifts; a person must decide")
        return "ledger, quota and inventory agree"

    def stripe_reconciliation() -> str:
        if stripe is None:
            return "skipped: no Stripe client given"
        from selecta.billing.maintenance import reconcile_stripe_billing

        result = reconcile_stripe_billing(engine, stripe, price_map)
        return f"{result.checked} subscriptions checked, {result.changed} corrected"

    def expire_leases() -> str:
        jobs = store or JobStore(engine)
        return f"{len(jobs.reap_expired())} expired leases reclaimed"

    def deleted_stays_gone() -> str:
        import sqlalchemy as sa

        from selecta.storage.schema import assets, deletions

        songs = deletions.c.kind == "song"
        with transaction(engine) as connection:
            back = (
                connection.execute(
                    sa.select(deletions.c.ref)
                    .select_from(deletions.join(assets, assets.c.id == deletions.c.ref))
                    .where(songs, assets.c.deleted_at.is_(None))
                )
                .scalars()
                .all()
            )
            count = connection.execute(
                sa.select(sa.func.count()).select_from(deletions).where(songs)
            ).scalar_one()
        if back:
            raise RuntimeError(f"{len(back)} deleted songs are visible again: {sorted(back)[:5]}")
        return f"all {count} deleted songs stay hidden"

    plan: list[tuple[str, StepFn]] = [
        ("Replay storage tombstones", storage_tombstones),
        ("Replay account deletions", account_deletions),
        ("Storage reconciliation", storage_reconciliation),
        ("Stripe reconciliation", stripe_reconciliation),
        ("Expire leases", expire_leases),
        ("Deleted data stays gone", deleted_stays_gone),
    ]
    report = DrillReport(restore_started=restore_started)
    for name, run in plan:
        began = clock()
        try:
            detail, ok = run(), True
        except Exception as problem:  # the drill reports every failure instead of raising
            detail, ok = f"{type(problem).__name__}: {problem}"[:200], False
        report.steps.append(Step(name, ok, max(clock() - began, 0.0), detail))
        if not ok:
            break
    report.finished = clock()
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the post-restore steps and time them.")
    parser.add_argument(
        "--restore-started",
        type=float,
        required=True,
        help="Epoch seconds when the database restore began.",
    )
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args(argv)
    flags.require(FLAG)

    from selecta.persistence import make_engine
    from selecta.storage import api as storage_api

    bucket = os.environ.get("SELECTA_R2_BUCKET_DELETION_LEDGER", "").strip()
    if not bucket:
        raise SystemExit("Set SELECTA_R2_BUCKET_DELETION_LEDGER.")
    # Stripe reconciliation runs whenever the Stripe settings are present; without them the
    # step reports itself skipped.
    from selecta.billing.stripe_sync import load_price_map
    from selecta.billing.webhooks import HttpStripeClient

    stripe_key = os.environ.get("SELECTA_STRIPE_SECRET_KEY", "").strip()
    prices = load_price_map()
    stripe = (
        HttpStripeClient(stripe_key, api_version=os.environ.get("SELECTA_STRIPE_API_VERSION"))
        if stripe_key and prices
        else None
    )
    engine = make_engine(os.environ["SELECTA_DATABASE_URL"])
    client = storage_api.r2_client()
    try:
        report = after_restore(
            engine,
            client,
            bucket,
            restore_started=args.restore_started,
            stripe=stripe,
            price_map=prices if stripe is not None else None,
        )
    finally:
        client.close()
        engine.dispose()
    args.report.write_text(report.markdown(), "utf-8")
    args.report.with_suffix(".json").write_text(json.dumps(report.as_dict(), indent=2), "utf-8")
    print(report.markdown())
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
