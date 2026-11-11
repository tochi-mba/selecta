"""GP-0252-03 and -04: a moved-folder preview says what refers to the songs it moves, and a
recording
whose details changed moves only after a person says, for that exact song, that it is the same
one."""

from __future__ import annotations

import pytest
from test_folder_relink import _library, _song

from selecta import mix
from selecta.library.relink import RelinkError, commit_relink, preview_relink


def test_the_preview_counts_what_refers_to_the_songs_it_would_move(tmp_path):
    conn, old, new = _library(tmp_path)
    mix.add_song(conn, 7)
    conn.execute("INSERT INTO song_overrides(song_id,bpm) VALUES(9,128.0)")
    conn.commit()
    references = preview_relink(conn, str(old), str(new))["references"]
    assert references == {
        "current_mix": 1,
        "drafts": 1,
        "ratings": 1,
        "corrections": 1,
        "discoveries": 0,
    }


def test_a_changed_recording_says_what_differs_and_waits_for_a_person(tmp_path):
    conn, old, new = _library(tmp_path)
    _song(new / "a.flac", "A cover version")
    preview = preview_relink(conn, str(old), str(new))
    seven = {c["id"]: c for c in preview["candidates"]}[7]
    assert seven["status"] == "identity_not_verified"
    assert seven["can_confirm"] is True
    assert "A cover version" in seven["why"]
    assert preview["needs_confirmation"] == 1
    assert preview["token"] is None


def test_saying_it_is_the_same_recording_lets_it_move_with_its_id(tmp_path):
    conn, old, new = _library(tmp_path)
    _song(new / "a.flac", "A cover version")
    preview = preview_relink(conn, str(old), str(new), confirmed=[7])
    assert {c["id"]: c["status"] for c in preview["candidates"]}[7] == "confirmed_by_you"
    assert preview["confirmed"] == 1
    assert preview["token"]
    commit_relink(conn, str(old), str(new), preview["token"], confirmed=[7])
    assert conn.execute("SELECT path FROM songs WHERE id=7").fetchone()[0].endswith("a.flac")
    assert [tuple(row) for row in conn.execute("SELECT song_a,song_b FROM ratings")] == [(7, 9)]


def test_a_yes_for_one_song_is_not_a_yes_for_another(tmp_path):
    conn, old, new = _library(tmp_path)
    _song(new / "a.flac", "A cover version")
    _song(new / "Album" / "b.flac", "Another cover", artist="Other")
    preview = preview_relink(conn, str(old), str(new), confirmed=[7])
    assert {c["id"]: c["status"] for c in preview["candidates"]}[9] == "identity_not_verified"
    assert preview["token"] is None


def test_a_token_for_one_set_of_answers_cannot_commit_another(tmp_path):
    conn, old, new = _library(tmp_path)
    _song(new / "a.flac", "A cover version")
    token = preview_relink(conn, str(old), str(new), confirmed=[7])["token"]
    with pytest.raises(RelinkError):
        commit_relink(conn, str(old), str(new), token, confirmed=[])
    assert conn.execute("SELECT path FROM songs WHERE id=7").fetchone()[0].startswith(str(old))


def test_a_missing_file_can_never_be_confirmed_through(tmp_path):
    conn, old, new = _library(tmp_path)
    (new / "Album" / "b.flac").unlink()
    preview = preview_relink(conn, str(old), str(new), confirmed=[9])
    nine = {c["id"]: c for c in preview["candidates"]}[9]
    assert nine["status"] == "not_found_or_unsafe"
    assert "can_confirm" not in nine
    assert preview["token"] is None
