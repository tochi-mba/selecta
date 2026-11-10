"""EX-0124-01: every request stage the server can report has its own words on the Requests page.

The backend sets `stage` in the request planner and the requests route; the page maps each one to a
label and an explanation in `requestWords`. A stage added on one side and not the other would show a
blank or wrong state, so the two lists are compared directly.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = [ROOT / "src/selecta/request_planner.py", ROOT / "src/selecta/routes/song_requests.py"]
PAGE = ROOT / "web/src/views/Requests.tsx"


def backend_stages() -> set[str]:
    found: set[str] = set()
    for path in BACKEND:
        for line in path.read_text(encoding="utf-8").splitlines():
            if '["stage"] =' in line:
                found.update(re.findall(r'"([a-z_]+)"', line.split("=", 1)[1]))
    return found - {"analysis", "waiting_on"}


def page_union() -> set[str]:
    text = PAGE.read_text(encoding="utf-8")
    union = re.search(r"type Stage =(.*?);", text, re.S)
    assert union, "Stage union not found in Requests.tsx"
    return set(re.findall(r"'([a-z_]+)'", union.group(1)))


def page_cases() -> set[str]:
    text = PAGE.read_text(encoding="utf-8")
    body = text.split("export function requestWords", 1)[1].split("\nexport ", 1)[0]
    return set(re.findall(r"case '([a-z_]+)':", body))


def test_the_server_reports_only_stages_the_page_knows():
    stages = backend_stages()
    assert {"unavailable", "in_mix", "never", "analysing", "no_cues", "no_mix", "searching",
            "approve", "preparing", "ready"} <= stages
    assert stages <= page_union()


def test_every_stage_the_page_knows_has_its_own_words():
    assert page_union() == page_cases()
