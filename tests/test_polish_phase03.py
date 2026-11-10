"""Polish phase 03 (ADR-0037): the first-run folder answers and what leaves the PC for lyrics.

P0045: an address that can't be a folder, a folder that isn't there, an empty folder and a folder
with no supported music each get their own answer. P0049: lyric lookup sends only artist, title,
album and duration, and it starts from adding a folder and from new songs found in an added folder,
never when lyric lookup is turned off.
"""

from __future__ import annotations

import time

import httpx
import pytest
from fastapi.testclient import TestClient

from selecta import db
from selecta.api import create_app
from selecta.config import Settings
from selecta.library.folder_check import check_folder
from selecta.lyrics.lrclib import LrcLib


@pytest.fixture
def conn(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    connection = db.connect(Settings(home).db_path)
    yield connection
    connection.close()


def test_a_relative_or_malformed_address_is_invalid_not_missing(conn):
    for typed in ("Music", r"Music\Albums", "C:\\Music<1>", "D:\\what?"):
        assert check_folder(conn, typed)["kind"] == "invalid", typed


def test_an_empty_folder_is_told_apart_from_one_with_no_music(conn, tmp_path):
    empty = tmp_path / "empty"
    (empty / "inside").mkdir(parents=True)
    assert check_folder(conn, str(empty))["kind"] == "empty"
    other = tmp_path / "documents"
    other.mkdir()
    (other / "notes.txt").write_text("not music", encoding="utf-8")
    assert check_folder(conn, str(other))["kind"] == "no_audio"
    music = tmp_path / "music"
    music.mkdir()
    (music / "song.opus").write_bytes(b"x")
    answer = check_folder(conn, str(music))
    assert answer["kind"] == "ok" and answer["audio_files"] == 1


def test_lyric_lookup_sends_only_artist_title_album_and_duration():
    sent: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={"syncedLyrics": "[00:01.00]Hi"})

    api = LrcLib(httpx.Client(transport=httpx.MockTransport(answer)))
    api.lookup("Artist", "Title", "Album", 201.4)
    assert len(sent) == 1
    assert set(sent[0].url.params) == {"artist_name", "track_name", "album_name", "duration"}
    assert sent[0].method == "GET" and not sent[0].content


def _lookups_after_scan(tmp_path, monkeypatch, lyrics_on: bool) -> list:
    import selecta.routes.library as library_routes

    runs: list = []
    monkeypatch.setattr(library_routes.subprocess, "run", lambda args, **_: runs.append(args))
    real_on = library_routes.flags.on
    monkeypatch.setattr(
        library_routes.flags,
        "on",
        lambda flag: lyrics_on if flag == "lyrics.lookup" else real_on(flag),
    )
    music = tmp_path / "music"
    music.mkdir()
    client = TestClient(create_app(Settings(tmp_path / "home"), tmp_path / "no-web"))
    assert client.post("/api/scan", json={"folder": str(music)}).status_code == 200
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if client.get("/api/status").json()["scan"].get("status") != "running" and (
            runs or not lyrics_on
        ):
            break
        time.sleep(0.05)
    time.sleep(0.2)
    return [args for args in runs if "lyrics" in args]


def test_adding_a_folder_starts_lyric_lookup(tmp_path, monkeypatch):
    assert _lookups_after_scan(tmp_path, monkeypatch, lyrics_on=True)


def test_nothing_is_looked_up_when_lyric_lookup_is_off(tmp_path, monkeypatch):
    assert _lookups_after_scan(tmp_path, monkeypatch, lyrics_on=False) == []
