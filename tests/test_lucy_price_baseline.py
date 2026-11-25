"""LM-0487-09: a Lucy price, cap, routing or allowance change needs a fresh measurement.

`tests/fixtures/lucy_price_baseline.json` records the numbers that decide how far a Lucy
allowance goes, beside the measurement that backs them. The first test here is the CI check of
ADR-0487 rule 10: it fails as soon as the code and the record differ, and stays failing until
the record is rewritten with `--write --measured-on ... --measurement ...`
(docs/operations/lucy-price-change.md).
"""

from __future__ import annotations

import copy
import json
from dataclasses import replace
from datetime import date
from pathlib import Path
from types import MappingProxyType

import pytest

from selecta.ai import registry
from selecta.audit import lucy_price_baseline as baseline
from selecta.billing import plans

EXPECTED_KEYS = {*baseline.PRICE_KEYS, *baseline.RECORD_KEYS}


def test_the_committed_baseline_matches_the_code():
    differences = baseline.diff(baseline.load(), baseline.current())
    assert differences == [], (
        "Lucy's prices, routing or allowance table changed. Re-run the measurement and rewrite"
        " the baseline (docs/operations/lucy-price-change.md): " + "; ".join(differences)
    )


def test_the_fixture_is_valid_json_with_the_expected_keys():
    recorded = json.loads(baseline.FIXTURE.read_text(encoding="utf-8"))
    assert set(recorded) == EXPECTED_KEYS
    assert date.fromisoformat(recorded["recorded_on"])
    # Both or neither: a measurement date without its report (or the reverse) is not a record.
    assert (recorded["measured_on"] is None) == (recorded["measurement"] is None)
    if recorded["measurement"] is None:
        assert recorded["note"], "say why there is no measurement"
    else:
        assert date.fromisoformat(recorded["measured_on"])
        assert recorded["measurement"].startswith(baseline.REPORTS + "/")
        assert (baseline.ROOT / recorded["measurement"]).is_file()
    assert set(recorded["routing"]) == {"free", "standard", "premium"}
    assert set(recorded["lucy_usage"]) == {str(usage.version) for usage in plans.LUCY_USAGE}
    assert set(recorded["deployments"]) == {d.id for d in registry.DEFAULT_DEPLOYMENTS}


def test_the_snapshot_is_plain_json_and_does_not_share_the_codes_lists():
    now = baseline.current()
    assert json.loads(json.dumps(now)) == now
    now["routing"]["premium"]["planning"].append("x")
    assert registry.DEFAULT_ROUTING["premium"]["planning"] == ["opus-high"]


def test_a_model_price_change_is_named(monkeypatch):
    before = baseline.current()
    monkeypatch.setattr(
        registry, "MODEL_PRICES", {**registry.MODEL_PRICES, "claude-opus-5-5": (4.0, 25.0)}
    )
    assert baseline.diff(before, baseline.current()) == [
        "claude-opus-5-5 output price changed from 20.0 to 25.0"
    ]


def test_a_cache_multiplier_change_is_named(monkeypatch):
    before = baseline.current()
    monkeypatch.setattr(registry, "CACHE_READ_MULTIPLIER", 0.2)
    monkeypatch.setattr(registry, "CACHE_WRITE_MULTIPLIER", 2.0)
    assert baseline.diff(before, baseline.current()) == [
        "cache read multiplier changed from 0.1 to 0.2",
        "cache write multiplier changed from 1.25 to 2.0",
    ]


def test_a_deployment_price_cap_model_or_fallback_change_is_named(monkeypatch):
    before = baseline.current()
    changed = tuple(
        replace(
            d,
            model_id="claude-sonnet-5-5",
            prices=registry.Prices(2.0, 10.0),
            per_turn_cost_cap_usd=0.9,
            fallback_id="haiku-medium",
        )
        if d.id == "opus-high"
        else d
        for d in registry.DEFAULT_DEPLOYMENTS
    )
    monkeypatch.setattr(registry, "DEFAULT_DEPLOYMENTS", changed)
    assert baseline.diff(before, baseline.current()) == [
        "deployment opus-high fallback changed from sonnet-medium to haiku-medium",
        "deployment opus-high input price changed from 4.0 to 2.0",
        "deployment opus-high model changed from claude-opus-5-5 to claude-sonnet-5-5",
        "deployment opus-high output price changed from 20.0 to 10.0",
        "deployment opus-high per-turn cost cap changed from 0.6 to 0.9",
    ]


def test_a_deployment_added_or_removed_is_named(monkeypatch):
    before = baseline.current()
    kept = tuple(d for d in registry.DEFAULT_DEPLOYMENTS if d.id != "haiku-medium")
    extra = replace(registry.DEFAULT_DEPLOYMENTS[-1], id="opus-next")
    monkeypatch.setattr(registry, "DEFAULT_DEPLOYMENTS", (*kept, extra))
    assert baseline.diff(before, baseline.current()) == [
        "deployment haiku-medium was removed",
        "deployment opus-next was added",
    ]


def test_a_routing_change_is_named(monkeypatch):
    before = baseline.current()
    routing = copy.deepcopy(registry.DEFAULT_ROUTING)
    routing["premium"]["planning"] = ["sonnet-medium"]
    routing["standard"]["quick"] = ["haiku-medium", "sonnet-medium"]
    monkeypatch.setattr(registry, "DEFAULT_ROUTING", routing)
    assert baseline.diff(before, baseline.current()) == [
        "premium now routes planning to sonnet-medium (was opus-high)",
        "standard now routes quick to haiku-medium, then sonnet-medium (was sonnet-medium)",
    ]


def test_an_allowance_change_and_a_new_version_are_named(monkeypatch):
    before = baseline.current()
    first = plans.LUCY_USAGE[0]
    standard = replace(first.plans["standard"], multiplier_milli=15_000, max_turn_units=1)
    changed = replace(
        first,
        base_weekly_units=60_000,
        plans=MappingProxyType({**first.plans, "standard": standard}),
    )
    monkeypatch.setattr(plans, "LUCY_USAGE", (changed, replace(first, version=2)))
    assert baseline.diff(before, baseline.current()) == [
        "Lucy usage v1 base weekly units changed from 57692 to 60000",
        "Lucy usage v1 standard max_turn_units changed from 150000 to 1",
        "Lucy usage v1 standard multiplier_milli changed from 14000 to 15000",
        "Lucy usage v2 was added",
    ]


def test_a_baseline_missing_a_field_says_so():
    now = baseline.current()
    short = {key: value for key, value in now.items() if key != "routing"}
    assert baseline.diff(short, now) == ["the baseline has no routing"]


@pytest.fixture
def repo(tmp_path: Path) -> tuple[Path, Path]:
    """A made-up repository root with a stale baseline and one measurement report."""
    reports = tmp_path / "docs" / "verification"
    reports.mkdir(parents=True)
    (reports / "lm-measurement-2027-01-15.md").write_text("# A report\n", encoding="utf-8")
    (tmp_path / "notes.md").write_text("# Not a report\n", encoding="utf-8")
    fixture = tmp_path / "lucy_price_baseline.json"
    stale = copy.deepcopy(baseline.load())
    stale["model_prices"]["claude-opus-5-5"]["output_usd_per_mtok"] = 1.0
    fixture.write_text(json.dumps(stale), encoding="utf-8")
    return tmp_path, fixture


def test_the_check_exits_1_and_names_the_difference(repo, capsys):
    root, fixture = repo
    assert baseline.main([], fixture=fixture, root=root) == 1
    out = capsys.readouterr().out
    assert "CHANGED: claude-opus-5-5 output price changed from 1.0 to 20.0" in out
    assert "docs/operations/lucy-price-change.md" in out


@pytest.mark.parametrize(
    "extra",
    [
        [],
        ["--measured-on", "2027-01-15"],
        ["--measurement", "docs/verification/lm-measurement-2027-01-15.md"],
        ["--measured-on", "2027-01-15", "--measurement", "docs/verification/missing.md"],
        ["--measured-on", "2027-01-15", "--measurement", "notes.md"],
        ["--measured-on", "2027-01-15", "--measurement", "docs/verification"],
        [
            "--measured-on",
            "15 January",
            "--measurement",
            "docs/verification/lm-measurement-2027-01-15.md",
        ],
    ],
)
def test_a_rewrite_without_a_real_measurement_is_refused(repo, capsys, extra):
    root, fixture = repo
    before = fixture.read_text(encoding="utf-8")
    assert baseline.main(["--write", *extra], fixture=fixture, root=root) == 2
    assert "REFUSED:" in capsys.readouterr().out
    assert fixture.read_text(encoding="utf-8") == before


def test_a_rewrite_with_a_measurement_records_it_and_then_matches(repo, capsys):
    root, fixture = repo
    report = "docs/verification/lm-measurement-2027-01-15.md"
    args = ["--write", "--measured-on", "2027-01-15", "--measurement", report]
    assert baseline.main(args, fixture=fixture, root=root) == 0
    written = json.loads(fixture.read_text(encoding="utf-8"))
    assert set(written) == EXPECTED_KEYS
    assert written["measured_on"] == "2027-01-15"
    assert written["measurement"] == report
    assert written["recorded_on"] == date.today().isoformat()
    assert baseline.diff(written, baseline.current()) == []
    assert baseline.main([], fixture=fixture, root=root) == 0
    assert "match the recorded baseline" in capsys.readouterr().out


def test_the_committed_baseline_is_never_touched_by_a_refused_rewrite(capsys):
    before = baseline.FIXTURE.read_text(encoding="utf-8")
    assert baseline.main(["--write"]) == 2
    assert baseline.FIXTURE.read_text(encoding="utf-8") == before
