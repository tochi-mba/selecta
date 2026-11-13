"""Lucy's guarded writes answer from RETURNING, never from `rowcount` (ADR-0404).

psycopg can report a statement's row count as -1 (`ai.schema.insert_ignore` met it under
SQLAlchemy 2.1). Each guarded UPDATE here says whether it changed a row; with `rowcount` faked to
-1 for every statement, they must still admit, refund, renew and close exactly as before.
"""

from __future__ import annotations

import pytest
from sqlalchemy.engine.cursor import CursorResult

from selecta.ai import allowance, registry, runs
from selecta.ai.registry import DEFAULT_DEPLOYMENTS, RequestClass, Tier
from selecta.ai.runs import Outcome
from selecta.ai.spend import PlatformPolicy, acquire_lease, renew_lease, reserve
from selecta.persistence import transaction

DEFAULTS = {deployment.id: deployment for deployment in DEFAULT_DEPLOYMENTS}
E = RequestClass("everyday")
NOW = 1_800_000_000.0


@pytest.fixture
def unknown_rowcount(monkeypatch):
    monkeypatch.setattr(CursorResult, "rowcount", property(lambda self: -1))


def test_turns_are_admitted_and_refunded_when_rowcount_is_unknown(cloud_engine, unknown_rowcount):
    with transaction(cloud_engine) as conn:
        start = allowance.try_start_turn(conn, "w", Tier.FREE, E, "2026-11")
        assert start.admitted and start.used == 1
        assert allowance.refund_turn(conn, "w", "2026-11", start.bucket) is True
        assert allowance.refund_turn(conn, "w", "2026-11", start.bucket) is False  # never below 0


def test_runs_finish_once_when_rowcount_is_unknown(cloud_engine, unknown_rowcount):
    with transaction(cloud_engine) as conn:
        run_id = runs.start_run(
            conn,
            workspace_id="w",
            deployment=DEFAULTS["haiku-low"],
            routing_version=1,
            prompt_version="p",
            tool_schema_version="t",
            tier=Tier.FREE,
            request_class=E,
            requested_class=E,
            usage_month="2026-11",
        )
        assert runs.finish_run(conn, run_id, outcome=Outcome.COMPLETED) is True
        assert runs.finish_run(conn, run_id, outcome=Outcome.COMPLETED) is False


def test_leases_and_spend_answer_when_rowcount_is_unknown(cloud_engine, unknown_rowcount):
    with transaction(cloud_engine) as conn:
        lease = acquire_lease(conn, "w", "run-1", 1, 120)
        assert lease is not None and renew_lease(conn, lease, 120) is True
        assert renew_lease(conn, "no-such-lease", 120) is False
        policy = PlatformPolicy(daily_cap_usd=1.0, monthly_cap_usd=10.0)
        assert reserve(conn, 0.5, policy, NOW).admitted
        assert not reserve(conn, 0.6, policy, NOW).admitted


def test_deployment_switches_answer_when_rowcount_is_unknown(cloud_engine, unknown_rowcount):
    with transaction(cloud_engine) as conn:
        registry.seed_defaults(conn)
        assert registry.set_status(conn, "haiku-low", "draining") is True
        assert registry.record_eval_pass(conn, "haiku-low", at=NOW) is True
        assert registry.set_status(conn, "no-such-deployment", "draining") is False
