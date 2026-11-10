"""SLO burn-rate alerts and dashboards, generated from `infra/observability/slos.yaml` (ADR-0410).

Each SLO gets the multiwindow, multi-burn-rate alerts from the Google SRE workbook: a page when
the error budget burns 14.4 times too fast over both an hour and five minutes (2% of a 28-day
budget in an hour), and a ticket at 6 times over six hours and 30 minutes. `burning` evaluates
the same rule in Python, so the alert logic is tested without a Prometheus server. The phone
alerts in `alerts.yaml` are copied through with their runbook links. Output:

- `infra/observability/generated/prometheus-rules.yaml` (Grafana Cloud / Mimir ruler format)
- `infra/observability/generated/dashboards/<slo id>.json` (one Grafana dashboard per SLO)

`python -m selecta.observability.slo_rules --write` regenerates them; without `--write` it exits
1 when they are out of date. `tests/test_cloud_slos.py` checks both and the runbooks.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[3]
HERE = ROOT / "infra" / "observability"
OUT = HERE / "generated"
RUNBOOK_BASE = "https://github.com/tochi-mba/selecta/blob/main/"


@dataclass(frozen=True)
class BurnRule:
    severity: str
    factor: float
    long: str
    short: str
    long_s: int
    short_s: int


RULES = (
    BurnRule("page", 14.4, "1h", "5m", 3600, 300),
    BurnRule("ticket", 6.0, "6h", "30m", 21600, 1800),
)


def burning(objective: float, error_ratio: Mapping[str, float]) -> list[str]:
    """Which severities fire, given the measured error ratio over each window ("1h", "5m"...).
    Both windows of a rule must exceed factor x the error budget."""
    budget = 1.0 - objective
    return [
        rule.severity
        for rule in RULES
        if error_ratio.get(rule.long, 0.0) > rule.factor * budget
        and error_ratio.get(rule.short, 0.0) > rule.factor * budget
    ]


def load() -> tuple[dict[str, Any], dict[str, Any]]:
    slos = yaml.safe_load((HERE / "slos.yaml").read_text("utf-8"))
    alerts = yaml.safe_load((HERE / "alerts.yaml").read_text("utf-8"))
    return slos, alerts


def _ratio(slo: Mapping[str, Any], window: str) -> str:
    good = slo["good"].replace("{{window}}", window)
    total = slo["total"].replace("{{window}}", window)
    return f"1 - (({good}) / ({total}))"


def rules(slos: Mapping[str, Any], alerts: Mapping[str, Any]) -> dict[str, Any]:
    recording, burn = [], []
    windows = sorted({w for rule in RULES for w in (rule.long, rule.short)},
                     key=lambda w: (w[-1], int(w[:-1])))
    for slo in slos["slos"]:
        for window in windows:
            recording.append({
                "record": f"selecta:slo_error_ratio:{window}",
                "expr": _ratio(slo, window),
                "labels": {"slo": slo["id"]},
            })
        budget = round(1.0 - slo["objective"], 10)
        for rule in RULES:
            threshold = round(rule.factor * budget, 10)
            burn.append({
                "alert": f"SelectaSloBurn_{slo['id']}_{rule.severity}",
                "expr": (f'selecta:slo_error_ratio:{rule.long}{{slo="{slo["id"]}"}} > {threshold}'
                         f' and selecta:slo_error_ratio:{rule.short}{{slo="{slo["id"]}"}}'
                         f" > {threshold}"),
                "for": "2m" if rule.severity == "page" else "15m",
                "labels": {"severity": rule.severity, "slo": slo["id"]},
                "annotations": {
                    "summary": f"{slo['name']}: error budget burning {rule.factor}x too fast",
                    "runbook_url": RUNBOOK_BASE + slo["runbook"],
                    "dashboard": f"selecta-slo-{slo['id']}",
                },
            })
    phone = [
        {
            "alert": item["name"],
            "expr": item["expr"],
            "for": item["for"],
            "labels": {"severity": item["severity"]},
            "annotations": {"summary": item["summary"],
                            "runbook_url": RUNBOOK_BASE + item["runbook"]},
        }
        for item in alerts["alerts"]
    ]
    return {"groups": [
        {"name": "selecta-slo-recording", "interval": "1m", "rules": recording},
        {"name": "selecta-slo-burn", "rules": burn},
        {"name": "selecta-phone", "rules": phone},
    ]}


def dashboard(slo: Mapping[str, Any], window_days: int) -> dict[str, Any]:
    def panel(panel_id: int, title: str, expr: str, y: int, unit: str = "percentunit"):
        return {
            "id": panel_id, "type": "timeseries", "title": title,
            "gridPos": {"x": 0, "y": y, "w": 24, "h": 8},
            "datasource": {"type": "prometheus", "uid": "${datasource}"},
            "fieldConfig": {"defaults": {"unit": unit}},
            "targets": [{"refId": "A", "expr": expr}],
        }

    target = slo["objective"]
    period = f"{window_days}d"
    return {
        "uid": f"selecta-slo-{slo['id']}",
        "title": f"SLO: {slo['name']}",
        "tags": ["selecta", "slo"],
        "schemaVersion": 39,
        "time": {"from": "now-7d", "to": "now"},
        "templating": {"list": [{"name": "datasource", "type": "datasource",
                                 "query": "prometheus"}]},
        "links": [{"title": "Runbook", "url": RUNBOOK_BASE + slo["runbook"]}],
        "panels": [
            panel(1, f"SLI (objective {target:.3%})",
                  f"({slo['good'].replace('{{window}}', '5m')}) / "
                  f"({slo['total'].replace('{{window}}', '5m')})", 0),
            panel(2, f"Error budget left over {period}",
                  f"1 - (({_ratio(slo, period)}) / {round(1 - target, 10)})", 8),
            panel(3, "Burn rate (1h and 6h)",
                  f'selecta:slo_error_ratio:1h{{slo="{slo["id"]}"}} / {round(1 - target, 10)}',
                  16, "none"),
        ],
    }


def outputs() -> dict[Path, str]:
    slos, alerts = load()
    files = {OUT / "prometheus-rules.yaml": "# Generated by selecta.observability.slo_rules. "
             "Edit slos.yaml or alerts.yaml.\n"
             + yaml.safe_dump(rules(slos, alerts), sort_keys=False, width=1000)}
    for slo in slos["slos"]:
        files[OUT / "dashboards" / f"{slo['id']}.json"] = (
            json.dumps(dashboard(slo, slos["window_days"]), indent=2) + "\n")
    return files


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate SLO alerts and dashboards.")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args(argv)
    stale = [path for path, text in outputs().items()
             if not path.is_file() or path.read_text("utf-8") != text]
    if args.write:
        for path, text in outputs().items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, "utf-8", newline="\n")
        return 0
    for path in stale:
        print(f"Out of date: {path.relative_to(ROOT)}")
    return 1 if stale else 0


if __name__ == "__main__":
    raise SystemExit(main())
