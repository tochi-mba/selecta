"""T0009: every pre-redesign component and player test is mapped to a parity row and still covered.

`docs/adr/test-parity-inventory.json` lists each test that existed at the baseline (main `911c981`),
the `feature-parity.md` row its assertions protect, and either that it is kept (in its own file or
moved to another) or which current test now carries its behaviour. This fails when a test in the
inventory is removed or renamed without the inventory saying where its behaviour went.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = json.loads((ROOT / "docs/adr/test-parity-inventory.json").read_text(encoding="utf-8"))
PARITY = (ROOT / "docs/adr/feature-parity.md").read_text(encoding="utf-8")
ROWS = {
    line.split(" | ")[0].lstrip("| ").strip()
    for line in PARITY.splitlines()
    if line.startswith("| ") and not line.startswith("| Capability")
}


def _named(file: str, title: str) -> bool:
    source = (ROOT / file).read_text(encoding="utf-8")
    return any(f"{quote}{title}{quote}" in source for quote in ("'", '"', "`"))


def test_every_baseline_test_is_in_the_inventory():
    tests = INVENTORY["tests"]
    assert INVENTORY["baseline"] == "911c981"
    assert len(tests) == 263
    assert len({(entry["file"], entry["test"]) for entry in tests}) == len(tests)


def test_every_test_maps_to_a_real_parity_row():
    for entry in INVENTORY["tests"]:
        assert entry["parity"] in ROWS, entry


def test_every_baseline_behaviour_is_still_tested():
    for entry in INVENTORY["tests"]:
        if entry.get("kept"):
            assert _named(entry.get("moved_to", entry["file"]), entry["test"]), entry
        else:
            replacement = entry["replaced_by"]
            assert _named(replacement["file"], replacement["test"]), entry
