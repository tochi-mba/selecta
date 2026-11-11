"""T0255: a tempo/key correction made while background analysis finishes and the library watch
brings in new files keeps the person's correction, keeps what analysis measured beside it, and
lets the new songs arrive without touching either."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import selecta.library.scan as scan
from selecta import db
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.seams import SeamStore


def _song(conn, folder, song_id, title, analysed=True):
    path = folder / f"{song_id}.flac"
    path.write_bytes(b"x")
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,?,?,?,?,?,?,1)",
        (song_id, str(path), str(folder), 1, 1.0, 200.0, "Someone", title),
    )
    if analysed:
        conn.execute(
            "INSERT INTO analysis(song_id,version,bpm,camelot) VALUES(?,?,?,?)",
            (song_id, ANALYSIS_VERSION, 100.0 + song_id, "8A"),
        )


@pytest.fixture
def setup(tmp_path, monkeypatch):
    settings = Settings(tmp_path / "home")
    settings.home.mkdir()
    music = tmp_path / "music"
    music.mkdir()
    conn = db.connect(settings.db_path)
    for song_id in (1, 2, 3):
        _song(conn, music, song_id, f"Song {song_id}")
    _song(conn, music, 4, "Still analysing", analysed=False)
    conn.commit()
    monkeypatch.setattr(
        SeamStore, "submit", lambda self, request, **_k: {"status": "queued", "key": request.key}
    )
    client = TestClient(create_app(settings, tmp_path / "no-web"))
    yield client, conn, music
    conn.close()


def _row(client, title):
    page = client.get("/api/library", params={"q": title, "state": "all"}).json()
    return next(song for song in page["songs"] if song["title"] == title)


def test_a_correction_survives_analysis_finishing_and_new_files_arriving(setup, monkeypatch):
    client, conn, music = setup
    corrected = client.post("/api/songs/4/correct", json={"bpm": 174.0, "camelot": "5B"})
    assert corrected.status_code == 200

    # background analysis finishes for that very song, after the correction
    db.save_analysis(conn, 4, {"version": ANALYSIS_VERSION, "bpm": 87.0, "camelot": "5A"})

    # the folder watch finds two new files in the same moment
    def found_new(connection, folder, careful=False):
        _song(connection, folder, 5, "New arrival one", analysed=False)
        _song(connection, folder, 6, "New arrival two", analysed=False)
        connection.commit()

    monkeypatch.setattr(scan, "library_folders", lambda _conn: [music])
    monkeypatch.setattr(scan, "folder_changed", lambda _conn, _folder: True)
    monkeypatch.setattr(scan, "scan_folder", found_new)
    started: list[bool] = []
    monkeypatch.setattr("threading.Thread.start", lambda self: started.append(True))
    assert client.post("/api/library/check").json() == {"new": 2}
    assert started  # lyrics and analysis for the new songs are handed to the background

    song = _row(client, "Still analysing")
    assert (song["bpm"], song["camelot"]) == (174.0, "5B")
    assert (song["detected_bpm"], song["detected_camelot"]) == (87.0, "5A")
    assert (song["override_bpm"], song["override_camelot"]) == (174.0, "5B")
    for title in ("New arrival one", "New arrival two"):
        arrived = _row(client, title)
        assert arrived["override_bpm"] is None
    # nobody else's numbers moved
    assert (_row(client, "Song 1")["bpm"], _row(client, "Song 1")["override_bpm"]) == (101.0, None)


def test_a_correction_made_after_the_new_files_arrive_lands_on_the_right_song(setup, monkeypatch):
    client, conn, music = setup

    def found_new(connection, folder, careful=False):
        _song(connection, folder, 5, "Song 1 (live)", analysed=False)
        connection.commit()

    monkeypatch.setattr(scan, "library_folders", lambda _conn: [music])
    monkeypatch.setattr(scan, "folder_changed", lambda _conn, _folder: True)
    monkeypatch.setattr(scan, "scan_folder", found_new)
    monkeypatch.setattr("threading.Thread.start", lambda self: None)
    assert client.post("/api/library/check").json() == {"new": 1}
    client.post("/api/songs/1/correct", json={"bpm": 150.0}).raise_for_status()
    db.save_analysis(conn, 5, {"version": ANALYSIS_VERSION, "bpm": 120.0, "camelot": "1A"})
    assert _row(client, "Song 1")["bpm"] == 150.0
    live = _row(client, "Song 1 (live)")
    assert (live["bpm"], live["override_bpm"]) == (120.0, None)
