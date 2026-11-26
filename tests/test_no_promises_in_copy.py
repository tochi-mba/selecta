"""The owner's rule, for the server's words: nothing SelectaDJ says is "not yet".

Every string the server can say (string constants in src/selecta, docstrings aside, and every
text in the flag registry's JSON, `about` included) is checked for a promise about the product:
"not yet", "coming soon", "soon" (other than "as soon as" and "too soon"), and a refusal that
ends in "yet" ("isn't available here yet"). The web side has the same rule in
web/src/copyAudit.test.ts. A state ("No mixes yet") is a fact and is not matched.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "src" / "selecta"

# Internal tools whose words reach no member: evidence reports, the study kit and a simulator.
NOT_MEMBER_FACING = ("audit/", "scheduling/simulator.py")

PROMISES = [
    ("not yet", re.compile(r"\bnot yet\b", re.I)),
    ("coming soon", re.compile(r"\bcoming soon\b", re.I)),
    ("soon", re.compile(r"\bsoon\b(?<!\bas soon)(?<!\btoo soon)", re.I)),
    (
        'a refusal that waits on "yet"',
        re.compile(
            r"\b(can't|cannot|isn't|aren't|doesn't|don't|not)\b[^.?!]*\b(browser|available|"
            r"supported|on sale|published|switched on|open|set up|offered|here|do (this|that))"
            r"\b[^.?!]*\byet\b",
            re.I,
        ),
    ),
]

# Sentences where the word is not a promise about the product, each with its reason.
NOT_A_PROMISE = {
    ("admin/guard.py", "SelectaDJ is read-only for a short while. Try again soon."):
        "advice to retry after a short maintenance window, not a feature",
    ("business/billing_routes.py", "Stripe can't be reached. Try again soon."):
        "advice to retry while a payment provider is unreachable",
    ("business/rooms/requests.py", "Lots of requests are waiting. Try again soon."):
        "advice to retry while a room is busy",
    ("business/alerts.py", "soon"): "a licence's end date is close: a fact about the venue",
    ("business/billing_emails.py", "soon"): "a renewal date is close: a fact about the bill",
    ("venueops/health.py", "A licence the night depends on expires soon."):
        "a licence's end date is close: a fact about the venue",
}


def _strings(path: Path) -> list[str]:
    if path.suffix == ".json":
        found: list[str] = []

        def walk(value: object) -> None:
            if isinstance(value, str):
                found.append(value)
            elif isinstance(value, dict):
                for inner in value.values():
                    walk(inner)
            elif isinstance(value, list):
                for inner in value:
                    walk(inner)

        walk(json.loads(path.read_text(encoding="utf-8")))
        return found
    tree = ast.parse(path.read_text(encoding="utf-8"))
    docs = set()
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        scoped = (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
        if isinstance(node, scoped) and body:
            first = body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant):
                docs.add(id(first.value))
    return [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docs
    ]


def promises(name: str, strings: list[str]) -> list[str]:
    out = []
    for text in strings:
        plain = " ".join(text.replace("’", "'").split())
        said = next((label for label, rule in PROMISES if rule.search(plain)), None)
        if said and (name, plain) not in NOT_A_PROMISE:
            out.append(f'{name}: "{plain[:100]}" says {said}')
    return out


def _files() -> list[tuple[str, Path]]:
    files = []
    for path in sorted(SOURCE.rglob("*")):
        if path.suffix not in {".py", ".json"} or "__pycache__" in path.parts:
            continue
        name = path.relative_to(SOURCE).as_posix()
        if not name.startswith(NOT_MEMBER_FACING):
            files.append((name, path))
    return files


def test_the_scan_reads_the_server_and_the_flag_registry():
    names = {name for name, _ in _files()}
    assert "flags/cloud.json" in names
    assert "cloud_brain/facts_routes.py" in names
    assert len(names) > 200


def test_a_planted_promise_is_caught_and_a_fact_is_not():
    assert promises("x.py", ["Lyrics are coming soon."])
    assert promises("x.py", ["This isn't available in your browser yet."])
    assert promises("x.py", ["Not yet"])
    assert not promises("x.py", ["No mixes yet. Make one."])
    assert not promises("x.py", ["This song has not played yet tonight."])
    assert not promises("x.py", ["It plays as soon as it is here."])


def test_every_allowed_sentence_is_still_said():
    for (name, sentence), reason in NOT_A_PROMISE.items():
        assert reason
        said = [" ".join(text.split()) for text in _strings(SOURCE / name)]
        assert sentence in said, f"{name}: {sentence}"


def test_nothing_the_server_says_promises_a_feature_later():
    found = [line for name, path in _files() for line in promises(name, _strings(path))]
    assert found == [], "\n".join(found)
