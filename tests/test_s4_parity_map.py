"""S4-0089-03: the Selecta 4.0 feature parity map names guarding tests for every capability.

docs/adr/selecta-4-feature-parity.md maps each existing capability to its surface and ADR. Every row
must also name at least one guarding test, and every named test file must exist, so no capability is
orphaned and a renamed or deleted test shows up here.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP = ROOT / "docs" / "adr" / "selecta-4-feature-parity.md"


def _rows() -> list[list[str]]:
    rows = []
    for line in MAP.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| ") or line.startswith("| Existing capability"):
            continue
        rows.append([cell.strip() for cell in line.strip().strip("|").split("|")])
    return rows


def test_every_capability_names_guarding_tests():
    rows = _rows()
    assert len(rows) >= 25
    for cells in rows:
        assert len(cells) == 5, cells[0]
        assert re.findall(r"`([^`]+)`", cells[4]), f"{cells[0]} has no guarding test"


def test_every_named_test_file_exists():
    missing = [
        (cells[0], path)
        for cells in _rows()
        for path in re.findall(r"`([^`]+)`", cells[4])
        if not (ROOT / path).is_file()
    ]
    assert missing == []
