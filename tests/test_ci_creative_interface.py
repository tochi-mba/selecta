"""CI-0178-02: the first-run folder check answers every reason a folder can't be used, reads
nothing into the library, and leaves the folder free to be tried again."""

from __future__ import annotations

import os

from selecta import db
from selecta.config import Settings
from selecta.library.folder_check import check_folder


def _songs(conn) -> int:
    return conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0]


def test_every_unusable_folder_has_its_own_reason_and_nothing_is_read(tmp_path, monkeypatch):
    settings = Settings(tmp_path)
    music = tmp_path / "music"
    music.mkdir()
    (music / "song.flac").write_bytes(b"never decoded by the check")
    conn = db.connect(settings.db_path)
    try:
        assert check_folder(conn, "")["kind"] == "missing"
        assert check_folder(conn, str(tmp_path / "not-there"))["kind"] == "missing"
        assert check_folder(conn, str(music / "song.flac"))["kind"] == "not_a_folder"

        real_scandir = os.scandir

        def refused(path, *args, **kwargs):
            if str(path) == str(music.resolve()):
                raise PermissionError("no access")
            return real_scandir(path, *args, **kwargs)

        monkeypatch.setattr(os, "scandir", refused)
        answer = check_folder(conn, str(music))
        assert answer["kind"] == "no_access"
        assert answer["ok"] is False
        monkeypatch.setattr(os, "scandir", real_scandir)

        # once the cause is fixed the same folder is simply fine, with nothing read in the meantime
        answer = check_folder(conn, f'  "{music}"  ')
        assert answer["kind"] == "ok"
        assert answer["audio_files"] == 1
        assert _songs(conn) == 0
    finally:
        conn.close()


# CI-0165-01 and CI-0184-01: the source baseline names real files for every core journey, and its
# crosswalk lists every CI task once with the same disposition as the checklist.
ROOT = __import__("pathlib").Path(__file__).resolve().parents[1]
BASELINE = ROOT / "docs/adr/selecta-creative-interface-source-baseline.md"
CHECKLIST = ROOT / "docs/adr/selecta-creative-interface-implementation-checklist.md"


def _table_rows(text: str, header: str) -> list[list[str]]:
    lines = text.split(header, 1)[1].splitlines()
    rows = []
    for line in lines[1:]:
        if not line.startswith("|"):
            if rows:
                break
            continue
        if set(line.replace("|", "").strip()) <= {"-"}:
            continue
        rows.append([cell.strip() for cell in line.strip("|").split("|")])
    return rows


def test_source_baseline_names_real_files_for_every_core_journey():
    text = BASELINE.read_text(encoding="utf-8")
    rows = _table_rows(text, "| Journey |")
    assert len(rows) >= 12
    for journey, route, action, data, conflicts, owner, files in rows:
        assert all([journey, route, action, data, conflicts, owner, files]), journey
        for name in files.split(";"):
            assert (ROOT / name.strip()).is_file(), f"{journey}: {name.strip()} is missing"


def test_crosswalk_lists_every_ci_task_once_and_matches_the_checklist():
    import re

    checklist = CHECKLIST.read_text(encoding="utf-8")
    ticked = set(re.findall(r"^- \[x\] \*\*(CI-\d{4}-\d{2})", checklist, re.M))
    every = set(re.findall(r"^- \[[ x]\] \*\*(CI-\d{4}-\d{2})", checklist, re.M))
    assert len(every) == 140
    rows = _table_rows(BASELINE.read_text(encoding="utf-8"), "| CI task |")
    listed = [row[0] for row in rows]
    assert sorted(listed) == sorted(every)
    assert len(listed) == len(set(listed))
    for task, disposition, _note in rows:
        assert disposition in {"existing", "built", "open", "person"}, task
        assert (task in ticked) == (disposition in {"existing", "built"}), task


# CI-0182-01: every animation the stylesheets run has a data owner, states and an interruption rule.
MATRIX = ROOT / "docs/adr/selecta-creative-interface-interaction-matrix.md"


def test_every_keyframe_animation_has_an_owner_states_and_interruption_rule():
    import re

    rows = _table_rows(MATRIX.read_text(encoding="utf-8"), "| Animation | Source | Data owner |")
    named = {}
    for animation, source, owner, states, interruption in rows:
        assert len(owner) > 15 and len(states) > 3 and len(interruption) > 20, animation
        path = source.strip("`")
        assert (ROOT / path).is_file(), f"{animation}: {path} is missing"
        named[animation.strip("`")] = path
    sheets = [*(ROOT / "web/src").glob("*.css"), *(ROOT / "web/src/styles").glob("*.css")]
    keyframes = {name for sheet in sheets for name in re.findall(r"@keyframes\s+([\w-]+)", sheet.read_text(encoding="utf-8"))}
    assert len(keyframes) >= 10
    assert keyframes - set(named) == set(), "keyframes with no owner row"
    for clock_mark in ("Hand-over progress width", "Spectrum canvas", "Lyric focus"):
        assert clock_mark in named


# CI-0177-04: Start a mix from a song puts that exact song first, once, in the set it returns, so the
# source track is identifiable; the site then plays from position 0 and names it.
def test_start_a_mix_returns_a_set_that_opens_on_the_chosen_song(tmp_path):
    from mix_helpers import _vibe_library

    from selecta.planner.vibes import BY_KEY, build_vibe, eligible

    songs, traits = _vibe_library(tmp_path)
    vibe = BY_KEY["pick"]
    fits = eligible(vibe, songs, traits)
    for chosen in (fits[0], fits[len(fits) // 2], fits[-1]):
        planned, _ = build_vibe(vibe, songs, traits, {}, 8, chosen.id, seed=3)
        ids = [item.song.id for item in planned]
        assert ids[0] == chosen.id
        assert ids.count(chosen.id) == 1
