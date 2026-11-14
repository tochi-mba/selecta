"""Manual/hardware device certification validator; no emulation counts as proof."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

MANDATORY = (
    "device_class", "model", "os_version", "browser_version", "chipset",
    "ram_gb", "source_type", "codec", "dsp_revision", "speaker_route",
    "measured", "output_validation", "observed_result",
)
MEASUREMENTS = (
    "underruns", "transition_error_ms_p95", "render_short_seconds",
    "render_long_seconds", "peak_ram_mb", "free_storage_mb",
    "cancellation_observed", "offline_observed", "heat_celsius",
    "battery_start_pct", "battery_end_pct",
)


def validate(record: dict) -> list[str]:
    problems = [f"missing {key}" for key in MANDATORY if key not in record]
    if record.get("status") != "certified":
        return problems
    if record.get("emulated") or not record.get("real_hardware"):
        problems.append("certification requires physical hardware, not device emulation")
    if record.get("output_validation") != "human_heard_correct_speaker":
        problems.append("certification requires a human sound check on the actual route")
    if record.get("observed_result") != "pass":
        problems.append("certification requires observed_result=pass")
    if not record.get("tester") or not record.get("tested_at_utc"):
        problems.append("certification requires named tester and UTC test time")
    measured = record.get("measured")
    if not isinstance(measured, dict):
        problems.append("certification requires measurements, not estimates")
    else:
        problems.extend(f"missing measured.{key}" for key in MEASUREMENTS if key not in measured)
    if record.get("device_class") in ("ipad-venue", "android-tablet-venue"):
        hours = record.get("foreground_powered_awake_hours")
        if not isinstance(hours, (float, int)) or hours < 6:
            problems.append("venue certification requires six actual foreground hours")
        if record.get("background_recovery_verified") is True:
            problems.append("six-hour foreground test cannot certify background recovery")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("file", type=Path)
    args = parser.parse_args()
    data = json.loads(args.file.read_text(encoding="utf-8"))
    records = data if isinstance(data, list) else [data]
    issues = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            issues.append(f"{index}: record is not an object")
            continue
        issues.extend(f"{index}: {issue}" for issue in validate(record))
    for item in issues:
        print("[NO-GO] " + item)
    print(f"[BROWSER-QA] records={len(records)} certification_errors={len(issues)}")
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
