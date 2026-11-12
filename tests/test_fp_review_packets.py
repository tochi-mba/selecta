"""FP person-step review packets (FP-0264-06/08, FP-0265-02/08, FP-0266-08, FP-0267-01/08,
FP-0268-08, FP-0269-08, FP-0270-08, FP-0271-08)."""

from __future__ import annotations

import datetime as dt
import json

import pytest

from selecta.audit import fp_review_packets as fp

SHA = "a" * 40
TODAY = dt.date(2026, 11, 12)


def _sign(packet: dict, verdict: str = "pass", **fields: str) -> dict:
    packet["reviewer"] = "Ada Reviewer"
    packet["reviewed_on"] = "2026-11-12"
    for item in packet["items"]:
        item["verdict"] = verdict
        item["note"] = "seen"
        for name in fp.TASKS[packet["task"]]["fields"]:
            item[name] = fields.get(name, "x")
    return packet


def test_every_person_step_has_a_packet_and_none_is_verified():
    assert set(fp.TASKS) == {
        "FP-0264-06",
        "FP-0264-08",
        "FP-0265-02",
        "FP-0265-08",
        "FP-0266-08",
        "FP-0267-01",
        "FP-0267-08",
        "FP-0268-08",
        "FP-0269-08",
        "FP-0270-08",
        "FP-0271-08",
    }
    contrast = {"threshold": 3, "edges": []}
    manifests = [{"required": 0, "captured": 0, "candidates": []}]
    for task_id in fp.TASKS:
        packet = fp.build(task_id, contrast=contrast, manifests=manifests, sha=SHA, today=TODAY)
        assert packet["status"] == "awaiting-person"
        assert packet["reviewer"] is None and packet["reviewed_on"] is None
        assert all(item["verdict"] is None for item in packet["items"])
        assert "no named reviewer" in fp.check(packet)


def test_fp_0264_08_lists_every_edge_under_3_with_essential_ones_as_p0():
    report = {
        "threshold": 3,
        "measured": 3,
        "edges": [
            {
                "state": "library-list",
                "theme": "light",
                "role": "interactive",
                "component": "input",
                "label": "Search",
                "edge": 3.4,
                "surface": "#fff",
                "essential": True,
            },
            {
                "state": "shape-dialog",
                "theme": "light",
                "role": "decorative",
                "component": "div",
                "label": "Dialog",
                "edge": 2.21,
                "surface": "#fff",
                "essential": False,
            },
            {
                "state": "editor",
                "theme": "dark",
                "role": "interactive",
                "component": "select",
                "label": "Key",
                "edge": 2.5,
                "surface": "#111",
                "essential": True,
            },
        ],
    }
    packet = fp.build("FP-0264-08", contrast=report, sha=SHA, today=TODAY)
    severities = {item["id"]: item["severity"] for item in packet["items"]}
    assert severities == {"shape-dialog/light/div/dialog": "exempt", "editor/dark/select/key": "P0"}
    assert packet["measured_edges"] == 3
    _sign(packet)
    packet["items"][1]["verdict"] = "fail"
    assert any("P0 item(s) failed" in p for p in fp.check(packet))
    packet["items"][1]["verdict"] = "accepted-exception"
    assert fp.check(packet) == []


def test_check_refuses_automation_reviewers_short_shas_and_missing_reasons():
    packet = _sign(fp.build("FP-0264-06", sha=SHA, today=TODAY))
    assert len(packet["items"]) == len(fp.MANUAL_CONTROLS) * len(fp.MANUAL_CHECKS)
    assert fp.check(packet) == []
    packet["reviewer"] = "CI"
    assert any("automation" in p for p in fp.check(packet))
    packet["reviewer"] = "Ada Reviewer"
    packet["source_sha"] = "abc123"
    assert any("40-character" in p for p in fp.check(packet))
    packet["source_sha"] = SHA
    packet["items"][0]["verdict"], packet["items"][0]["note"] = "accepted-exception", ""
    assert any("needs a reason" in p for p in fp.check(packet))


def test_fp_0265_chrome_packets_need_screenshots_versions_and_observations():
    capture = fp.build("FP-0265-02", sha=SHA, today=TODAY)
    assert len(capture["items"]) == 2 * 2 * len(fp.CHROME_CASES)
    assert {
        "Chrome/tab-toolbar/light-on-os-dark",
        "Edge/installed-app-title-bar/system-on-os-dark",
    } <= {item["id"] for item in capture["items"]}
    _sign(capture)
    capture["items"][0]["screenshot"] = ""
    assert fp.check(capture) == [f"{capture['items'][0]['id']}: screenshot is empty"]
    matrix = fp.build("FP-0265-08", sha=SHA, today=TODAY)
    assert len(matrix["items"]) == len(fp.CHROME_MATRIX)
    assert all("fallback:" in item["evidence"] for item in matrix["items"])
    assert fp.check(_sign(matrix)) == []


def test_fp_0266_0269_0270_packets_follow_the_repo_inventories():
    graphics = fp.build("FP-0266-08", sha=SHA, today=TODAY)
    inventory = (fp.ROOT / "docs/engineering/music-graphics-inventory.md").read_text("utf-8")
    rows = fp._table_rows(inventory, "Graphic")
    assert len(rows) >= 20 and len(graphics["items"]) == 2 * len(rows)
    assert {"waveform-playhead/now/light", "waveform-playhead/now/dark"} <= {
        item["id"] for item in graphics["items"]
    }
    parity = fp.build("FP-0269-08", sha=SHA, today=TODAY)
    register = (fp.ROOT / "docs/engineering/action-tier-register.md").read_text("utf-8")
    assert len(parity["items"]) == len(fp._table_rows(register, "Surface")) >= 20
    assert any(item["severity"] == "P0" for item in parity["items"])
    collision = fp.build("FP-0270-08", sha=SHA, today=TODAY)
    precedence = (fp.ROOT / "docs/engineering/layer-precedence.md").read_text("utf-8")
    situations = fp._table_rows(precedence, "Situation")
    assert len(situations) >= 8
    assert len(collision["items"]) == len(situations) * len(fp.COLLISION_DEVICES)
    for packet in (graphics, parity, collision):
        assert fp.check(_sign(packet)) == []


def _manifest(pairs: list[tuple[str, str, str]], required: int) -> dict:
    candidates = [
        {
            "id": pid,
            "theme": theme,
            "width": 375,
            "height": 667,
            "semanticSha256": sem,
            "screenshot": f"{pid}-{theme}.png",
        }
        for pid, theme, sem in pairs
    ]
    return {
        "required": required,
        "captured": len(candidates),
        "sourceSha": SHA,
        "candidates": candidates,
    }


def test_fp_0271_08_gate_says_go_only_with_every_pair_passed_and_complete():
    manifest = _manifest(
        [
            ("start", "light", "s1"),
            ("start", "dark", "s1"),
            ("library", "light", "s2"),
            ("library", "dark", "s2"),
        ],
        4,
    )
    packet = fp.build("FP-0271-08", manifests=[manifest], sha=SHA, today=TODAY)
    assert packet["denominator"]["pairs"] == 2 and packet["decision"] is None
    assert "semantics equal" in packet["items"][0]["evidence"]
    _sign(packet)
    assert fp.check(packet) == ["decision must be GO or NO-GO"]
    packet["decision"] = "GO"
    assert fp.check(packet) == []
    packet["items"][0]["verdict"] = "fail"
    assert "GO with 1 open P0 pair(s)" in fp.check(packet)
    packet["decision"] = "NO-GO"
    assert fp.check(packet) == []
    short = fp.build(
        "FP-0271-08", manifests=[_manifest([("start", "light", "s")], 2)], sha=SHA, today=TODAY
    )
    assert "missing dark" in short["items"][0]["evidence"]
    _sign(short)
    short["decision"] = "GO"
    assert "GO with an incomplete pair denominator" in fp.check(short)


def _records(phase: str, seconds: float, success: bool = True, false: int = 0) -> list[dict]:
    spec = fp.STUDY_TASKS["FP-0267-08"]
    return [
        {
            "participant": f"p{i}",
            "group": group,
            "phase": phase,
            "task": task,
            "seconds": seconds + i,
            "success": success,
            "false_beliefs": false,
        }
        for group in spec["groups"]
        for task, _ in spec["tasks"]
        for i in range(2)
    ]


def test_study_summary_and_comparison():
    summary = fp.summarise_study(_records("before", 20))
    assert summary["before/novice/browse"] == {
        "n": 2,
        "median_seconds": 20.5,
        "success_rate": 1.0,
        "false_beliefs": 0,
    }
    faster = fp.compare_studies(_records("before", 20) + _records("after", 10), "before", "after")
    assert set(faster.values()) == {"improved"}
    same = fp.compare_studies(_records("before", 20) + _records("after", 21), "before", "after")
    assert set(same.values()) == {"stable"}
    wrong = _records("before", 20) + _records("after", 20, false=1)
    assert set(fp.compare_studies(wrong, "before", "after").values()) == {"worse"}


@pytest.mark.parametrize("task_id", ["FP-0267-01", "FP-0267-08", "FP-0268-08"])
def test_study_packets_need_every_phase_group_and_task(task_id):
    packet = _sign(fp.build(task_id, sha=SHA, today=TODAY))
    spec = fp.STUDY_TASKS[task_id]
    assert len(packet["items"]) == len(spec["tasks"]) * len(spec["groups"])
    assert any(p.startswith(f"no {spec['phases'][0]} record") for p in fp.check(packet))
    packet["records"] = [
        {
            "participant": "p1",
            "group": g,
            "phase": ph,
            "task": t,
            "seconds": 10,
            "success": True,
            "false_beliefs": 0,
        }
        for ph in spec["phases"]
        for g in spec["groups"]
        for t, _ in spec["tasks"]
    ]
    assert fp.check(packet) == []
    if len(spec["phases"]) == 2:
        packet["records"][-1]["false_beliefs"] = 2
        assert any("worse" in p for p in fp.check(packet))


def test_cli_build_and_check_round_trip(tmp_path, capsys):
    out = tmp_path / "packet.json"
    assert fp.main(["build", "FP-0265-08", "--out", str(out)]) == 0
    assert fp.main(["check", str(out)]) == 1
    packet = _sign(json.loads(out.read_text("utf-8")))
    packet["source_sha"] = SHA
    out.write_text(json.dumps(packet), "utf-8")
    assert fp.main(["check", str(out)]) == 0
    assert "ready" in capsys.readouterr().out


def test_index_doc_is_current_and_has_no_em_dash():
    text = fp.render_index()
    assert "\\u2014" not in text
    assert (fp.ROOT / fp.INDEX_DOC).read_text("utf-8") == text
