"""Business phases, release gates, the selling switch, the plan entry, pricing and pilot measures
(ADR-0441 BZ-0441-02/03/05/06/09, ADR-0454 BZ-0454-13/14, ADR-0440 records).

Every gate starts NOT RECORDED in docs/verification/bz-gate-register.md, so the real answer is
NO-GO; the eligible paths are proved on made-up registers only. Nothing here passes a gate.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa

from selecta import flags
from selecta.billing import plans
from selecta.business import billing_catalogue as cat
from selecta.business import pilot_measures, plan_catalogue, rollout
from selecta.flags.matching import Rule, RuleKind
from selecta.persistence import transaction

ALL_PASS = "\n".join(f"| {g.id} | {g.title} | PASS | run 42 | Tochi Mba | 2026-11-19 |"
                     for g in rollout.GATES)
SIGNED = """## Decision

- Decision: GO
- Phase: B2
- Release SHA: 3fa2b81a
- Signed by: Tochi Mba
- Date: 2026-12-01
"""
DONE = {task: "Implemented" for task in rollout.SELLING_PREREQUISITES}


def pilot_grant() -> Rule:
    return Rule(RuleKind.WORKSPACES, {"ids": ["org-pilot"], "on": True})


def catch_all_off() -> Rule:
    return Rule(RuleKind.PERCENTAGE, {"percent": 0, "salt": "closed"})


# --- the records ----------------------------------------------------------------------------


def test_the_real_register_and_go_record_answer_no_go_and_phase_b0():
    register = rollout.read_register()
    assert set(register) == set(rollout.GATE_IDS)
    assert all(record.status == rollout.NOT_RECORDED for record in register.values())
    gate_s = rollout.gate_s_now()
    assert gate_s.no_go and len(gate_s.reasons) >= len(rollout.GATES)
    assert not rollout.read_go_record().signed_go
    assert rollout.current_phase(register, rollout.prerequisites(),
                                 rollout.read_go_record()).id == "B0"


def test_the_selling_prerequisites_are_read_from_their_adrs():
    statuses = rollout.prerequisites()
    assert set(statuses) == {"BZ-0449-11", "BZ-0447-15"}
    assert all(status not in ("Not found", "Unknown") for status in statuses.values())


@pytest.mark.parametrize("who", ["Claude", "Codex agent", "-", "", "claude-opus"])
def test_an_agent_can_never_pass_a_gate(who):
    record = rollout.parse_register(f"| P1 | x | PASS | run 1 | {who} | 2026-11-19 |")["P1"]
    assert not record.passed and record.problems


def test_a_pass_needs_evidence_and_a_date():
    record = rollout.parse_register("| P2 | x | PASS | - | Tochi Mba | - |")["P2"]
    assert {"PASS without evidence", "PASS without a date"} <= set(record.problems)


def test_eligible_is_the_best_answer_and_never_go():
    register = rollout.parse_register(ALL_PASS)
    gate_p = rollout.decide("P", register)
    gate_s = rollout.decide("S", register, task_statuses=DONE,
                            go=rollout.parse_go_record(SIGNED))
    assert gate_p.verdict == gate_s.verdict == "ELIGIBLE FOR SIGNED GO"
    assert "GO" != gate_s.verdict


def test_gate_s_needs_the_legal_and_stripe_tasks_and_a_signed_record():
    register = rollout.parse_register(ALL_PASS)
    unsigned = rollout.decide("S", register, task_statuses={"BZ-0449-11": "Not started",
                                                            "BZ-0447-15": "Implemented"},
                              go=rollout.parse_go_record(SIGNED.replace("Tochi Mba", "Claude")))
    assert unsigned.no_go
    assert any("BZ-0449-11" in reason for reason in unsigned.reasons)
    assert any("GO record is not signed" in reason for reason in unsigned.reasons)


def test_phases_follow_the_records():
    passed = rollout.parse_register(ALL_PASS)
    pilots_only = rollout.parse_register(
        "\n".join(line for line in ALL_PASS.splitlines() if line.startswith("| P")))
    go = rollout.parse_go_record(SIGNED)
    assert rollout.current_phase({}, DONE, go).id == "B0"
    assert rollout.current_phase(pilots_only, DONE, go).id == "B1"
    assert rollout.current_phase(passed, DONE, go).id == "B2"
    assert rollout.current_phase(passed, DONE,
                                 rollout.parse_go_record(SIGNED.replace("B2", "B3"))).id == "B3"


# --- the selling switch (BZ-0441-09) -----------------------------------------------------------


def test_a_grant_to_one_pilot_organisation_is_never_refused():
    no_go = rollout.decide("S", {})
    assert rollout.check_signups_rules([pilot_grant(), catch_all_off()], build_on=True,
                                       gate_s=no_go) == []
    assert rollout.check_signups_rules([pilot_grant()], build_on=False, gate_s=no_go) == []
    kill = Rule(RuleKind.KILL_SWITCH, {})
    assert rollout.check_signups_rules([kill], build_on=True, gate_s=no_go) == []


@pytest.mark.parametrize("rules", [
    [Rule(RuleKind.PERCENTAGE, {"percent": 5, "salt": "s"})],
    [Rule(RuleKind.SEGMENT, {"countries": ["GB"], "on": True})],
    [Rule(RuleKind.SCHEDULE, {"from": 1, "on": True})],
    [pilot_grant()],  # on in the build with no catch-all: everyone else is on too
])
def test_opening_selling_beyond_pilots_is_refused_until_gate_s(rules):
    refused = rollout.check_signups_rules(rules, build_on=True, gate_s=rollout.decide("S", {}))
    assert refused and "named pilot" in refused[0]
    eligible = rollout.decide("S", rollout.parse_register(ALL_PASS), task_statuses=DONE,
                              go=rollout.parse_go_record(SIGNED))
    assert rollout.check_signups_rules(rules, build_on=True, gate_s=eligible) == []


def test_the_flags_page_refuses_a_broad_signups_rule_before_anything_is_saved(sqlite_engine):
    from selecta.admin import flags_admin
    from selecta.flags import rules as flag_rules

    broad = {"rules": [{"kind": "percentage", "params": {"percent": 10, "salt": "x"},
                        "enabled": True}]}
    with transaction(sqlite_engine) as conn, pytest.raises(flag_rules.RuleError) as refused:
        flags_admin.change(conn, None, "business.signups", "set_rules", broad,
                           reason="open selling")
    assert "named pilot" in str(refused.value.args)


def test_the_build_layer_check_names_selling_on_without_a_catch_all():
    states = {rollout.SIGNUPS: flags.State(True, "SELECTA_FLAGS")}
    assert rollout.build_problems([], states, rollout.decide("S", {}))
    assert rollout.build_problems([pilot_grant(), catch_all_off()], states,
                                  rollout.decide("S", {})) == []


def test_the_cli_reports_no_go(capsys):
    assert rollout.main([]) == 0  # selling is off in this build, so nothing broad to refuse
    out = capsys.readouterr().out
    assert "Phase B0" in out and "Gate S: NO-GO" in out


# --- the plan entry and pricing (BZ-0441-03, -05) ---------------------------------------------


def test_the_business_plan_entry_matches_billing_and_entitlements():
    plan = plan_catalogue.current()
    assert plan.key == "business_venue_v1"
    assert plan.venue_price["GBP"] == {"month": 7900, "year": 79000}
    assert plan.extra_zone_price["EUR"]["month"] == 2500
    assert plan.included_zones_per_venue == 1 and plan.included_seats_per_venue == 3
    assert plan.open_weight == 8.0 and plan.closed_weight == 6.0
    assert "business.signups" in plan.flags
    assert plan_catalogue.problems() == [] and plans.problems() == []


def test_free_standard_and_premium_are_unchanged_by_the_business_plan():
    snapshot = {p.id: (p.version, p.storage_bytes, p.scheduling_weight, p.rank, p.flags)
                for p in plans.current_plans()}
    assert set(snapshot) == {"free", "standard", "premium"}
    assert snapshot["free"][:4] == (2, 10 * plans.GB, 1, 0)
    assert snapshot["standard"][:4] == (2, 50 * plans.GB, 3, 1)
    assert snapshot["premium"][:4] == (2, 100 * plans.GB, 6, 2)
    assert not any(flag.startswith("business.") for _v, _s, _w, _r, f in snapshot.values()
                   for flag in f)


def test_a_drifted_plan_entry_is_caught(monkeypatch):
    drifted = plan_catalogue.current()
    from dataclasses import replace

    monkeypatch.setattr(plan_catalogue, "versions",
                        lambda: (replace(drifted, included_seats_per_venue=5,
                                         flags=drifted.flags - {"business.signups"}),))
    found = plan_catalogue.problems()
    assert any("included seats" in item for item in found)
    assert any("business.signups" in item for item in found)
    with pytest.raises(ValueError):
        plans.validate_catalogue()


@pytest.mark.parametrize(("venues", "zones", "seats", "interval"), [
    (1, 1, 3, "month"), (3, 5, 12, "month"), (10, 10, 30, "month"), (12, 20, 40, "year"),
])
def test_the_pricing_view_and_the_catalogue_estimate_agree(venues, zones, seats, interval):
    view = plan_catalogue.pricing_view("GBP")
    extra_zones = max(0, zones - venues * view["included_zones"])
    extra_seats = max(0, seats - venues * view["included_seats"])
    expected = cat.estimate({cat.ITEM_VENUE: venues, cat.ITEM_ZONE: extra_zones,
                             cat.ITEM_SEAT: extra_seats}, "GBP", interval)
    # The same sum web/src/business/pricing/pricingTotal.ts does.
    subtotal = (venues * view["venue"][interval] + extra_zones * view["extra_zone"][interval]
                + extra_seats * view["extra_seat"][interval])
    off = view["volume"]["percent_off"] if venues >= view["volume"]["min_venues"] else 0
    assert subtotal - subtotal * off // 100 == expected.total_minor


def test_25_venues_is_enterprise_never_a_self_serve_price():
    assert plan_catalogue.pricing_view()["enterprise_min_venues"] == 25
    with pytest.raises(cat.EnterpriseRequired):
        cat.estimate({cat.ITEM_VENUE: 25}, "GBP", "month")
    with pytest.raises(ValueError):
        plan_catalogue.pricing_view("JPY")


# --- pilot measures (BZ-0441-06) --------------------------------------------------------------


def test_pilot_measures_come_from_real_play_and_heartbeat_rows(sqlite_engine):
    from selecta.business.commercial_schema import biz_play_log
    from selecta.business.hours_schema import zone_commands
    from selecta.playback.zone_schema import device_health_history, zone_alerts

    ws, day = "ws-pilot", 86_400
    start = 1_800_000_000.0
    with transaction(sqlite_engine) as conn:
        conn.execute(sa.insert(biz_play_log), [{
            "id": f"p{n}", "workspace_id": ws, "organisation_id": ws, "venue_id": "v1",
            "zone_id": "z1", "idempotency_key": f"k{n}", "title": "Song", "artist": "A",
            "started_at": start + (n // 2) * day + n * 60,
            "started_local": f"2027-01-{15 + n // 2:02d}T18:00", "venue_tz": "Europe/London",
            "seconds_played": 180.0, "source": "schedule", "in_transition": False,
            "recorded_at": start, "synced_at": start} for n in range(4)])
        conn.execute(sa.insert(zone_alerts).values(
            id="a1", workspace_id=ws, zone_id="z1", kind="silent", status="closed",
            reason="digital_silence", started_at=start + 100, closed_at=start + 220,
            silent_seconds=120))
        conn.execute(sa.insert(zone_commands), [{
            "id": f"c{n}", "workspace_id": ws, "zone_id": "z1", "device_id": "tab",
            "device_seq": n, "kind": "skip", "issued_at": start + n, "received_at": start + n,
            "outcome": "applied" if n < 3 else "dropped"} for n in range(4)])
        conn.execute(sa.insert(device_health_history), [{
            "device_id": "k1", "bucket_at": start + b * 300, "workspace_id": ws,
            "zone_id": "z1", "reports": 0 if b == 2 else 5} for b in range(5)])
        found = pilot_measures.measure(conn, ws, start, start + 7 * day)
    assert found.opening_days == 2
    assert found.silent_minutes == 2.0
    assert found.staff_interventions == 3 and found.staff_interventions_per_day == 1.5
    assert found.requests == 0 and found.requests_per_day == 0.0
    assert found.kiosk_uptime == 0.8
    assert found.staff_satisfaction is None  # the feedback card, by hand


def test_the_pricing_route_answers_only_where_selling_reaches(sqlite_engine):
    from dataclasses import dataclass, field

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from selecta.business import rollout_routes
    from selecta.flags.rules import RulesCache
    from selecta.identity.tokens import Claims

    @dataclass
    class Workspace:
        id: str = "ws-visitor"
        kind: str = "personal"

    @dataclass
    class User:
        id: str = "visitor"
        created_at: float = 0.0

    @dataclass
    class Principal:
        workspace: Workspace = field(default_factory=Workspace)
        user: User = field(default_factory=User)
        staff_roles: frozenset = frozenset()

    app = FastAPI()
    rollout_routes.install_routes(
        app, engine=sqlite_engine,
        current_claims=lambda: Claims(subject="visitor", issued_at=0.0, expires_at=9e12),
        principal_for=lambda _e, _c, _h: Principal(), rules=RulesCache(sqlite_engine))
    http = TestClient(app)
    try:
        flags.use("-business.signups")
        assert http.get("/api/business/pricing").status_code == 403
        flags.use("+business.signups")
        body = http.get("/api/business/pricing?currency=EUR").json()["pricing"]
        assert body["currency"] == "EUR" and body["venue"]["month"] == 7900
        assert body["vat"] == "excluded"
        assert http.get("/api/business/pricing?currency=JPY").status_code == 400
    finally:
        flags.use(None)
