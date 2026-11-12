"""Does a pull request describe a small, reversible slice? (EX-0114-05)

    python -m selecta.audit.pr_slice_gate body.md          # a saved PR description
    gh pr view 55 --json body -q .body | python -m selecta.audit.pr_slice_gate -

Every implementing PR must name an owner, say how it was verified and say how to roll it back
(.github/pull_request_template.md has the lines). This reads a PR description and lists what is
missing or left as the template's placeholder. It checks the description only: whether the owner
then accepts the release is the owner's decision, recorded by a person.

Read-only; no network.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# each field: its label in the template, and what it is for
FIELDS = {
    "Owner": "who owns this slice and answers for it",
    "Verification": "the tests or checks that prove it, run on the tested SHA",
    "Rollback": "how to undo it: the flag to turn off, or the commit to revert",
}
COMMENT = re.compile(r"<!--.*?-->", re.S)


def field_value(body: str, label: str) -> str:
    """The text after `**Label:**` on its line, with template comments removed."""
    clean = COMMENT.sub("", body)
    match = re.search(rf"^\s*-?\s*\*\*{label}:\*\*(.*)$", clean, re.M)
    return match.group(1).strip() if match else ""


def missing(body: str) -> list[str]:
    """Each required field that is absent, empty or a bare dash."""
    problems = []
    for label, purpose in FIELDS.items():
        value = field_value(body, label)
        if value in ("", "-", "TBD", "tbd"):
            problems.append(f"{label}: {purpose}")
    return problems


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1:
        print(__doc__)
        return 2
    body = sys.stdin.read() if args[0] == "-" else Path(args[0]).read_text(encoding="utf-8")
    problems = missing(body)
    for problem in problems:
        print(f"missing {problem}")
    if not problems:
        print("slice gate: owner, verification and rollback are named")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
