"""S4-0096-02: what someone types as a music folder is read the way they meant it.

Quotes pasted from File Explorer's "Copy as path", spaces, non-Latin names and a file given
instead of its folder all get a specific answer, and a path that can't be used comes back
exactly as typed so the box can keep it.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from selecta import db
from selecta.api import create_app
from selecta.config import Settings
from selecta.library.folder_check import check_folder


@pytest.fixture
def conn(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    connection = db.connect(Settings(home).db_path)
    yield connection
    connection.close()


def test_a_quoted_path_with_spaces_is_the_folder_inside_the_quotes(conn, tmp_path):
    music = tmp_path / "My Music Folder"
    music.mkdir()
    (music / "one.flac").write_bytes(b"x")
    answer = check_folder(conn, f'  "{music}"  ')
    assert answer["ok"] is True
    assert answer["audio_files"] == 1


def test_a_non_latin_folder_name_is_read_as_typed(conn, tmp_path):
    music = tmp_path / "音楽 موسيقى"
    music.mkdir()
    (music / "song.mp3").write_bytes(b"x")
    assert check_folder(conn, str(music))["kind"] == "ok"


def test_a_file_is_told_apart_from_a_folder(conn, tmp_path):
    song = tmp_path / "song.flac"
    song.write_bytes(b"x")
    answer = check_folder(conn, str(song))
    assert answer["kind"] == "not_a_folder"
    assert "file, not a folder" in answer["reason"]


@pytest.mark.parametrize("typed", ["", "   ", '""'])
def test_nothing_typed_asks_for_a_folder(conn, typed):
    answer = check_folder(conn, typed)
    assert answer["ok"] is False
    assert answer["kind"] == "missing"


def test_a_missing_folder_hands_back_what_was_typed(conn, tmp_path):
    typed = str(tmp_path / "Not Here" / "Albums")
    answer = check_folder(conn, f'"{typed}"')
    assert answer["kind"] == "missing"
    assert answer["path"] == typed
    assert "plug it in" in answer["reason"]


@pytest.mark.parametrize(
    "typed", ["relative/music", "../music", "\\\\server\\share\\music", "//server/share/music"]
)
def test_relative_traversal_and_network_addresses_are_not_scanned(conn, typed):
    answer = check_folder(conn, typed)
    assert answer["kind"] == "invalid"
    assert answer["ok"] is False


def test_absolute_traversal_does_not_escape_the_user_selected_folder(conn, tmp_path):
    music = tmp_path / "Music"
    music.mkdir()
    (music / "song.mp3").write_bytes(b"x")
    answer = check_folder(conn, str(music / ".." / "Music"))
    assert answer["kind"] == "invalid"


@pytest.mark.parametrize(
    "headers",
    [
        {"origin": "https://malicious.example"},
        {"sec-fetch-site": "cross-site"},
        {"sec-fetch-site": "same-site"},
        {"host": "malicious.example"},
    ],
)
def test_a_webpage_from_elsewhere_cannot_inspect_local_folders(tmp_path, headers):
    music = tmp_path / "Private music"
    music.mkdir()
    (music / "recording.flac").write_bytes(b"some audio")
    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
    response = client.get("/api/folders/check", params={"path": str(music)}, headers=headers)
    assert response.status_code == 403


def test_the_local_browser_can_explicitly_preview_a_folder(tmp_path):
    music = tmp_path / "Selected music"
    music.mkdir()
    (music / "recording.flac").write_bytes(b"some audio")
    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
    response = client.get("/api/folders/check", params={"path": str(music)})
    assert response.status_code == 200
    assert response.json()["kind"] == "ok"
    assert response.json()["audio_files"] == 1


@pytest.mark.parametrize(
    "typed",
    [
        "/tmp/music\\nprivate",
        "/tmp/music\\rprivate",
        "/tmp/music\\tprivate",
        "/tmp/music\\x00private",
        "/tmp/" + "a" * 32768,
    ],
)
def test_control_characters_and_oversized_paths_are_rejected(conn, typed):
    answer = check_folder(conn, typed)
    assert answer["kind"] == "invalid"
    assert answer["ok"] is False
