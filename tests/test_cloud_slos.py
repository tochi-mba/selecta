"""SLO dashboards, burn alerts and runbooks as code (SC-0410-02, SC-0410-03, ADR-0410).

Every beta SLO has a dashboard and page and ticket burn alerts; the burn logic fires at the
rates the SRE workbook gives; every alert links a runbook with its sections; no metric uses a
high-cardinality label. Firing an alert in Grafana Cloud is the staging step a person does.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
import yaml

from selecta.observability import slo_rules

ROOT = Path(__file__).resolve().parents[1]
SLOS, ALERTS = slo_rules.load()
RULES = yaml.safe_load((slo_rules.OUT / "prometheus-rules.yaml").read_text("utf-8"))
BETA = {"api_availability": 0.995, "api_routine_latency": 0.95, "seam_start_latency": 0.95,
        "accepted_jobs_kept": 0.99999, "webhook_entitlement_latency": 0.95}


def every_alert() -> list[dict]:
    return [rule for group in RULES["groups"] for rule in group["rules"] if "alert" in rule]


def test_the_generated_rules_and_dashboards_are_up_to_date():
    for path, text in slo_rules.outputs().items():
        assert path.read_text("utf-8") == text, f"run slo_rules --write: {path.name}"
    assert slo_rules.main([]) == 0


def test_the_beta_slos_are_all_defined_with_their_objectives():
    assert {slo["id"]: slo["objective"] for slo in SLOS["slos"]} == BETA


@pytest.mark.parametrize("slo_id", sorted(BETA))
def test_each_slo_has_a_dashboard_and_a_page_and_ticket_burn_alert(slo_id):
    board = json.loads((slo_rules.OUT / "dashboards" / f"{slo_id}.json").read_text("utf-8"))
    assert board["uid"] == f"selecta-slo-{slo_id}"
    assert [panel["title"].split(" (")[0] for panel in board["panels"]][:1] == ["SLI"]
    assert len(board["panels"]) == 3 and all(p["targets"][0]["expr"] for p in board["panels"])
    burns = {rule["labels"]["severity"]: rule for rule in every_alert()
             if rule["labels"].get("slo") == slo_id}
    assert set(burns) == {"page", "ticket"}
    for rule in burns.values():
        assert rule["annotations"]["dashboard"] == board["uid"]
        for window in ("1h", "5m") if rule["labels"]["severity"] == "page" else ("6h", "30m"):
            assert f"selecta:slo_error_ratio:{window}{{slo=\"{slo_id}\"}}" in rule["expr"]


def test_every_recording_rule_the_alerts_read_exists():
    recorded = {(rule["record"], rule["labels"]["slo"]) for group in RULES["groups"]
                for rule in group["rules"] if "record" in rule}
    for rule in every_alert():
        for name, slo in re.findall(r'(selecta:slo_error_ratio:\w+)\{slo="(\w+)"\}', rule["expr"]):
            assert (name, slo) in recorded


@pytest.mark.parametrize(("objective", "ratios", "fires"), [
    (0.995, {"1h": 0.005, "5m": 0.005, "6h": 0.005, "30m": 0.005}, []),          # 1x: on budget
    (0.995, {"1h": 0.08, "5m": 0.08, "6h": 0.08, "30m": 0.08}, ["page", "ticket"]),  # 16x
    (0.995, {"1h": 0.08, "5m": 0.001, "6h": 0.04, "30m": 0.04}, ["ticket"]),    # recovered
    (0.995, {"1h": 0.04, "5m": 0.04, "6h": 0.04, "30m": 0.04}, ["ticket"]),     # 8x
    (0.995, {"1h": 0.0, "5m": 0.5, "6h": 0.0, "30m": 0.0}, []),                 # a blip
    (0.99999, {"1h": 0.0002, "5m": 0.0002, "6h": 0.0, "30m": 0.0}, ["page"]),   # lost jobs
])
def test_burn_alerts_fire_at_the_workbook_rates(objective, ratios, fires):
    assert slo_rules.burning(objective, ratios) == fires


def test_the_generated_thresholds_match_the_python_burn_logic():
    for rule in every_alert():
        if "slo" not in rule["labels"]:
            continue
        objective = BETA[rule["labels"]["slo"]]
        factor = {"page": 14.4, "ticket": 6.0}[rule["labels"]["severity"]]
        thresholds = {float(value) for value in re.findall(r"> ([0-9.e-]+)", rule["expr"])}
        assert thresholds == {round(factor * round(1 - objective, 10), 10)}


def test_every_alert_links_a_runbook_with_its_sections():
    alerts = every_alert()
    assert len(alerts) == 2 * len(BETA) + len(ALERTS["alerts"])
    for rule in alerts:
        url = rule["annotations"]["runbook_url"]
        assert url.startswith(slo_rules.RUNBOOK_BASE + "docs/operations/"), rule["alert"]
        path = ROOT / url.removeprefix(slo_rules.RUNBOOK_BASE)
        assert path.is_file(), f"{rule['alert']}: {path} is missing"
        text = path.read_text("utf-8")
        assert "## First checks" in text, path.name
        assert "## Safe actions" in text or "## Restart" in text, path.name


def test_the_runbook_index_lists_every_runbook_and_every_link_resolves():
    index = (ROOT / "docs" / "operations" / "README.md").read_text("utf-8")
    for rule in every_alert():
        assert Path(rule["annotations"]["runbook_url"]).name in index
    for page in (ROOT / "docs" / "operations").glob("*.md"):
        for target in re.findall(r"\]\(([^)#]+\.md)", page.read_text("utf-8")):
            if not target.startswith("http"):
                assert (page.parent / target).resolve().is_file(), (page.name, target)


def test_no_alert_or_sli_uses_a_high_cardinality_label():
    text = (slo_rules.OUT / "prometheus-rules.yaml").read_text("utf-8")
    for label in ("job_id", "selecta_job_id", "user_id", "workspace_id", "attempt_id"):
        assert label not in text
    # The page alerts each list what they say they measure, against the emitted span names.
    assert "job.wait" in text and "job.enqueue" in text
