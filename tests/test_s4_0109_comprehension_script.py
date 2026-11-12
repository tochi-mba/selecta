"""S4-0109-10: the blind-study comprehension script only quotes words the study page still shows.

The script itself, docs/verification/listening-comprehension-script.md, is run by a researcher. This
keeps it honest: every double-quoted wording in its task table and questions must be in the page's
source, and the protocol acceptance table holds no row a person did not sign.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "docs" / "verification" / "listening-comprehension-script.md"
PAGE = ROOT / "web" / "src" / "views" / "Listening.tsx"
# wordings the page builds from a number; the source holds them with the expression in place
BUILT = {"Comparison 1 of": "Comparison {index + 1} of"}


def _quoted(section: str) -> list[str]:
    return re.findall(r'"([^"]+)"', section)


def test_every_quoted_wording_is_on_the_study_page() -> None:
    text = SCRIPT.read_text(encoding="utf-8")
    body = text.split("## Observed tasks", 1)[1].split("## Protocol acceptance", 1)[0]
    source = PAGE.read_text(encoding="utf-8")
    quoted = _quoted(body)
    assert len(quoted) >= 10
    missing = [words for words in quoted if BUILT.get(words, words) not in source]
    assert missing == []


def test_the_acceptance_table_has_no_unsigned_rows() -> None:
    text = SCRIPT.read_text(encoding="utf-8")
    table = text.split("## Protocol acceptance (researcher)", 1)[1]
    rows = [line for line in table.splitlines() if line.startswith("|")][2:]
    for row in rows:
        cells = [cell.strip() for cell in row.strip("|").split("|")]
        assert re.fullmatch(r"20\d\d-\d\d-\d\d", cells[0]), row
        assert cells[1] and re.fullmatch(r"[0-9a-f]{7,40}", cells[2]), row


def test_the_script_names_the_skip_and_stop_wording_behind_its_flag() -> None:
    text = SCRIPT.read_text(encoding="utf-8")
    flags = (ROOT / "src" / "selecta" / "flags" / "learning.json").read_text(encoding="utf-8")
    for words in ("Skip this comparison", "Stop for now"):
        assert words in text and words in flags
    assert "only with the skip flag on" in text
