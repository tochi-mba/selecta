"""Machine-readable, honest test outcomes and reviewable go/no-go ledgers."""
from __future__ import annotations

import json
import os
import platform
import subprocess
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal


Outcome = Literal["PASS", "FAIL", "BLOCKED", "ERROR"]
EvidenceClass = Literal["harness_self_test", "simulated", "integrated", "physical"]


def current_git_commit() -> str:
    value = os.environ.get("SELECTA_LF_SOURCE_COMMIT")
    if value:
        return value
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], text=True,
                              capture_output=True, check=True, timeout=3).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return "0c114859a4f2f13c264dcbd0cba2808d422a97da"  # ADR test-workspace base


def runtime_environment() -> dict[str, str]:
    return {"python": platform.python_version(), "os": platform.platform(),
            "architecture": platform.machine()}


@dataclass(frozen=True)
class Evidence:
    task_id: str
    adr: str
    source_commit: str
    test_case: str
    environment: dict[str, str]
    expected_result: str
    actual_result: str
    outcome: Outcome
    evidence_class: EvidenceClass
    residual_risks: list[str]
    migration_stage: str
    next_decision: str
    reviewer: str | None = None
    evidence_link: str | None = None
    date_utc: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def __post_init__(self) -> None:
        if not all((self.task_id, self.adr, self.source_commit, self.test_case,
                    self.expected_result, self.actual_result, self.next_decision)):
            raise ValueError("evidence cannot omit key provenance or result fields")
        if self.evidence_class in {"physical", "integrated"} and self.outcome == "PASS":
            if not self.evidence_link or not self.reviewer:
                raise ValueError("verified acceptance requires evidence link and reviewer")
        if self.evidence_class == "simulated" and self.outcome == "PASS":
            if "simulat" not in self.actual_result.lower():
                raise ValueError("simulation must be clearly labelled as simulation")


@dataclass
class EvidenceLedger:
    records: list[Evidence] = field(default_factory=list)

    def add(self, record: Evidence) -> None:
        self.records.append(record)

    def gate(self, *, mandatory_cases: list[str], require_physical: bool = False) -> tuple[bool, list[str]]:
        missing = []
        for case in mandatory_cases:
            verified = [r for r in self.records if r.test_case == case and
                        r.outcome == "PASS" and r.evidence_class in {"integrated", "physical"}]
            if not verified:
                missing.append(f"{case}: no independently evidenced integrated PASS")
            elif require_physical and not any(r.evidence_class == "physical" for r in verified):
                missing.append(f"{case}: no physical output evidence")
        for record in self.records:
            if record.outcome in {"FAIL", "BLOCKED", "ERROR"}:
                missing.append(f"{record.test_case}: {record.outcome} - {record.actual_result}")
        return (not missing, missing)

    def write(self, target: Path) -> None:
        """Atomic output, suitable for build artifact collection. Never mark simulated as verified."""
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + ".tmp")
        with temporary.open("w", encoding="utf-8") as file:
            json.dump({"schema_version": 1, "records": [asdict(r) for r in self.records]},
                      file, indent=2, sort_keys=True)
            file.write("\n")
        temporary.replace(target)

    @classmethod
    def read(cls, target: Path) -> "EvidenceLedger":
        payload = json.loads(target.read_text(encoding="utf-8"))
        if payload.get("schema_version") != 1:
            raise ValueError("unsupported ledger version")
        return cls([Evidence(**item) for item in payload["records"]])
