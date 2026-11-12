"""The per-task study cards for ADR-0223 to ADR-0247 are complete and stay preparation only.

Each card names its route on the made-up library, the words read to the participant, what done
means and a hesitation rule; the shared fields carry the consent line, participant codes, timing
and confidence. A pilot line says it is preparation, never a result.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = ROOT / "docs" / "research" / "flow-research-protocol.md"

CARDS = (
    "SF-0223-08", "SF-0224-02", "SF-0224-08", "SF-0225-04", "SF-0225-08", "SF-0226-08",
    "SF-0228-01", "SF-0228-03", "SF-0228-06", "SF-0229-01", "SF-0229-07", "SF-0229-08",
    "SF-0230-01", "SF-0230-08", "SF-0232-08", "SF-0237-08", "SF-0242-04", "SF-0242-08",
    "SF-0243-08", "SF-0244-02", "SF-0244-08", "SF-0246-03", "SF-0246-05", "SF-0246-07",
)


def _section() -> str:
    text = PROTOCOL.read_text(encoding="utf-8")
    start = text.index("## Per-task study cards, ADR-0223 to ADR-0247")
    rest = text[start + 3:]
    end = rest.find("\n## ")
    return text[start:] if end == -1 else text[start:start + 3 + end]


def _card(section: str, task: str) -> str:
    start = section.index(f"**{task} ")
    following = re.search(r"\n(\*\*SF-\d{4}-\d{2} |### )", section[start + 5:])
    return section[start:] if following is None else section[start:start + 5 + following.start()]


def test_every_card_has_a_route_words_done_rule_and_a_pilot_that_is_not_a_result() -> None:
    section = _section()
    for task in CARDS:
        adr = task[3:7]
        assert f"### ADR-{adr}" in section, adr
        card = _card(section, task)
        for field in ("Route:", "Card:", "Done means:", "Hesitation:", "Pilot"):
            assert field in card, (task, field)
        assert "e2e_server.py" in card or "made-up library" in card or "real music" in card, task


def test_the_shared_fields_cover_consent_codes_timing_and_confidence() -> None:
    section = _section()
    for words in (
        "Consent line",
        "Participant codes",
        "Timing",
        "Confidence",
        "preparation",
        "never a participant result",
    ):
        assert words in section, words
    assert chr(0x2014) not in section


def test_no_card_records_a_finding_or_names_a_participant() -> None:
    section = _section().lower()
    for claim in ("participants found", "users found", "% of participants", "verified: yes"):
        assert claim not in section, claim
