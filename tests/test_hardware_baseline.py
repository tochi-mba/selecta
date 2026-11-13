"""Flow SF-0199-06: the baseline recorder fills what the machine knows and names the rest."""

from __future__ import annotations

import json

from selecta.audit import hardware_baseline as baseline


def test_the_machine_describes_itself_and_the_person_fields_stay_missing():
    record = baseline.collect()
    assert record["os"] and record["cpu"] and record["python"]
    assert isinstance(record["logical_cores"], int) and record["logical_cores"] > 0
    assert record["memory_gb"] is None or record["memory_gb"] > 0
    assert record["missing"] == ["browser", "gpu", "background_load"]


def test_a_complete_record_has_nothing_missing_and_keeps_the_protocol():
    record = baseline.collect("Edge 142", "Intel Iris Xe", "idle, no other apps")
    assert record["missing"] == []
    assert record["protocol"] == list(baseline.PROTOCOL)
    assert any("visualizerBudget.test.tsx" in step for step in baseline.PROTOCOL)


def test_the_command_writes_json_and_fails_until_a_person_fills_it(tmp_path, capsys):
    out = tmp_path / "baseline.json"
    assert baseline.main(["--out", str(out)]) == 1
    assert "still needs a person: browser, gpu, background_load" in capsys.readouterr().err
    written = json.loads(out.read_text(encoding="utf-8"))
    assert written["missing"] == ["browser", "gpu", "background_load"]
    args = ["--browser", "Edge", "--gpu", "iGPU", "--load", "idle", "--out", str(out)]
    assert baseline.main(args) == 0
