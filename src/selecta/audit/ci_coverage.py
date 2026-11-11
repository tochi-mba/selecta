"""CI-0184-03: the creative-interface test coverage matrix, mapped to task IDs.

Each CI task's Evidence field names the test files and test names that prove it. This reads the
checklist and sorts that evidence into three kinds of coverage: state (unit and Python tests that
drive the feature through its states), browser (Playwright specs, which run in a real browser at
set viewport sizes) and negative case (a cited test whose name says what must not happen). Any kind
a task is missing is listed as a gap, so the matrix says what is not covered as plainly as what is.
Read-only, except `--write`, which regenerates the matrix file the test compares against.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CHECKLIST = ROOT / "docs/adr/selecta-creative-interface-implementation-checklist.md"
MATRIX = ROOT / "docs/adr/selecta-creative-interface-coverage-matrix.md"

LINE = re.compile(r"^- \[( |x)\] \*\*(CI-\d{4}-\d{2}) - ([^*]+?)\.?\*\*(.*)$", re.M)
FILE = re.compile(
    r"((?:web/(?:src|e2e)/[\w./-]+?\.(?:test\.tsx?|e2e\.ts))|(?:tests/[\w./-]+?\.py))"
)
NAME = re.compile(r"[\"'“]([^\"'“”]{6,160})[\"'”]")
NEGATIVE = re.compile(
    r"\b(not|never|no|nothing|none|without|cannot|can't|can’t|isn't|isn’t|doesn't"
    r"|doesn’t|won't|won’t|fail\w*|refus\w*|error\w*|wrong|missing|stale|offline"
    r"|denied|blocked|only|unknown|empty|reject\w*|broken|lost)\b",
    re.I,
)


def _evidence(rest: str) -> str:
    found = rest.split("**Evidence:**", 1)
    return found[1] if len(found) > 1 else ""


def rows(text: str | None = None) -> list[dict]:
    text = CHECKLIST.read_text(encoding="utf-8") if text is None else text
    out = []
    for ticked, task, title, rest in LINE.findall(text):
        evidence = _evidence(rest)
        files = sorted(set(FILE.findall(evidence)))
        state = [name for name in files if not name.endswith(".e2e.ts")]
        browser = [name for name in files if name.endswith(".e2e.ts")]
        negative = [name for name in NAME.findall(evidence) if NEGATIVE.search(name)]
        person = "Needs a person" in rest
        if ticked == "x":
            status = "ticked"
        elif person:
            status = "person"
        else:
            status = "open"
        gaps = []
        if status == "ticked":
            gaps = [
                kind
                for kind, have in (("state", state), ("browser", browser), ("negative", negative))
                if not have
            ]
        out.append(
            {
                "task": task,
                "title": title.strip(),
                "status": status,
                "state": state,
                "browser": browser,
                "negative": negative,
                "gaps": gaps,
            }
        )
    return out


def _cell(items: list[str]) -> str:
    return "; ".join(f"`{item}`" for item in items) if items else "-"


def markdown(text: str | None = None) -> str:
    table = rows(text)
    ticked = [row for row in table if row["status"] == "ticked"]
    whole = [row for row in ticked if not row["gaps"]]
    lines = [
        "# Selecta - creative-interface test coverage matrix",
        "",
        "Generated from the Evidence fields of the "
        "[CI checklist](selecta-creative-interface-implementation-checklist.md) by "
        "`python -m selecta.audit.ci_coverage --write`; `tests/test_ci_coverage_matrix.py` fails "
        "when it is out of date (CI-0184-03).",
        "",
        "- **State:** unit and Python tests that drive the feature through its states.",
        "- **Browser:** Playwright specs, run in a real browser at the viewport sizes they set.",
        "- **Negative case:** a cited test whose name says what must not happen.",
        "- **Gaps:** a ticked task missing one of the three kinds. Open and needs-a-person tasks "
        "are listed for completeness and have no gaps column entry.",
        "",
        f"**Totals:** {len(table)} tasks; {len(ticked)} ticked, of which {len(whole)} have all "
        f"three kinds of coverage and {len(ticked) - len(whole)} have a gap.",
        "",
        "| Task | Status | State | Browser | Negative case | Gaps |",
        "|---|---|---|---|---|---|",
    ]
    for row in table:
        negative = "; ".join(f'"{name}"' for name in row["negative"][:2]) or "-"
        lines.append(
            f"| {row['task']} | {row['status']} | {_cell(row['state'])} | "
            f"{_cell(row['browser'])} | {negative.replace('|', '/')} | "
            f"{', '.join(row['gaps']) or '-'} |"
        )
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    if "--write" in sys.argv:
        MATRIX.write_text(markdown(), encoding="utf-8", newline="\n")
        print(f"Wrote {MATRIX.relative_to(ROOT)}")
    else:
        sys.stdout.write(markdown())
