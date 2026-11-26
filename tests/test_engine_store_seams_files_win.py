"""With `core.engine_store` on, a seam file the table hasn't caught up with still counts.

While the flag is proved the files are the truth (docs/engineering/engine-store-seams.md). A seam
file can appear or change behind the store's back on a real Desktop: another process, a mirror
write that failed, a restore of the library file, a person copying a render folder. Readiness
and the memory must then answer what the files say, not what the table last held. Temporary
home and two tiny generated clips only.
"""

from __future__ import annotations

import json
import os
import time

import numpy as np
import pytest
import soundfile as sf

from selecta import db, flags, seam_mirror
from selecta.config import SAMPLE_RATE, Settings
from selecta.engine_store import library
from selecta.engine_store import seams as stored
from selecta.planner.memory import RULES_VERSION
from selecta.seam_kinds import SeamRequest
from selecta.seam_records import forget_all

FLAG_ON = "+core.engine_store"


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_HOME", str(tmp_path / "home"))
    settings = Settings(tmp_path / "home")
    settings.home.mkdir(parents=True)
    forget_all()
    flags.use(FLAG_ON)
    conn = db.connect(settings.db_path)
    for song_id in range(1, 5):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration) VALUES(?,?,?,?,?,?)",
            (song_id, f"/music/{song_id}.flac", "/music", 1, 1.0, 200.0),
        )
    conn.commit()
    conn.close()
    yield settings
    flags.use(None)
    library.forget(settings.db_path)


def _record(request: SeamRequest, **extra) -> dict:
    return {
        "status": "ready",
        "key": request.key,
        "request": {"a": request.a, "b": request.b, "move": request.move},
        "style": "bass_swap_blend",
        "rules": RULES_VERSION,
        "passed": True,
        "a_source_start": 100.0,
        "b_source_end": 12.0,
        "duration": 1.0,
        **extra,
    }


def _files(folder, state) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    audio = np.full((SAMPLE_RATE, 2), 0.1, dtype=np.float32)
    sf.write(folder / "clip.flac", audio, SAMPLE_RATE)
    (folder / "seam.json").write_text(json.dumps(state), "utf-8")


def _ready_keys(seams) -> set[str]:
    from selecta.planner.ready import ready_inventory

    songs = {n: type("Song", (), {"id": n, "duration": 200.0})() for n in range(1, 5)}
    edges, _counts = ready_inventory(seams, songs)
    return {edge.key for found in edges.values() for edge in found}


def test_a_ready_file_with_no_row_is_ready_and_a_newer_file_wins(home):
    from selecta.seams import SeamStore

    seams = SeamStore(home)
    kept = SeamRequest(1, 2, move="bass_swap_blend")
    _files(seams.folder(kept.key), _record(kept))
    seams._remember(_record(kept))  # through the store, as a render does
    assert stored.record_of(library.store_for(home.db_path), kept.key) is not None

    behind = SeamRequest(2, 3, move="bass_swap_blend")
    _files(seams.folder(behind.key), _record(behind))  # no row: another process wrote it
    assert _ready_keys(seams) == {kept.key, behind.key}

    # the person rated the kept seam Bad and the mirror write was lost: the file is newer
    meta = seams.folder(kept.key) / "seam.json"
    meta.write_text(json.dumps(_record(kept, rating="bad", rated_at=1.0)), "utf-8")
    later = time.time() + 5
    os.utime(meta, (later, later))
    assert _ready_keys(seams) == {behind.key}

    remembered = {state["key"]: state for state in seam_mirror.states(home)}
    assert remembered[kept.key].get("rating") == "bad"
    assert behind.key in remembered


def test_a_history_file_with_no_row_reaches_the_memory(home):
    history = home.home / "seam-history"
    history.mkdir(parents=True)
    request = SeamRequest(3, 4, move="bass_swap_blend")
    state = _record(request, rating="good", rated_at=2.0)
    (history / f"{request.key}.json").write_text(json.dumps(state), "utf-8")
    assert [s["key"] for s in seam_mirror.states(home)] == [request.key]


def test_flag_off_reads_no_table(home):
    flags.use("")
    assert seam_mirror.states(home) is None and seam_mirror.ready(home) is None
