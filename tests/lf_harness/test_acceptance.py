"""Prove acceptance fails closed with missing/faulty adapters (not system success)."""
from __future__ import annotations

import unittest

from .acceptance import AcceptanceConfig, AcceptanceRunner, MANDATORY_CASES, blocked_ledger
from .contracts import ContractViolation


class MissingIntegrationTests(unittest.TestCase):
    def test_missing_production_returns_all_explicitly_blocked(self):
        ledger = blocked_ledger(reason="no production adapter", source_commit="adr-base")
        self.assertEqual(len(ledger.records), len(MANDATORY_CASES))
        self.assertTrue(all(r.outcome == "BLOCKED" for r in ledger.records))
        self.assertFalse(ledger.gate(mandatory_cases=MANDATORY_CASES)[0])

    def test_integrated_success_must_provide_independent_review(self):
        with self.assertRaisesRegex(ValueError, "independent reviewer"):
            AcceptanceRunner(AcceptanceConfig("sha", "", ""))

    def test_broken_device_result_is_detected(self):
        class BrokenAdapter:
            def query_availability(self, **_kwargs):
                return {"status": "ready", "tracks": []}
        from .contracts import synthetic_recipe
        with self.assertRaises(ContractViolation):
            AcceptanceRunner._check_media(BrokenAdapter(), synthetic_recipe(["t"] * 8),
                                           "engine-a", 5)

    def test_empty_egress_capture_fails_closed(self):
        class BadAdapter:
            def captured_egress(self):
                return []
        from .fixtures import make_five_of_eight_fleet
        with make_five_of_eight_fleet() as fleet:
            with self.assertRaisesRegex(ContractViolation, "active, nonempty"):
                AcceptanceRunner._check_egress(BadAdapter(), fleet)

    def test_simulated_takeover_is_not_integrated_evidence(self):
        class BadAdapter:
            def attempt_takeover(self, **kwargs):
                if kwargs["operation_id"] == "race-2":
                    return {"result": "rejected", "observations": []}
                return {"result": "applied", "observations": [{
                    "device_id": "engine-a", "zone_id": "main",
                    "physical_output_id": "speaker-a", "start_ms": 0, "end_ms": 10,
                    "generation": 1, "kind": "simulation",
                }]}
        with self.assertRaisesRegex(ContractViolation, "simulation"):
            AcceptanceRunner._check_takeover(BadAdapter(), partition=False)

    def test_unsafe_cross_tenant_status_is_detected(self):
        class BrokenAdapter:
            def dispatch_cross_tenant(self, **_kwargs):
                return {"status": "applied"}
        with self.assertRaises(ContractViolation):
            AcceptanceRunner._check_tenant(BrokenAdapter())


if __name__ == "__main__":
    unittest.main()
