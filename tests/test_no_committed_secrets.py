"""No real credential is ever committed.

GitHub's secret scanning and push protection guard the repository while it's public; on a
private repository they're a paid add-on. This check runs in CI either way: it reads every
tracked file and fails on anything shaped like a live credential from the services Selecta uses.
Test values are deliberately short or obviously fake (`sk_test_SECRETSTRIPE`), so they never
match; a real key never belongs in the repository, test mode or not.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 2_000_000

PATTERNS = {
    "AWS or R2-style access key id": re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    "Stripe secret or restricted key": re.compile(r"\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{24,}"),
    "Stripe or WorkOS webhook secret": re.compile(r"\bwhsec_[0-9A-Za-z+/=]{24,}"),
    "GitHub token": re.compile(r"\b(?:gh[pousr]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{40,})"),
    "Anthropic API key": re.compile(r"\bsk-ant-[0-9A-Za-z_-]{20,}"),
    "OpenAI API key": re.compile(r"\bsk-(?:proj-|svcacct-)?[0-9A-Za-z_-]{40,}"),
    "Slack token": re.compile(r"\bxox[abprs]-[0-9A-Za-z-]{10,}"),
    "Google API key": re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    "Private key block": re.compile(r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?-----"),
    "Signed JSON Web Token": re.compile(
        r"\beyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{20,}"
    ),
}
# Published documentation examples, used as test vectors (AWS's SigV4 examples). Exact values
# only: anything else shaped like a key still fails.
DOCUMENTED_EXAMPLES = ("AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")


def _tracked_files() -> list[Path]:
    listed = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True
    ).stdout.split(b"\0")
    return [ROOT / name.decode("utf-8") for name in listed if name]


def _text(path: Path) -> str | None:
    try:
        if path.stat().st_size > MAX_BYTES:
            return None
        data = path.read_bytes()
    except OSError:  # listed but deleted in this working tree
        return None
    if b"\0" in data:  # binary: audio, images, model weights
        return None
    return data.decode("utf-8", errors="replace")


def find_secrets(text: str) -> list[str]:
    for example in DOCUMENTED_EXAMPLES:
        text = text.replace(example, "")
    return [name for name, pattern in PATTERNS.items() if pattern.search(text)]


def test_no_tracked_file_holds_a_live_credential():
    found = {}
    for path in _tracked_files():
        text = _text(path)
        if text is None:
            continue
        hits = find_secrets(text)
        if hits:
            found[path.relative_to(ROOT).as_posix()] = hits
    assert found == {}, "remove these and rotate them: a committed secret is a leaked secret"


def test_the_patterns_catch_real_shapes_and_spare_test_values():
    # Samples are split in the source so this file passes its own check.
    fake_but_real_shaped = {
        "AKIA" + "Q" * 16: "AWS or R2-style access key id",
        "sk_live_" + "a1" * 12: "Stripe secret or restricted key",
        "whsec_" + "b2" * 16: "Stripe or WorkOS webhook secret",
        "ghp_" + "c3" * 18: "GitHub token",
        "sk-ant-api03-" + "d4" * 20: "Anthropic API key",
        "-----BEGIN RSA " + "PRIVATE KEY-----": "Private key block",
        "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9." + "e5" * 12: "Signed JSON Web Token",
    }
    for text, name in fake_but_real_shaped.items():
        assert name in find_secrets(text), text
    assert find_secrets("AKIAIOSFODNN7EXAMPLE") == []
    assert find_secrets("AKIAIOSFODNN7" + "EXAMPLF") == ["AWS or R2-style access key id"]
    for harmless in ("sk_test_SECRETSTRIPE", "signed-token", "AKIDEXAMPLE", "whsec_test"):
        assert find_secrets(harmless) == [], harmless
