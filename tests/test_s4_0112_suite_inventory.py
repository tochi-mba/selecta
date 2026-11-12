"""S4-0112-01: the baseline-to-now test inventory finds every test by name and every file by
rename."""

from __future__ import annotations

import subprocess

from selecta.audit import suite_inventory as inventory


def test_names_are_read_from_python_and_typescript_tests() -> None:
    python = (
        "def test_one():\n    pass\nasync def test_two(x):\n    pass\ndef helper():\n    pass\n"
    )
    assert inventory.names_in("tests/test_x.py", python) == ["test_one", "test_two"]
    script = (
        "it('keeps it', () => {});\ntest(\"a 'quoted' one\", async () => {});\n"
        "test.skip(`template ${name}`, () => {});\nit('keeps it', () => {});\n"
    )
    assert inventory.names_in("web/src/x.test.tsx", script) == [
        "keeps it",
        "a 'quoted' one",
        "template ${name}",
    ]


def test_kinds_cover_every_suite_and_nothing_else() -> None:
    assert inventory.kind_of("tests/test_api.py") == "python"
    assert inventory.kind_of("web/src/views/Mix.test.tsx") == "web unit"
    assert inventory.kind_of("web/e2e/pages.e2e.ts") == "browser"
    assert inventory.kind_of("web/e2e/mp-baseline.mp.ts") == "browser"
    assert inventory.kind_of("web/bench/scale.bench.ts") == "bench"
    assert inventory.kind_of("tests/helpers.py") is None
    assert inventory.kind_of("web/e2e/helpers.ts") is None


def test_kept_moved_renamed_and_not_found_are_told_apart() -> None:
    old = {
        "tests/test_a.py": (
            "def test_stays():\n  pass\ndef test_goes():\n  pass\ndef test_lost():\n  pass\n"
        ),
        "tests/test_old.py": "def test_renamed_file():\n  pass\n",
    }
    new = {
        "tests/test_a.py": "def test_stays():\n  pass\n",
        "tests/test_b.py": "def test_goes():\n  pass\n",
        "tests/test_new.py": "def test_renamed_file():\n  pass\n",
    }
    maps = {
        m.path: m for m in inventory.build(old, new, {"tests/test_old.py": "tests/test_new.py"})
    }
    a = maps["tests/test_a.py"]
    assert (a.kept, a.moved, a.not_found) == (
        ["test_stays"],
        {"test_goes": "tests/test_b.py"},
        ["test_lost"],
    )
    assert a.status == "tests not found"
    assert maps["tests/test_old.py"].now == "tests/test_new.py"
    assert maps["tests/test_old.py"].status == "renamed, same tests"
    text = inventory.markdown(maps.values(), "abc1234", len(new), 3)
    assert "Not found by name: 1." in text and "'test_lost'" in text
    assert "is now in `tests/test_b.py`" in text


def test_the_written_report_lists_every_baseline_test_file() -> None:
    listed = subprocess.run(
        ["git", "ls-tree", "-r", "--name-only", inventory.BASELINE],
        cwd=inventory.ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    baseline = [path for path in listed if inventory.kind_of(path)]
    report = inventory.REPORT.read_text(encoding="utf-8")
    assert f"Baseline `{inventory.BASELINE}`" in report
    assert f"- Baseline: {len(baseline)} test files" in report
    missing = [path for path in baseline if f"| `{path}` |" not in report]
    assert missing == []
