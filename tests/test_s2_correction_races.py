"""T0217: a correction holds while the analysis worker writes and after its source moves."""

from __future__ import annotations

import threading

from fastapi.testclient import TestClient
from test_folder_relink import _library

from selecta import db
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.library.relink import commit_relink, preview_relink


def _song(client, song_id):
    page = client.get("/api/library", params={"state": "all", "limit": 50}).json()
    return next(song for song in page["songs"] if song["id"] == song_id)


def test_corrections_and_a_racing_reanalysis_both_land_in_their_own_place(tmp_path):
    settings = Settings(tmp_path)
    with db.connect(settings.db_path) as conn:
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(1,'a.flac','f',1,1.0,200.0,'Someone','Race',1)"
        )
        db.save_analysis(conn, 1, {"version": ANALYSIS_VERSION, "bpm": 120.0, "camelot": "8A"})
        conn.commit()
    client = TestClient(create_app(settings, tmp_path / "no-web"))
    problems: list[BaseException] = []

    def worker():
        try:
            with db.connect(settings.db_path) as conn:
                for step in range(40):
                    db.save_analysis(
                        conn, 1, {"version": ANALYSIS_VERSION, "bpm": 100.0 + step, "camelot": "4A"}
                    )
                    conn.commit()
        except BaseException as problem:  # noqa: BLE001 - reported below
            problems.append(problem)

    racing = threading.Thread(target=worker)
    racing.start()
    for step in range(40):
        bpm = 60.0 + step
        answer = client.post("/api/songs/1/correct", json={"bpm": bpm, "camelot": "9B"})
        assert answer.status_code < 300, answer.text
    racing.join(30)
    assert not racing.is_alive() and problems == []

    song = _song(client, 1)
    assert (song["override_bpm"], song["override_camelot"]) == (99.0, "9B")
    assert (song["bpm"], song["camelot"]) == (99.0, "9B")
    assert (song["detected_bpm"], song["detected_camelot"]) == (139.0, "4A")


def test_a_correction_follows_its_recording_when_the_folder_moves(tmp_path):
    conn, old, new = _library(tmp_path)
    db.save_analysis(conn, 7, {"version": ANALYSIS_VERSION, "bpm": 61.0, "camelot": "8A"})
    conn.commit()
    settings = Settings(tmp_path)
    client = TestClient(create_app(settings, tmp_path / "no-web"))
    assert client.post("/api/songs/7/correct", json={"bpm": 122.0}).status_code < 300
    assert _song(client, 7)["readiness"]["status"] == "missing"

    preview = preview_relink(conn, str(old), str(new))
    commit_relink(conn, str(old), str(new), preview["token"])
    conn.close()
    moved = _song(client, 7)
    assert moved["readiness"]["status"] != "missing"
    assert (moved["bpm"], moved["override_bpm"], moved["detected_bpm"]) == (122.0, 122.0, 61.0)
