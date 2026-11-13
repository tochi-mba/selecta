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

    def test_unsafe_cross_tenant_status_is_detected(self):
        class BrokenAdapter:
            def dispatch_cross_tenant(self, **_kwargs):
                return {"status": "applied"}
        with self.assertRaises(ContractViolation):
            AcceptanceRunner._check_tenant(BrokenAdapter())


if __name__ == "__main__":
    unittest.main()
