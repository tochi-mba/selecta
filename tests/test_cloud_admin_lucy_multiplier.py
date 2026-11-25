"""A staff member sets one account's Lucy allowance factor, or switches Lucy off (ADR-0485
rule 7, LM-0485-04): with a reason, an audit record, and a way back."""

from __future__ import annotations

import json

import pytest
import sqlalchemy as sa
from test_cloud_admin_routes import admin_world  # noqa: F401

from selecta.ai import usage_units
from selecta.ai.usage_schema import lucy_usage_state
from selecta.authz.schema import audit_events
from selecta.persistence import transaction

FREE_WEEK = usage_units.targets("free").week_limit


def put(world, multiplier, reason="a customer asked for more", headers=None, workspace=None):
    body = {"multiplier_milli": multiplier}
    if reason is not None:
        body["reason"] = reason
    return world.http.put(
        f"/api/admin/ai/workspaces/{workspace or world.customer_workspace_id}/multiplier",
        headers=headers or world.headers, json=body,
    )


def state(world) -> dict:
    with transaction(world.engine) as conn:
        row = conn.execute(sa.select(lucy_usage_state).where(
            lucy_usage_state.c.workspace_id == world.customer_workspace_id)).mappings().one()
    return dict(row)


def audits(world) -> list[dict]:
    with transaction(world.engine) as conn:
        rows = conn.execute(sa.select(audit_events).where(
            audit_events.c.action == "admin.lucy.multiplier").order_by(audit_events.c.id)
        ).mappings().all()
    return [dict(row) for row in rows]


def test_a_higher_factor_raises_the_weeks_limit_at_once_and_is_audited(admin_world):  # noqa: F811
    answer = put(admin_world, 3_000)

    assert answer.status_code < 300, answer.text
    assert answer.json()["multiplier_milli"] == 3_000
    row = state(admin_world)
    assert (row["override_multiplier_milli"], row["week_limit"]) == (3_000, FREE_WEEK * 3)
    (event,) = audits(admin_world)
    assert event["result"] == "success"
    recorded = json.dumps({k: str(v) for k, v in event.items()})
    assert "a customer asked for more" in recorded and "3000" in recorded


def test_zero_switches_lucy_off_for_the_account(admin_world):  # noqa: F811
    assert put(admin_world, 0, "abuse report").status_code < 300
    row = state(admin_world)
    assert (row["override_multiplier_milli"], row["week_limit"]) == (0, 0)


def test_clearing_the_factor_puts_the_plans_own_limit_back(admin_world):  # noqa: F811
    put(admin_world, 5_000)
    undone = put(admin_world, None, "back to the plan")

    assert undone.status_code < 300, undone.text
    row = state(admin_world)
    assert row["override_multiplier_milli"] is None and row["week_limit"] == FREE_WEEK
    before = [json.dumps({k: str(v) for k, v in event.items()}) for event in audits(admin_world)]
    assert len(before) == 2 and "5000" in before[1]  # the undo records what it replaced


def test_what_was_used_is_kept_when_the_factor_changes(admin_world):  # noqa: F811
    put(admin_world, 2_000)
    with transaction(admin_world.engine) as conn:
        conn.execute(sa.update(lucy_usage_state).where(
            lucy_usage_state.c.workspace_id == admin_world.customer_workspace_id
        ).values(week_used=1_234))
    put(admin_world, 4_000)
    assert state(admin_world)["week_used"] == 1_234


def test_a_reason_is_required(admin_world):  # noqa: F811
    assert put(admin_world, 2_000, reason=None).status_code == 422
    assert put(admin_world, 2_000, reason="   ").status_code >= 400
    assert audits(admin_world) == [] or all(e["result"] != "success" for e in audits(admin_world))


@pytest.mark.parametrize("bad", [-1, 100_001, 1.5, "2000", True])
def test_a_factor_outside_the_range_or_not_a_whole_number_is_refused(admin_world, bad):  # noqa: F811
    assert put(admin_world, bad).status_code == 422


def test_staff_without_the_permission_are_refused_and_nothing_changes(admin_world):  # noqa: F811
    refused = put(admin_world, 9_000, headers=admin_world.denied_headers)

    assert refused.status_code == 403
    with transaction(admin_world.engine) as conn:
        rows = conn.execute(sa.select(lucy_usage_state.c.override_multiplier_milli).where(
            lucy_usage_state.c.workspace_id == admin_world.customer_workspace_id)).all()
    assert all(row[0] is None for row in rows)


def test_staff_cannot_change_their_own_workspace(admin_world):  # noqa: F811
    assert put(admin_world, 9_000, workspace=admin_world.workspace_id).status_code >= 400


def test_an_unknown_workspace_is_not_created(admin_world):  # noqa: F811
    assert put(admin_world, 2_000, workspace="no-such-workspace").status_code >= 400
