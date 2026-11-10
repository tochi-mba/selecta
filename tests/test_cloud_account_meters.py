"""The meters `/api/account` gives the Plan & billing page (SC-0402-04), the consent version the
checkout form sends (SC-0403-04), and the event a new entitlement snapshot sends to open pages."""

from __future__ import annotations

import pytest
from cloud_world import HEADERS, add_asset, signed_up

from selecta.billing import stripe_sync
from selecta.billing.plans import plan_for
from selecta.persistence import db_now, transaction
from selecta.usage import allowances, quota
from selecta.work.schema import outbox_events


def _consume(engine, workspace_id: str, kind: str, amount: int, timezone: str = "UTC") -> None:
    plan = plan_for("free")
    with transaction(engine, workspace_id) as conn:
        taken = allowances.try_consume(
            conn, workspace_id, kind, amount, allowances.limit_for(plan, kind), timezone=timezone
        )
        assert taken.ok


def _premium(engine, workspace_id: str, valid_until: float = 4_000_000_000) -> None:
    with transaction(engine, workspace_id) as conn:
        decision = stripe_sync.SnapshotDecision(
            plan_id="premium",
            plan_version=1,
            source=stripe_sync.SnapshotSource.STRIPE,
            reason="active",
            subscription_id="sub_test",
            valid_until=valid_until,
        )
        stripe_sync.write_snapshot(conn, workspace_id, decision, db_now(conn))
        quota.set_limit(conn, workspace_id, plan_for("premium"))


def test_account_reports_every_meter_with_its_reset(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_CHECKOUT_CONSENT_VERSION", "terms-2026-11")
    with signed_up(tmp_path, monkeypatch) as world:
        add_asset(world.engine, world.objects, world.workspace_id, b"x" * 2_000)
        _consume(world.engine, world.workspace_id, "analysis_song", 3)
        _consume(world.engine, world.workspace_id, "lucy_turn.haiku", 5)
        _consume(world.engine, world.workspace_id, "export", 1)
        with world.engine.connect() as conn:
            now = db_now(conn)

        account = world.client.get("/api/account", headers=HEADERS)
        assert account.status_code == 200, account.text
        body = account.json()
        usage = body["usage"]

        assert usage["storage"] == {
            "used_bytes": 2_000,
            "committed_bytes": 2_000,
            "reserved_bytes": 0,
            "limit_bytes": 10_000_000_000,
            "over_by_bytes": 0,
            "state": "ok",
            "over_since": None,
        }
        _day, _start, tomorrow = allowances.period_window(allowances.Period.DAY, "UTC", now)
        _month, _start, next_month = allowances.period_window(allowances.Period.MONTH, "UTC", now)
        assert usage["analysis_today"] == {
            "used": 3, "limit": 150, "resets_at": tomorrow, "period": "day"
        }
        assert usage["exports_month"] == {
            "used": 1,
            "limit": 3,
            "resets_at": next_month,
            "period": "month",
            "retention_days": 7,
            "blocked": False,
        }
        lucy = usage["lucy_turns_month"]
        assert (lucy["used"], lucy["limit"], lucy["fair_use"], lucy["resets_at"]) == (
            5, 40, False, next_month,
        )
        assert lucy["classes"] == [
            {
                "model_class": "haiku",
                "purpose": "everyday",
                "used": 5,
                "limit": 40,
                "resets_at": next_month,
                "period": "month",
            }
        ]
        assert body["billing"] == {"consent_version": "terms-2026-11"}
        assert body["lucy"] == {"tier": "Lucy Basic"}
        assert body["entitlement"]["plan_label"] == "Free"


def test_allowances_reset_at_the_listeners_own_midnight(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch, timezone="Pacific/Auckland") as world:
        with world.engine.connect() as conn:
            now = db_now(conn)
        usage = world.client.get("/api/account", headers=HEADERS).json()["usage"]
        _key, _start, local_midnight = allowances.period_window(
            allowances.Period.DAY, "Pacific/Auckland", now
        )
        assert usage["analysis_today"]["resets_at"] == local_midnight


def test_premium_meters_show_its_limits_and_fair_use(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        _premium(world.engine, world.workspace_id)
        body = world.client.get("/api/account", headers=HEADERS).json()
        usage = body["usage"]
        assert body["entitlement"]["plan"] == "premium"
        assert body["lucy"] == {"tier": "Lucy Advanced"}
        assert usage["storage"]["limit_bytes"] == 100_000_000_000
        assert usage["analysis_today"]["limit"] == 5_000
        assert usage["exports_month"]["limit"] is None  # unlimited exports on Premium
        assert usage["exports_month"]["retention_days"] == 90
        lucy = usage["lucy_turns_month"]
        # Sonnet and Opus are limited; Haiku quick turns are fair use, counted but never refused.
        assert (lucy["limit"], lucy["fair_use"]) == (175, True)
        assert [entry["limit"] for entry in lucy["classes"]] == [150, 25, None]


def test_a_new_entitlement_snapshot_tells_the_workspaces_open_pages(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        _premium(world.engine, world.workspace_id)
        with world.engine.connect() as conn:
            rows = conn.execute(
                outbox_events.select().where(outbox_events.c.workspace_id == world.workspace_id)
            ).mappings().all()
        changed = [row for row in rows if row["topic"] == "entitlement.changed"]
        assert [row["payload"]["plan"] for row in changed] == ["premium"]
        account = world.client.get("/api/account", headers=HEADERS).json()
        assert account["entitlement"]["snapshot_version"] == changed[0]["payload"]["version"]


def test_confirming_the_same_snapshot_again_sends_no_second_event(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        _premium(world.engine, world.workspace_id)
        _premium(world.engine, world.workspace_id)  # Stripe re-confirms; nothing changed
        with world.engine.connect() as conn:
            topics = [
                row.topic
                for row in conn.execute(
                    outbox_events.select().where(
                        outbox_events.c.workspace_id == world.workspace_id
                    )
                )
            ]
        assert topics.count("entitlement.changed") == 1


@pytest.mark.parametrize("header", ["Idempotency-Key", "Last-Event-ID"])
def test_a_cross_origin_app_may_send_the_headers_checkout_and_events_need(
    tmp_path, monkeypatch, header
):
    with signed_up(tmp_path, monkeypatch) as world:
        answer = world.client.options(
            "/api/account",
            headers={
                "Origin": "https://app.test",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": header,
            },
        )
        assert answer.status_code == 200, answer.text
        assert header.lower() in answer.headers["access-control-allow-headers"].lower()
