"""Dependency-free gates for the browser acceptance infrastructure."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "browser_test"))
from evidence import validate  # noqa: E402
from policy_gate import violations  # noqa: E402


class EvidenceTests(unittest.TestCase):
    def test_emulator_cannot_certify_speaker(self) -> None:
        issues = validate({
            "status": "certified", "device_class": "ipad-venue", "emulated": True,
            "real_hardware": False, "output_validation": "simulated",
            "observed_result": "pass", "foreground_powered_awake_hours": 6,
        })
        self.assertIn("certification requires physical hardware, not device emulation", issues)
        self.assertTrue(any("human sound check" in issue for issue in issues))

    def test_six_hours_not_inferred_from_mocked_time(self) -> None:
        issues = validate({
            "status": "certified", "device_class": "android-tablet-venue",
            "real_hardware": True, "output_validation": "human_heard_correct_speaker",
            "observed_result": "pass", "foreground_powered_awake_hours": 5.9,
            "tester": "test", "tested_at_utc": "2026-11-14T00:00:00Z", "measured": {},
        })
        self.assertTrue(any("six actual foreground hours" in issue for issue in issues))

    def test_uncertified_record_stays_uncertified(self) -> None:
        record = {key: "not-measured" for key in (
            "device_class", "model", "os_version", "browser_version", "chipset", "ram_gb",
            "source_type", "codec", "dsp_revision", "speaker_route", "measured",
            "output_validation", "observed_result"
        )}
        record["status"] = "blocked"
        self.assertEqual(validate(record), [])


class PolicyTests(unittest.TestCase):
    def test_new_cloud_upload_call_is_rejected(self) -> None:
        issues = violations([("web/src/cloud/api.ts", "return fetch('/uploads/plan')")])
        self.assertEqual(len(issues), 1)

    def test_metadata_and_test_fixture_strings_are_not_blocked(self) -> None:
        self.assertEqual(violations([
            ("web/src/cloud/api.ts", "return fetch('/api/lf/v1/devices')"),
            ("web/src/testsupport/browser/harness.js", "fetch('/uploads/plan')"),
        ]), [])

    def test_cloud_installer_requirement_is_rejected(self) -> None:
        self.assertEqual(len(violations([
            ("web/src/venue-player/setup.ts", "'You must install FFmpeg'")
        ])), 1)


if __name__ == "__main__":
    unittest.main()
