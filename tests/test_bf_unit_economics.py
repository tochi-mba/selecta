"""The per-mode cost dashboard (BF-0464-05) and the Lucy ceiling re-measurement (BF-0464-04).

Pure computations on fixtures first (rates, per-mode sums, verdicts under the 40% rule), then the
same reports gathered from a seeded database and served on the admin surface. What these tests
cannot prove: that the rates and the gateway's dollar figures match the provider invoices. That
reconciliation is the ADRs' required verification and needs real invoices (a person task).
"""

from __future__ import annotations

import time

import pytest
from cloud_admin_kit import make_world

from selecta.ai.allowance import ALLOWANCES
from selecta.ai.registry import Tier
from selecta.ai.schema import ai_runs, ai_usage
from selecta.flags import rules as flag_rules
from selecta.hosted_coexistence.grandfather import build_grandfather_rules
from selecta.persistence import new_id, transaction
from selecta.usage import lucy_ceiling, observability, unit_economics
from selecta.usage.lucy_ceiling import TurnSample
from selecta.usage.schema import quota_state, usage_ledger
from selecta.usage.unit_economics import AccountUsage, Rates

GB = unit_economics.GB


def test_one_account_is_priced_from_its_meters():
    cost = unit_economics.price(
        AccountUsage("ws", "hosted", stored_bytes=10 * GB, upload_writes=1_000_000,
                     compute_seconds=50, lucy_usd=0.5),
        Rates(),
    )
    assert cost.storage_usd == pytest.approx(10 * (0.015 + 0.01))
    assert cost.class_a_usd == pytest.approx(4.50)
    assert cost.compute_usd is None
    assert cost.total_usd == pytest.approx(0.25 + 4.50 + 0.5)
    priced = unit_economics.price(AccountUsage("ws", "default", compute_seconds=100),
                                  Rates(compute_usd_per_second=0.001))
    assert priced.compute_usd == pytest.approx(0.1)


def test_the_summary_splits_modes_and_names_its_gaps():
    usages = [
        AccountUsage("a", "default", lucy_usd=0.2, lucy_turns=10),
        AccountUsage("b", "default"),
        AccountUsage("c", "hosted", stored_bytes=50 * GB, upload_writes=100, lucy_usd=1.0,
                     lucy_turns=20),
    ]
    report = unit_economics.summarise(usages)
    default, hosted = report["modes"]["default"], report["modes"]["hosted"]
    assert default["accounts"] == 2 and hosted["accounts"] == 1
    assert default["mean_usd_per_account"] == pytest.approx(0.1)
    assert hosted["components_usd"]["r2_storage"] == pytest.approx(1.25)
    assert hosted["components_usd"]["r2_class_b"] is None
    assert hosted["components_usd"]["compute"] is None
    assert report["hosted_minus_default_usd_per_account"] == pytest.approx(
        hosted["mean_usd_per_account"] - 0.1
    )
    assert report["live"] is True
    assert any("Class B" in gap for gap in report["gaps"])
    assert any("not priced" in gap for gap in report["gaps"])
    assert not any("not priced" in gap for gap in unit_economics.gaps(
        Rates(compute_usd_per_second=0.0001)))


def test_the_cost_summary_keeps_observed_io_separate_from_authorizations():
    report = unit_economics.summarise(
        [
            AccountUsage(
                "hosted-ws",
                "hosted",
                object_read_bytes_observed=128,
                object_read_ops_observed=1,
                object_read_auth_bytes=8192,
                object_read_auth_ops=2,
                object_write_bytes_observed=32,
                object_write_ops_observed=1,
                object_write_auth_ops=1,
                egress_bytes_observed=64,
                render_seconds_observed=2.5,
            ),
            AccountUsage("default-ws", "default", lucy_turns=1),
        ]
    )
    hosted = report["modes"]["hosted"]
    assert hosted["meters"]["object_read_bytes_observed"] == 128
    assert hosted["meters"]["object_read_ops_observed"] == 1
    assert hosted["meters"]["object_read_authorized_bytes"] == 8192
    assert hosted["meters"]["object_read_authorizations"] == 2
    assert hosted["meters"]["object_write_bytes_observed"] == 32
    assert hosted["meters"]["object_write_authorizations"] == 1
    assert hosted["meters"]["egress_bytes_observed"] == 64
    assert hosted["meters"]["render_seconds_observed"] == pytest.approx(2.5)
    assert hosted["components_usd"]["r2_egress"] is None
    assert hosted["components_usd"]["object_read"] is None
    assert hosted["components_usd"]["object_write"] is None
    assert "not observable" in hosted["signal_status"]["object_reads"]
    assert any("not completed transfers" in gap for gap in report["gaps"])


def test_usage_observations_capture_mode_and_provenance(world):
    hosted, default = _seed(world, "2026-11")
    with transaction(world.engine) as conn:
        read_id = observability.observe(
            conn, hosted, "object_read_bytes", 120,
            source="playback.proxy", ref="request-1", detail={"status": 200},
        )
        observability.observe(
            conn, hosted, "object_read_auth_bytes", 2048,
            source="signed-url.issue", ref="asset-1",
        )
        observability.observe(
            conn, default, "render_seconds", 1.5, source="render.worker",
        )
        rows = {row.workspace_id: row for row in unit_economics.gather(conn, "2026-11")}
        read = (
            conn.execute(usage_ledger.select().where(usage_ledger.c.id == read_id))
            .mappings()
            .one()
        )
    assert rows[hosted].mode == "hosted"
    assert rows[hosted].object_read_bytes_observed == 120
    assert rows[hosted].object_read_auth_bytes == 2048
    assert rows[default].mode == "default"
    assert rows[default].render_seconds_observed == pytest.approx(1.5)
    assert read["detail"]["account_mode"] == "hosted"
    assert read["detail"]["source"] == "playback.proxy"
    assert read["detail"]["status"] == 200


def test_a_dashboard_is_live_only_with_both_modes_and_real_use():
    assert unit_economics.summarise([AccountUsage("a", "hosted", stored_bytes=1)])["live"] is False
    assert unit_economics.summarise(
        [AccountUsage("a", "hosted"), AccountUsage("b", "default")]
    )["live"] is False
    with pytest.raises(ValueError):
        unit_economics.summarise([AccountUsage("a", "elsewhere")])


def test_month_bounds_cover_the_whole_month():
    start, end = unit_economics.month_bounds("2026-12")
    assert end - start == 31 * 86_400
    with pytest.raises(ValueError):
        unit_economics.month_bounds("December")


def _samples(tier: str, bucket: str, cost: float, n: int) -> list[TurnSample]:
    return [TurnSample(tier, bucket, cost)] * n


def test_thin_data_gives_no_verdict():
    report = lucy_ceiling.ceiling_report(_samples("standard", "everyday", 0.001, 5))
    assert report["plans"]["standard"]["verdict"] == "insufficient_data"
    assert report["plans"]["standard"]["thin_buckets"] == ["everyday", "planning"]


def test_cheap_turns_confirm_the_allowance_under_the_40_percent_rule():
    found = _samples("standard", "everyday", 0.002, 40) + _samples("standard", "planning", 0.02, 40)
    plan = lucy_ceiling.ceiling_report(found)["plans"]["standard"]
    assert plan["budget_usd"] == pytest.approx(0.4 * 6.99 * 1.27)
    assert plan["expected_max_out_usd"] == pytest.approx(400 * 0.002 + 40 * 0.02)
    assert plan["verdict"] == "confirmed" and plan["suggested_allowances"] is None
    rows = {row["bucket"]: row for row in plan["buckets"]}
    assert rows["everyday"]["model_class"] == "sonnet"
    assert rows["planning"]["model_class"] == "sonnet"
    assert rows["everyday"]["measured"]["n"] == 40


def test_expensive_turns_ask_for_smaller_allowances_and_keep_fair_use():
    found = (
        _samples("premium", "everyday", 0.05, 40)
        + _samples("premium", "deep_plan", 0.5, 40)
        + _samples("premium", "quick", 0.001, 40)
    )
    plan = lucy_ceiling.ceiling_report(found)["plans"]["premium"]
    assert plan["verdict"] == "adjust"
    budget, expected = plan["budget_usd"], plan["expected_max_out_usd"]
    suggested = plan["suggested_allowances"]
    limits = ALLOWANCES[Tier.PREMIUM]
    assert suggested["quick"] == limits[next(k for k in limits if k.value == "quick")]
    assert suggested["everyday"] == int(150 * budget / expected)
    assert suggested["deep_plan"] == int(25 * budget / expected)


def test_free_is_held_to_its_absolute_ceiling_and_the_tail_is_flagged():
    found = _samples("free", "everyday", 0.001, 37) + _samples("free", "everyday", 0.05, 3)
    plan = lucy_ceiling.ceiling_report(found)["plans"]["free"]
    assert plan["budget_rule"] == "absolute free-tier ceiling"
    assert plan["budget_usd"] == pytest.approx(0.25)
    assert plan["verdict"] == "confirmed" and plan["tail_risk"] is True
    with pytest.raises(ValueError):
        lucy_ceiling.ceiling_report([], usd_per_gbp=0)


# --- From the database, through the admin surface ------------------------------------------------


@pytest.fixture
def world(cloud_engine):
    built = make_world(cloud_engine, staff=("owner",))
    yield built
    built.http.__exit__(None, None, None)


def _seed(world, month: str) -> tuple[str, str]:
    hosted, default = world.workspaces["customer"], world.workspaces["customer2"]
    start, _ = unit_economics.month_bounds(month)
    now = time.time()
    with transaction(world.engine) as conn:
        flag_rules.save(conn, "cloud.hosted_media", build_grandfather_rules([hosted]),
                        author="test", reason="grants")
        conn.execute(quota_state.insert().values(
            workspace_id=hosted, plan_id="free", plan_version=1, limit_bytes=10 * GB,
            committed_bytes=4 * GB, reserved_bytes=0, state="ok", updated_at=now))
        for amount in (2 * GB, 2 * GB):
            conn.execute(usage_ledger.insert().values(
                id=new_id(), workspace_id=hosted, kind="storage_bytes", amount=amount,
                occurred_at=start + 10))
        conn.execute(usage_ledger.insert().values(
            id=new_id(), workspace_id=hosted, kind="storage_bytes", amount=GB,
            occurred_at=start - 10))
        for workspace, dollars, turns in ((hosted, 0.3, 12), (default, 0.1, 5)):
            conn.execute(ai_usage.insert().values(
                id=new_id(), workspace_id=workspace, month=month, request_class="everyday",
                turns=turns, tokens_in=1, tokens_out=1, cache_read_tokens=0, cost_usd=dollars,
                updated_at=now))
    return hosted, default


def test_the_cost_report_reads_the_real_meters_and_the_real_grant(world):
    month = "2026-11"
    hosted, default = _seed(world, month)
    with transaction(world.engine) as conn:
        report = unit_economics.cost_report(conn, month)
        rows = {row.workspace_id: row for row in unit_economics.gather(conn, month)}
    assert rows[hosted].mode == "hosted" and rows[default].mode == "default"
    assert rows[hosted].stored_bytes == 4 * GB and rows[hosted].upload_writes == 2
    assert rows[default].lucy_usd == pytest.approx(0.1) and rows[default].lucy_turns == 5
    assert report["modes"]["hosted"]["meters"]["upload_writes"] == 2
    assert report["live"] is True


def test_the_dashboard_is_served_to_staff_only(world):
    _seed(world, "2026-11")
    answer = world.get("/api/admin/economics/cost-per-mode", month="2026-11")
    assert answer.status_code == 200, answer.text
    dashboard = answer.json()["dashboard"]
    assert dashboard["month"] == "2026-11" and dashboard["live"] is True
    assert world.get("/api/admin/economics/cost-per-mode", month="Nov").status_code == 400
    assert world.get("/api/admin/economics/cost-per-mode", who="customer").status_code in (401, 403)


def _run(conn, workspace: str, tier: str, bucket: str, cost: float, outcome: str, at: float):
    conn.execute(ai_runs.insert().values(
        id=new_id(), workspace_id=workspace, tier=tier, request_class=bucket,
        requested_class=bucket, allowance_class=bucket, usage_month="2026-11",
        deployment_id="haiku-low", deployment={}, routing_version=1, prompt_version="p",
        tool_schema_version="t", fallback_used=False, reserved_usd=0.0, started_at=at,
        finished_at=at, outcome=outcome, tokens_in=1, tokens_out=1, cache_read_tokens=0,
        cache_write_tokens=0, cost_usd=cost))


def test_the_ceiling_samples_paid_turns_only_and_is_served_to_staff(world):
    now = time.time()
    workspace = world.workspaces["customer"]
    with transaction(world.engine) as conn:
        _run(conn, workspace, "free", "everyday", 0.002, "completed", now - 100)
        _run(conn, workspace, "free", "everyday", 0.004, "incomplete", now - 100)
        _run(conn, workspace, "free", "everyday", 9.0, "failed", now - 100)
        _run(conn, workspace, "free", "everyday", 9.0, "completed", now - 90 * 86_400)
        found = lucy_ceiling.samples(conn, now - 86_400, now + 1)
    assert sorted(sample.cost_usd for sample in found) == [0.002, 0.004]
    answer = world.get("/api/admin/economics/lucy-ceiling", days=7)
    assert answer.status_code == 200, answer.text
    free = answer.json()["report"]["plans"]["free"]
    assert free["buckets"][0]["measured"]["n"] == 2
    assert free["verdict"] == "insufficient_data"
    assert world.get("/api/admin/economics/lucy-ceiling", days=0).status_code == 400


def _tool():
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "tools" / "bf_unit_economics.py"
    spec = importlib.util.spec_from_file_location("bf_unit_economics", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_owner_cli_rehearses_on_a_fixture(tmp_path):
    import json

    fixture = tmp_path / "samples.json"
    fixture.write_text(json.dumps(
        [{"tier": "standard", "bucket": "everyday", "cost_usd": 0.002}] * 40
        + [{"tier": "standard", "bucket": "planning", "cost_usd": 0.02}] * 40
    ), encoding="utf-8")
    report = _tool().run(["lucy-ceiling", "--fixture", str(fixture)])
    assert report["plans"]["standard"]["verdict"] == "confirmed"


def test_the_owner_cli_reads_a_database(world):
    _seed(world, "2026-11")
    url = world.engine.url
    if world.engine.dialect.name == "postgresql":
        # the run's tables live in its own schema, chosen by connection options, not by the URL
        from cloud_db import connection_options

        with world.engine.connect() as connection:
            schema = connection.exec_driver_sql("SELECT current_schema()").scalar_one()
        url = url.update_query_dict({"options": connection_options(schema)})
    url = url.render_as_string(hide_password=False)
    report = _tool().run(["cost-per-mode", "--db", url, "--month", "2026-11"])
    assert report["modes"]["hosted"]["accounts"] >= 1 and report["live"] is True
