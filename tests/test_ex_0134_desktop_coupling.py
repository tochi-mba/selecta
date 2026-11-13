"""EX-0134-02: no new desktop-only assumption creeps into the web app.

Words that only make sense on the listener's own Windows PC ("this PC", File Explorer, a C:\\
path, a localhost address) belong in the mode-keyed copy layer `web/src/copy.ts` (SC-0392-04),
so the Cloud runtime can say something true instead. This ratchet fails when such a phrase
appears in any other page or module, or when a recorded local-only surface gains more of them.
The recorded ones are local-mode folder setup and a local ffmpeg diagnosis, which the Cloud
runtime (web/src/cloud/) never shows; the Cloud tree itself must have none. A design review of
proposed UX is still a person's step and is not claimed here."""

import re
from collections import Counter
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web/src"
PHRASE = re.compile(
    r"this PC|File Explorer|this computer|Windows Explorer|C:\\\\|C:\\U|127\.0\.0\.1|localhost:",
)
COMMENT = re.compile(r"^\s*(//|\*|/\*)")
# 2026-11-12 baseline: local-only surfaces, each phrase counted once per line
BASELINE = {
    "state/selfService.ts": 1,  # ffmpeg missing on the local machine
    "views/Start.tsx": 2,  # local first-run folder setup
    "views/WorkshopPanels.tsx": 2,  # local folder sources
    "views/LucySettings.tsx": 1,  # a local model server's address, offered as a placeholder
}


def scan() -> Counter:
    hits: Counter = Counter()
    for path in WEB.rglob("*.ts*"):
        name = path.relative_to(WEB).as_posix()
        if ".test." in name or name == "copy.ts" or "__snapshots__" in name:
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if not COMMENT.match(line) and PHRASE.search(line):
                hits[name] += 1
    return hits


def test_no_new_desktop_only_phrase_outside_the_copy_layer():
    hits = scan()
    new = {name: count for name, count in hits.items() if count > BASELINE.get(name, 0)}
    assert not new, f"desktop-only wording outside web/src/copy.ts: {new}"


def test_the_cloud_runtime_has_no_desktop_only_wording():
    assert not [name for name in scan() if name.startswith("cloud/")]


def test_the_baseline_only_lists_files_that_still_need_it():
    hits = scan()
    assert all(hits.get(name, 0) > 0 for name in BASELINE), "shrink BASELINE to match the code"
