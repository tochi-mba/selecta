"""Adapter-driven acceptance: no integrated implementation means BLOCKED, never PASS.

Production adapters belong to their implementation owners; LF19 does not import or
modify any application code. All attached media remain under temporary local roots.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from .contracts import (
    ContractViolation,
    assert_availability_contract,
    assert_command_result,
    synthetic_recipe,
)
from .evidence import Evidence, EvidenceLedger, current_git_commit, runtime_environment
from .fixtures import Fleet, make_five_of_eight_fleet
from .playback import OutputSafetyMonitor, PlaybackObservation
from .security import assert_no_media_in_cloud_capture, cross_tenant_command, forbidden_media_probes


class AcceptanceAdapter(Protocol):
    """Version 1 test integration seam, *not* a proposed cloud API.

    `prepare` provisions two actual isolated local executors from Fleet roots and
    two controller identities. It must not upload media; an instrumented cloud-side
    egress recorder is required for any networked execution.

    `inspect_ingress` tests a local/staging request inspector *before* any cloud
    transport; forbidden payloads must never be sent over a production network.

    `takeover` must return instrumented playback intervals and the authoritative
    local command result, not a cloud lease. All observations include evidence kind.
    """

    def prepare(self, fleet: Fleet) -> None: ...
    def query_availability(
        self, *, device_id: str, workspace_id: str, recipe: dict[str, Any]
    ) -> dict[str, Any]: ...
    def attempt_takeover(
        self,
        *,
        source: str,
        destination: str,
        workspace_id: str,
        operation_id: str,
        expected_generation: int,
        partition_original: bool,
    ) -> dict[str, Any]: ...
    def dispatch_cross_tenant(self, *, command: dict[str, Any]) -> dict[str, Any]: ...
    def inspect_ingress(self, *, payload: dict[str, Any]) -> dict[str, Any]: ...
    def captured_egress(self) -> dict[str, Any]: ...
    def close(self) -> None: ...


MANDATORY_CASES = [
    "five_of_eight_media",
    "all_eight_media",
    "cross_tenant_denial",
    "concurrent_takeover",
    "partitioned_speaker_denial",
    "forbidden_media_ingress",
    "no_media_cloud_egress",
    "physical_output_measurement",
]


@dataclass(frozen=True)
class AcceptanceConfig:
    source_commit: str
    reviewer: str
    evidence_link: str
    migration_stage: str = "pre-cutover"


class AcceptanceRunner:
    def __init__(self, config: AcceptanceConfig) -> None:
        if not config.reviewer or not config.evidence_link:
            raise ValueError("integrated PASS needs an independent reviewer and evidence link")
        self.config = config
        self.ledger = EvidenceLedger()

    def _record(self, case: str, adr: str, expected: str, run) -> None:
        try:
            result = run()
            if result is not True:
                raise ContractViolation(f"{case}: assertion did not return True")
        except Exception as error:
            # Never dump raw payloads/media into evidence reports.
            outcome, actual = "FAIL", f"{type(error).__name__}: {str(error)[:180]}"
        else:
            outcome, actual = (
                "PASS",
                "adapter-observed assertions passed; see linked independent evidence",
            )
        self.ledger.add(
            Evidence(
                task_id="LF-0482-03",
                adr=adr,
                source_commit=self.config.source_commit,
                test_case=case,
                expected_result=expected,
                actual_result=actual,
                outcome=outcome,
                evidence_class="integrated",
                reviewer=self.config.reviewer,
                evidence_link=self.config.evidence_link,
                environment=runtime_environment(),
                residual_risks=["physical audio not established by software-only observations"],
                migration_stage=self.config.migration_stage,
                next_decision="independent physical and migration gates remain mandatory",
            )
        )

    def run(self, adapter: AcceptanceAdapter) -> EvidenceLedger:
        try:
            with make_five_of_eight_fleet() as fleet:
                adapter.prepare(fleet)
                recipe = synthetic_recipe(fleet.recipe_ids)
                self._record(
                    "five_of_eight_media",
                    "ADR-0458/0459",
                    "exact 5 ready, 3 missing",
                    lambda: self._check_media(adapter, recipe, "engine-a", 5),
                )
                self._record(
                    "all_eight_media",
                    "ADR-0458/0459",
                    "exact 8 ready",
                    lambda: self._check_media(adapter, recipe, "engine-b", 8),
                )
                self._record(
                    "cross_tenant_denial",
                    "ADR-0462/0469",
                    "cross-workspace command rejected",
                    lambda: self._check_tenant(adapter),
                )
                self._record(
                    "concurrent_takeover",
                    "ADR-0466",
                    "at most one device actually playing",
                    lambda: self._check_takeover(adapter, partition=False),
                )
                self._record(
                    "partitioned_speaker_denial",
                    "ADR-0466",
                    "partitioned old speaker refuses takeover",
                    lambda: self._check_takeover(adapter, partition=True),
                )
                self._record(
                    "forbidden_media_ingress",
                    "ADR-0457",
                    "all synthetic media ingress denied before network",
                    lambda: self._check_ingress(adapter, fleet),
                )
                self._record(
                    "no_media_cloud_egress",
                    "ADR-0457",
                    "zero captured audio/path on cloud egress",
                    lambda: self._check_egress(adapter, fleet),
                )
        finally:
            adapter.close()
        # An automated interval is NOT actual audible measurement. Never mark this case PASS.
        self.ledger.add(
            Evidence(
                task_id="LF-0482-03",
                adr="ADR-0466/0467/0482",
                source_commit=self.config.source_commit,
                test_case="physical_output_measurement",
                expected_result="independent measured speaker output",
                actual_result="BLOCKED: real-device acoustic capture and signed six-hour soak are required",
                outcome="BLOCKED",
                evidence_class="physical",
                reviewer=self.config.reviewer,
                evidence_link=None,
                environment=runtime_environment(),
                residual_risks=[
                    "silent output, speaker partition and physical gaps remain unverified"
                ],
                migration_stage=self.config.migration_stage,
                next_decision="run physical-output and venue soak on supported hardware",
            )
        )
        return self.ledger

    @staticmethod
    def _check_media(adapter: AcceptanceAdapter, recipe: dict, device: str, ready: int) -> bool:
        result = adapter.query_availability(
            device_id=device, workspace_id="workspace-a", recipe=recipe
        )
        assert_availability_contract(
            result, device_id=device, revision=recipe["revision_id"], expected_occurrences=8
        )
        states = [x["state"] for x in result["tracks"]]
        if states.count("ready") != ready or states.count("missing") != 8 - ready:
            raise ContractViolation(f"{device}: expected {ready}/8 ready")
        if result["status"] == "ready" and ready != 8:
            raise ContractViolation("aggregate falsely ready")
        if ready == 8 and result["status"] != "ready":
            raise ContractViolation("all recordings ready but aggregate incorrectly unavailable")
        return True

    @staticmethod
    def _check_tenant(adapter: AcceptanceAdapter) -> bool:
        result = adapter.dispatch_cross_tenant(
            command=cross_tenant_command(
                target_device_id="engine-a", foreign_workspace="workspace-b"
            )
        )
        assert_command_result(result, local_ack=False)
        if result["status"] not in {"rejected", "conflicted"}:
            raise ContractViolation("cross-tenant device accepted command")
        return True

    @staticmethod
    def _check_takeover(adapter: AcceptanceAdapter, *, partition: bool) -> bool:
        # Each call is explicitly instrumented by the adapter. Distinct op IDs expose
        # idempotency/generation races; no fake success from the reference scenario.
        first = adapter.attempt_takeover(
            source="engine-a",
            destination="engine-b",
            workspace_id="workspace-a",
            operation_id="race-1" if not partition else "partition-1",
            expected_generation=7,
            partition_original=partition,
        )
        second = adapter.attempt_takeover(
            source="engine-a",
            destination="engine-b",
            workspace_id="workspace-a",
            operation_id="race-2" if not partition else "partition-2",
            expected_generation=7,
            partition_original=partition,
        )
        monitor = OutputSafetyMonitor()
        for response in (first, second):
            for item in response.get("observations", []):
                monitor.add(PlaybackObservation(**item))
            if response.get("result") not in {
                "accepted",
                "rejected",
                "conflicted",
                "applied",
                "acknowledged",
            }:
                raise ContractViolation("missing authoritative takeover status")
        monitor.assert_no_double_audio()
        if any(o.kind == "simulation" for o in monitor.observations):
            raise ContractViolation("simulation is not a valid integrated output observation")
        applied = sum(r["result"] in {"applied", "acknowledged"} for r in (first, second))
        if partition and any(
            r["result"] in {"accepted", "applied", "acknowledged"} for r in (first, second)
        ):
            raise ContractViolation("unsafe takeover while old speaker may be audible")
        if partition and any(o.device_id == "engine-b" for o in monitor.observations):
            raise ContractViolation("partitioned new speaker was observed outputting audio")
        if not partition and applied != 1:
            raise ContractViolation("takeover must apply exactly once with local ACK")
        if not monitor.observations:
            raise ContractViolation("no instrumented output intervals supplied")
        if not partition and {o.device_id for o in monitor.observations} != {
            "engine-a",
            "engine-b",
        }:
            raise ContractViolation("missing original or destination output observations")
        return True

    @staticmethod
    def _check_ingress(adapter: AcceptanceAdapter, fleet: Fleet) -> bool:
        fixture = fleet.devices["engine-a"].catalogue["recording-01"]
        for probe in forbidden_media_probes(fixture):
            response = adapter.inspect_ingress(payload=probe.payload)
            if response.get("status") not in {"rejected", "blocked"}:
                raise ContractViolation(f"unsafe ingest: {probe.name} not rejected")
        return True

    @staticmethod
    def _check_egress(adapter: AcceptanceAdapter, fleet: Fleet) -> bool:
        capture = adapter.captured_egress()
        if (
            not isinstance(capture, dict)
            or capture.get("instrumentation_active") is not True
            or not isinstance(capture.get("packets"), list)
            or not capture["packets"]
        ):
            raise ContractViolation("no active, nonempty independent egress capture")
        for cap in capture["packets"]:
            for device in (fleet.devices["engine-a"], fleet.devices["engine-b"]):
                for fixture in device.catalogue.values():
                    assert_no_media_in_cloud_capture(cap, fixture)
        return True


def blocked_ledger(*, reason: str, source_commit: str | None = None) -> EvidenceLedger:
    ledger = EvidenceLedger()
    for case in MANDATORY_CASES:
        ledger.add(
            Evidence(
                task_id="LF-0482-03",
                adr="ADR-0482",
                source_commit=source_commit or current_git_commit(),
                test_case=case,
                expected_result="integrated independent test evidence",
                actual_result=f"BLOCKED: {reason}",
                outcome="BLOCKED",
                evidence_class="integrated",
                residual_risks=["LF production implementation unverified"],
                migration_stage="pre-integration",
                next_decision="connect real implementation adapter",
                environment=runtime_environment(),
            )
        )
    return ledger
