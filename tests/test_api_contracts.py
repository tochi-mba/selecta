"""What Selecta 2.0's pages rely on the server for, alongside the older routes."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from starlette.applications import Starlette
from starlette.routing import Mount

from selecta import db, mix
from selecta.analysis.song import _at_corrected_tempo
from selecta.api import FreshFiles, create_app
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.planner import reel
from selecta.seams import SeamStore


def _add(
    conn, song_id, title=None, artist="Someone", music=1, lyrics="synced", analysed=True, path=None
):
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,?,?,?,?,?,?,?)",
        (
            song_id,
            path or _a_real_file(song_id),
            "f",
            1,
            1.0,
            200.0,
            artist,
            title or f"Song {song_id:03d}",
            music,
        ),
    )
    if analysed:
        conn.execute(
            "INSERT INTO analysis(song_id,version,bpm,camelot) VALUES(?,?,?,?)",
            (song_id, ANALYSIS_VERSION, 100.0 + song_id, "8A"),
        )
    if lyrics:
        conn.execute("INSERT INTO lyrics(song_id,status) VALUES(?,?)", (song_id, lyrics))


_files: dict[str, Path] = {}


def _a_real_file(song_id):
    made = _files["folder"] / f"{song_id}.flac"
    made.write_bytes(b"x")
    return str(made)


@pytest.fixture(autouse=True)
def _somewhere_for_files(tmp_path):
    _files["folder"] = tmp_path


@pytest.fixture
def settings(tmp_path):
    return Settings(tmp_path)


@pytest.fixture
def conn(settings):
    connection = db.connect(settings.db_path)
    yield connection
    connection.close()


@pytest.fixture
def client(settings, conn, tmp_path, monkeypatch):
    for song_id in range(1, 8):
        _add(conn, song_id)
    conn.commit()

    def load_song(_conn, _settings, song_id):
        return SimpleNamespace(
            id=song_id,
            artist="Someone",
            title=f"Song {song_id}",
            vocals_known=True,
            bpm=120.0,
            camelot="8A",
            duration=200.0,
            bar_times=np.array([0.0, 2.0]),
            beats=np.array([0.0, 0.5, 1.0, 1.5, 2.0]),
            beats_per_bar=4,
            sections=[],
            lines=[],
        )

    monkeypatch.setattr("selecta.analysis.song.load_song", load_song)
    monkeypatch.setattr(
        "selecta.analysis.pipeline.load_features",
        lambda _settings, _song_id, _features=None: {
            "peaks": np.array([0, 128, 255], dtype=np.uint8)
        },
    )
    monkeypatch.setattr("selecta.planner.reel.load_library", lambda _conn, _settings: [])
    monkeypatch.setattr(
        SeamStore, "submit", lambda self, request, **_k: {"status": "queued", "key": request.key}
    )
    return TestClient(create_app(settings, tmp_path / "no-web"))


def _titles(page):
    return [song["title"] for song in page["songs"]]


# ---- the library, a page at a time


def test_a_page_says_how_many_there_are_and_where_to_carry_on(client):
    page = client.get("/api/library", params={"limit": 3, "state": "all"}).json()
    assert page["total"] == 7
    assert _titles(page) == ["Song 001", "Song 002", "Song 003"]
    assert page["next"]


def test_carrying_on_gets_the_rest_with_nothing_repeated_or_skipped(client):
    seen = []
    after = None
    for _ in range(5):
        params = {"limit": 3, "state": "all"}
        if after:
            params["after"] = after
        page = client.get("/api/library", params=params).json()
        seen += _titles(page)
        after = page["next"]
        if not after:
            break
    assert seen == [f"Song {number:03d}" for number in range(1, 8)]


def test_a_song_arriving_mid_way_can_not_make_a_page_repeat_or_skip(client, conn):
    first = client.get("/api/library", params={"limit": 3, "state": "all"}).json()
    _add(conn, 50, title="Aaa new")
    conn.commit()
    second = client.get(
        "/api/library", params={"limit": 3, "state": "all", "after": first["next"]}
    ).json()
    assert _titles(second) == ["Song 004", "Song 005", "Song 006"]
    assert second["total"] == 8


@pytest.mark.parametrize("sort", ["title", "artist", "tempo", "recent"])
def test_every_sort_pages_without_repeats(client, sort):
    seen = []
    after = None
    while True:
        params = {"limit": 2, "state": "all", "sort": sort}
        if after:
            params["after"] = after
        page = client.get("/api/library", params=params).json()
        seen += [song["id"] for song in page["songs"]]
        after = page["next"]
        if not after:
            break
    assert sorted(seen) == list(range(1, 8))
    assert len(seen) == len(set(seen))


def test_an_unknown_sort_falls_back_rather_than_reaching_the_database(client):
    page = client.get("/api/library", params={"sort": "title; DROP TABLE songs", "state": "all"})
    assert page.status_code == 200
    assert client.get("/api/library", params={"state": "all"}).json()["total"] == 7


def test_a_bad_page_marker_says_so(client):
    assert client.get("/api/library", params={"after": "{nope"}).status_code == 400


@pytest.mark.parametrize(
    ("after", "sort", "q"),
    [
        ("null", "title", ""),
        ("{}", "title", ""),
        ("[1]", "title", ""),
        ("[1,2,3]", "title", ""),
        ('["first",false]', "title", ""),
        ('["first",0]', "title", ""),
        ('[12,1]', "title", ""),
        ('["first",1]', "tempo", ""),
        ('["first",1]', "title", "Song"),
        ('[true,1]', "recent", ""),
        ('[NaN,1]', "tempo", ""),
        ('[0,1]', "artist", ""),
        ("[" + "a" * 1100 + "]", "title", ""),
    ],
)
def test_library_cursor_refuses_bad_shapes_and_sort_types(client, after, sort, q):
    answer = client.get(
        "/api/library", params={"state": "all", "sort": sort, "q": q, "after": after}
    )
    assert answer.status_code == 400
    assert answer.json()["detail"] == "That page marker isn't valid."

def test_a_page_is_never_enormous(client, conn):
    for song_id in range(100, 400):
        _add(conn, song_id)
    conn.commit()
    assert (
        len(client.get("/api/library", params={"limit": 100000, "state": "all"}).json()["songs"])
        == 200
    )


def test_search_finds_songs_beyond_the_first_page(client, conn):
    for song_id in range(100, 400):
        _add(conn, song_id)
    _add(conn, 900, title="Zzz findable")
    conn.commit()
    assert _titles(client.get("/api/library", params={"q": "findable", "state": "all"}).json()) == [
        "Zzz findable"
    ]


def test_ready_means_what_the_planner_means(client, conn):
    _add(conn, 20, title="Instrumental", lyrics="instrumental")
    _add(conn, 21, title="Unlyriced", lyrics="missing")
    _add(conn, 22, title="Unanalysed", analysed=False)
    conn.commit()
    ready = _titles(client.get("/api/library", params={"state": "ready", "limit": 100}).json())
    assert "Instrumental" in ready
    assert "Unlyriced" not in ready
    assert "Unanalysed" not in ready


def test_needs_attention_finds_what_can_not_be_mixed(client, conn):
    _add(conn, 21, title="Unlyriced", lyrics="missing")
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(30,?,?,1,1.0,200.0,'A','Broken',1)",
        (_a_real_file(30), "f"),
    )
    conn.execute(
        "INSERT INTO analysis(song_id,version,error) VALUES(30,?,'bad file')", (ANALYSIS_VERSION,)
    )
    conn.commit()
    assert set(_titles(client.get("/api/library", params={"state": "attention"}).json())) == {
        "Unlyriced",
        "Broken",
    }


@pytest.mark.parametrize(
    ("kwargs", "status"),
    [
        ({}, "mix_ready"),
        ({"lyrics": "instrumental"}, "mix_ready"),
        ({"lyrics": "missing"}, "analysed_incomplete"),
        ({"lyrics": None}, "analysed_incomplete"),
        ({"analysed": False, "lyrics": None}, "queued"),
        ({"music": 0}, "set_aside"),
        ({"path": "C:/not/there.flac"}, "missing"),
    ],
)
def test_each_song_says_whether_it_can_go_in_a_mix(client, conn, kwargs, status):
    _add(conn, 40, title="The one", **kwargs)
    conn.commit()
    state = "set_aside" if kwargs.get("music") == 0 else "all"
    found = client.get("/api/library", params={"q": "The one", "state": state}).json()["songs"][0]
    assert found["readiness"]["status"] == status


def test_a_song_set_to_never_play_says_so(client):
    client.post("/api/songs/1/never")
    found = client.get("/api/library", params={"q": "Song 001", "state": "all"}).json()["songs"][0]
    assert found["readiness"]["status"] == "excluded"


def test_the_older_list_still_answers_as_it_did(client):
    assert isinstance(client.get("/api/songs", params={"state": "all"}).json(), list)


# ---- corrections


def test_a_correction_leaves_what_was_measured_alone(client, conn):
    client.post("/api/songs/1/correct", json={"bpm": 202.0, "camelot": "9B"})
    song = client.get("/api/library", params={"q": "Song 001", "state": "all"}).json()["songs"][0]
    assert (song["bpm"], song["camelot"]) == (202.0, "9B")
    assert (song["detected_bpm"], song["detected_camelot"]) == (101.0, "8A")
    assert (song["override_bpm"], song["override_camelot"]) == (202.0, "9B")


def test_every_song_list_shows_a_correction(client):
    client.post("/api/songs/1/correct", json={"bpm": 202.0, "camelot": "9B"})
    found = next(
        s for s in client.get("/api/songs", params={"state": "all"}).json() if s["id"] == 1
    )
    assert (found["bpm"], found["camelot"]) == (202.0, "9B")


def test_it_can_be_put_back(client):
    client.post("/api/songs/1/correct", json={"bpm": 202.0, "camelot": "9B"})
    client.post("/api/songs/1/correct", json={"clear": ["bpm", "camelot"]})
    song = client.get("/api/library", params={"q": "Song 001", "state": "all"}).json()["songs"][0]
    assert (song["bpm"], song["camelot"]) == (101.0, "8A")
    assert song["override_bpm"] is None


def test_one_part_can_be_changed_without_losing_the_other(client):
    client.post("/api/songs/1/correct", json={"bpm": 202.0})
    client.post("/api/songs/1/correct", json={"camelot": "9B"})
    song = client.get("/api/library", params={"q": "Song 001", "state": "all"}).json()["songs"][0]
    assert (song["override_bpm"], song["override_camelot"]) == (202.0, "9B")


def test_analysing_the_song_again_can_not_lose_it(client, conn):
    client.post("/api/songs/1/correct", json={"bpm": 202.0})
    conn.execute("DELETE FROM analysis WHERE song_id=1")
    conn.execute(
        "INSERT INTO analysis(song_id,version,bpm,camelot) VALUES(1,?,99.0,'1A')",
        (ANALYSIS_VERSION,),
    )
    conn.commit()
    song = client.get("/api/library", params={"q": "Song 001", "state": "all"}).json()["songs"][0]
    assert song["bpm"] == 202.0
    assert song["detected_bpm"] == 99.0


@pytest.mark.parametrize(
    "body",
    [
        {"bpm": 900},
        {"bpm": 5},
        {"camelot": "13A"},
        {"camelot": "8C"},
        {"camelot": "<script>"},
        {"clear": ["title"]},
    ],
)
def test_nonsense_is_refused_and_nothing_changes(client, body):
    assert client.post("/api/songs/1/correct", json=body).status_code == 400
    song = client.get("/api/library", params={"q": "Song 001", "state": "all"}).json()["songs"][0]
    assert song["override_bpm"] is None


def test_a_song_that_is_not_there_says_so(client):
    assert client.post("/api/songs/999/correct", json={"bpm": 120}).status_code == 404


def test_setting_aside_is_reversible_and_touches_no_file(client, conn):
    client.post("/api/songs/1/correct", json={"is_music": False})
    assert Path(conn.execute("SELECT path FROM songs WHERE id=1").fetchone()[0]).exists()
    row = conn.execute("SELECT is_music,music_override FROM songs WHERE id=1").fetchone()
    assert (row[0], row[1]) == (0, 0)
    client.post("/api/songs/1/correct", json={"is_music": True})
    row = conn.execute("SELECT is_music,music_override FROM songs WHERE id=1").fetchone()
    assert (row[0], row[1]) == (1, 1)


def test_only_transitions_with_that_song_are_made_again(client, settings):
    store = SeamStore(settings)
    for a, b, key in ((1, 2, "touches"), (3, 4, "doesnt")):
        folder = store.folder(key)
        folder.mkdir(parents=True)
        (folder / "seam.json").write_text(
            json.dumps({"status": "ready", "key": key, "request": {"a": a, "b": b}}), "utf-8"
        )
        (folder / "clip.flac").write_bytes(b"x")
    answer = client.post("/api/songs/1/correct", json={"bpm": 202.0}).json()
    assert answer["redone"] == 1
    assert not (store.folder("touches") / "seam.json").exists()
    assert (store.folder("doesnt") / "clip.flac").exists()


def test_correcting_nothing_about_the_sound_makes_nothing_again(client, settings):
    store = SeamStore(settings)
    folder = store.folder("touches")
    folder.mkdir(parents=True)
    (folder / "seam.json").write_text(
        json.dumps({"status": "ready", "key": "touches", "request": {"a": 1, "b": 2}}), "utf-8"
    )
    assert client.post("/api/songs/1/correct", json={"is_music": True}).json()["redone"] == 0
    assert (folder / "seam.json").exists()


def _features(beats=9, per_bar=4):
    times = np.arange(beats, dtype=float)
    bars = np.arange(0, beats, per_bar)
    return {
        "beats": times,
        "bar_starts": bars,
        "energy_bars": np.arange(bars.size, dtype=float),
        "chroma_bars": np.ones((bars.size, 12)),
    }


def test_double_time_means_twice_the_beats_and_bars_that_still_line_up():
    features = _features()
    changed, sections = _at_corrected_tempo(features, [{"start_bar": 0, "end_bar": 2}], 80.0, 160.0)
    assert changed["beats"].size == features["beats"].size * 2 - 1
    assert changed["beats"][1] == 0.5
    assert changed["energy_bars"].shape[0] == changed["bar_starts"].size
    assert changed["chroma_bars"].shape == (changed["bar_starts"].size, 12)
    assert sections[0]["end_bar"] > 2


def test_half_time_means_half_the_beats_and_every_bar_still_exists():
    features = _features(beats=17)
    changed, sections = _at_corrected_tempo(features, [{"start_bar": 0, "end_bar": 4}], 160.0, 80.0)
    assert changed["beats"].size == 9
    assert changed["bar_starts"].max() < changed["beats"].size
    assert changed["energy_bars"].shape[0] == changed["bar_starts"].size
    assert sections[0]["end_bar"] == 2


def test_any_other_correction_only_changes_what_the_tempo_is_called():
    features = _features()
    changed, sections = _at_corrected_tempo(
        features, [{"start_bar": 0, "end_bar": 2}], 100.0, 103.0
    )
    assert changed is features
    assert sections == [{"start_bar": 0, "end_bar": 2}]


def test_the_library_is_read_again_when_a_correction_changes(settings, conn, monkeypatch):
    _add(conn, 1)
    conn.commit()
    loads = []

    def load_song(_conn, _settings, song_id):
        loads.append(song_id)
        return SimpleNamespace(id=song_id, vocals_known=True, instrumental=False)

    monkeypatch.setattr(reel, "load_song", load_song)
    reel.load_library(conn, settings)
    reel.load_library(conn, settings)
    assert loads == [1]
    conn.execute("INSERT INTO song_overrides(song_id,bpm) VALUES(1,200.0)")
    conn.commit()
    reel.load_library(conn, settings)
    assert loads == [1, 1]


# ---- a pair goes in as one


def _order(client, draft=None):
    params = {"draft": draft} if draft else {}
    return [item["song_id"] for item in client.get("/api/mix", params=params).json()["mix"]]


def _fill(conn, *songs, draft=None):
    for song in songs:
        mix.add_song(conn, song, None, draft)


def test_a_pair_goes_in_together_with_the_transition_between_them(client):
    answer = client.post(
        "/api/mix/pair", json={"a": 4, "b": 5, "move": "echo_out", "phrase": "night"}
    )
    assert answer.status_code == 200
    assert _order(client) == [4, 5]
    assert answer.json()["mix"][1]["seam"]["settings"] == {"move": "echo_out", "phrase": "night"}


def test_if_one_is_there_already_the_other_goes_next_to_it(client, conn):
    _fill(conn, 1, 2, 3)
    client.post("/api/mix/pair", json={"a": 2, "b": 5})
    assert _order(client) == [1, 2, 5, 3]


def test_or_before_it_if_that_is_the_second_of_them(client, conn):
    _fill(conn, 1, 2, 3)
    client.post("/api/mix/pair", json={"a": 5, "b": 2})
    assert _order(client) == [1, 5, 2, 3]


def test_a_pair_already_there_changes_nothing(client, conn):
    _fill(conn, 1, 2)
    assert client.post("/api/mix/pair", json={"a": 1, "b": 2}).status_code == 409
    assert _order(client) == [1, 2]


def test_a_song_can_not_be_paired_with_itself(client):
    assert client.post("/api/mix/pair", json={"a": 1, "b": 1}).status_code == 409
    assert _order(client) == []


def test_a_song_that_has_gone_means_neither_goes_in(client):
    assert client.post("/api/mix/pair", json={"a": 1, "b": 999}).status_code == 409
    assert _order(client) == []


def test_a_pair_can_go_in_a_draft_and_leaves_the_current_mix_alone(client, conn):
    _fill(conn, 1)
    draft = client.post("/api/drafts", json={}).json()["id"]
    client.post(f"/api/mix/pair?draft={draft}", json={"a": 4, "b": 5})
    assert _order(client) == [1]
    assert _order(client, draft) == [4, 5]


def test_one_undo_takes_the_whole_pair_out(client):
    client.post("/api/mix/pair", json={"a": 4, "b": 5})
    client.post("/api/mix/undo")
    assert _order(client) == []


# ---- changes made against an out of date view


def test_a_change_to_the_mix_it_saw_goes_through(client, conn):
    _fill(conn, 1, 2)
    answer = client.post("/api/mix/1/lock", headers={"x-mix-order": "1,2"})
    assert answer.status_code == 200


def test_a_change_to_a_mix_that_has_moved_on_stops(client, conn):
    _fill(conn, 1, 2, 3)
    refused = client.delete("/api/mix/songs/1", headers={"x-mix-order": "2,1,3"})
    assert refused.status_code == 409
    assert refused.json()["code"] == "mix_changed"
    assert _order(client) == [1, 2, 3]


def test_a_draft_is_checked_against_itself_not_the_current_mix(client, conn):
    _fill(conn, 1, 2)
    draft = client.post("/api/drafts", json={}).json()["id"]
    _fill(conn, 4, 5, draft=draft)
    good = client.post(f"/api/mix/1/lock?draft={draft}", headers={"x-mix-order": "4,5"})
    assert good.status_code == 200
    stale = client.post(f"/api/mix/1/lock?draft={draft}", headers={"x-mix-order": "1,2"})
    assert stale.status_code == 409


def test_older_pages_that_do_not_say_still_work(client, conn):
    _fill(conn, 1, 2)
    assert client.post("/api/mix/1/lock").status_code == 200


# ---- the same thing sent twice


def test_the_same_operation_sent_twice_only_happens_once(client):
    headers = {"x-operation-id": "one"}
    first = client.post("/api/drafts", json={"name": "Friday"}, headers=headers).json()
    second = client.post("/api/drafts", json={"name": "Friday"}, headers=headers).json()
    assert first == second
    assert len(client.get("/api/drafts").json()["drafts"]) == 1


def test_guarded_replay_returns_original_response_after_its_own_mix_change(client, conn):
    """The first guarded operation changed the order; its retry must not get a stale 409."""
    _fill(conn, 1, 2)
    headers = {"x-mix-order": "1,2", "x-operation-id": "guarded-add-retry"}
    body = {"song_id": 3, "position": 0}

    first = client.post("/api/mix/songs", json=body, headers=headers)
    assert first.status_code == 200
    assert _order(client) == [3, 1, 2]

    repeated = client.post("/api/mix/songs", json=body, headers=headers)
    assert repeated.status_code == 200
    assert repeated.json() == first.json()
    assert _order(client) == [3, 1, 2], "the same song must not be inserted twice"

    stale_new_operation = client.post(
        "/api/mix/songs",
        json=body,
        headers={"x-mix-order": "1,2", "x-operation-id": "different-add"},
    )
    assert stale_new_operation.status_code == 409
    assert stale_new_operation.json()["code"] == "mix_changed"
    assert _order(client) == [3, 1, 2]


def test_slow_build_never_replaces_a_mix_changed_during_planning(client, conn, monkeypatch):
    """A stale-build guard must be checked after the expensive planner returns."""
    from selecta.planner import vibes

    _fill(conn, 1, 2)
    database_path = conn.execute("PRAGMA database_list").fetchone()[2]
    monkeypatch.setattr(vibes, "eligible", lambda *_args: [object()] * vibes.MIN_SONGS)

    def planner(*_args, **_kwargs):
        # Emulate another tab editing while the generation work is under way.
        with sqlite3.connect(database_path) as other_tab:
            mix.write_order(other_tab, [(3, None, 0), (1, None, 0)])
        return [SimpleNamespace(song=SimpleNamespace(id=2))], {}

    monkeypatch.setattr(vibes, "build_vibe", planner)
    refused = client.post(
        "/api/vibes/pick/build?count=12",
        headers={"x-mix-order": "1,2", "x-operation-id": "late-vibe"},
    )
    assert refused.status_code == 409
    assert refused.json()["code"] == "mix_changed"
    assert _order(client) == [3, 1]


def test_sent_twice_at_the_same_moment_it_still_only_happens_once(client):
    async def both():
        transport = httpx.ASGITransport(app=client.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1") as browser:
            sends = [
                browser.post(
                    "/api/drafts", json={"name": "Friday"}, headers={"x-operation-id": "one"}
                )
                for _ in range(2)
            ]
            return await asyncio.gather(*sends)

    first, second = asyncio.run(both())
    assert first.json() == second.json()
    assert len(client.get("/api/drafts").json()["drafts"]) == 1


def test_different_operations_each_happen(client):
    first = client.post(
        "/api/drafts", json={"name": "Friday"}, headers={"x-operation-id": "one"}
    ).json()
    second = client.post(
        "/api/drafts", json={"name": "Friday"}, headers={"x-operation-id": "two"}
    ).json()
    assert first["id"] != second["id"]


def test_without_an_id_nothing_is_remembered(client):
    named = {"name": "Friday"}
    assert (
        client.post("/api/drafts", json=named).json()["id"]
        != client.post("/api/drafts", json=named).json()["id"]
    )


def test_a_refusal_is_remembered_too_rather_than_being_tried_again(client):
    # The retry is the identical request: since f609504 the same id with a different body is a
    # conflict (tests/test_operation_identity.py), not a replay.
    headers = {"x-operation-id": "bad"}
    first = client.post("/api/songs/1/correct", json={"bpm": 900}, headers=headers)
    again = client.post("/api/songs/1/correct", json={"bpm": 900}, headers=headers)
    assert first.status_code == again.status_code == 400
    assert again.json() == first.json()
    seen = client.get("/api/diagnostics").json()["recent_operations"]
    assert [item["repeat"] for item in seen if item["kind"] == "bad"] == [False, True]


# ---- what's going on


def test_jobs_say_what_is_really_there(client, conn):
    _fill(conn, 1, 2, 3)
    jobs = client.get("/api/jobs").json()
    assert jobs["mix"]["none"] == 2
    assert jobs["drafts_in_line"] == 0
    assert jobs["analysis"]["left"] == 0
    assert "estimates" in jobs["estimates"]


def test_jobs_name_what_failed_but_not_where_it_lives(client, conn):
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(30,'C:/secret/file.flac','f',1,1.0,200.0,'A','Broken',1)"
    )
    conn.execute(
        "INSERT INTO analysis(song_id,version,error) VALUES(30,?,'C:/secret/file.flac is bad')",
        (ANALYSIS_VERSION,),
    )
    conn.commit()
    text = client.get("/api/jobs").text
    assert "Broken" in text
    assert "secret" not in text


def test_diagnostics_have_no_paths_or_song_names(client, conn, settings):
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(31,'C:/secret/x.flac','f',1,1.0,200.0,'Private Artist','Private Title',1)"
    )
    conn.commit()
    text = client.get("/api/diagnostics").text
    for private in ("secret", "Private", str(settings.home), "\\\\Users"):
        assert private not in text
    assert client.get("/api/diagnostics").json()["api_version"] == 2


def test_status_says_what_this_server_can_do(client):
    api = client.get("/api/status").json()["api"]
    assert api["version"] == 2
    assert "library_pages" in api["features"]


def test_folders_say_whether_they_can_be_found(client, conn, tmp_path):
    db.set_preference(conn, "library_folders", [str(tmp_path), "Z:/gone"])
    conn.commit()
    found = {
        folder["path"]: folder["available"]
        for folder in client.get("/api/folders").json()["folders"]
    }
    assert found == {str(tmp_path): True, str(Path("Z:/gone")): False}


def test_stopping_watching_touches_nothing_else(client, conn, tmp_path):
    db.set_preference(conn, "library_folders", [str(tmp_path), "Z:/gone"])
    conn.commit()
    before = client.get("/api/library", params={"state": "all"}).json()["total"]
    answer = client.post("/api/folders/stop-watching", json={"folder": "Z:/gone"}).json()
    assert [folder["path"] for folder in answer["folders"]] == [str(tmp_path)]
    assert client.get("/api/library", params={"state": "all"}).json()["total"] == before


def test_stopping_watching_leaves_every_music_file_byte_for_byte(client, conn, tmp_path):
    """S4-0106-09: a filesystem snapshot before and after shows Stop watching deletes nothing."""
    music = tmp_path / "Music"
    (music / "Album").mkdir(parents=True)
    files = {"one.flac": b"fLaC-one", "Album/two.mp3": b"ID3-two", "cover.jpg": b"jpg"}
    for name, data in files.items():
        (music / name).write_bytes(data)

    def snapshot():
        return {
            path.relative_to(music).as_posix(): (path.read_bytes(), path.stat().st_mtime_ns)
            for path in sorted(music.rglob("*"))
            if path.is_file()
        }

    db.set_preference(conn, "library_folders", [str(music)])
    conn.commit()
    before = snapshot()
    answer = client.post("/api/folders/stop-watching", json={"folder": str(music)}).json()
    assert str(music) not in [folder["path"] for folder in answer["folders"]]
    assert snapshot() == before
    assert sorted(path.name for path in music.iterdir()) == ["Album", "cover.jpg", "one.flac"]


# ---- real addresses


@pytest.fixture
def site(tmp_path):
    (tmp_path / "index.html").write_text("the app", "utf-8")
    (tmp_path / "real.js").write_text("code", "utf-8")
    return TestClient(Starlette(routes=[Mount("/", FreshFiles(directory=tmp_path, html=True))]))


@pytest.mark.parametrize(
    "address",
    [
        "listen",
        "mixes",
        "mixes/mine",
        "mix/current/edit",
        "mixes/drafts/7/edit",
        "library",
        "discover/harmonic",
        "workshop/storage",
        "listening",
    ],
)
def test_reloading_any_page_gets_the_app(site, address):
    answer = site.get(f"/{address}")
    assert answer.status_code == 200
    assert answer.text == "the app"


@pytest.mark.parametrize(
    "address", ["nope", "api/nope", "listen.js", "assets/app.js", "library/x.y"]
)
def test_anything_else_is_really_not_found(site, address):
    assert site.get(f"/{address}").status_code == 404


def test_real_files_are_still_served_and_always_checked(site):
    answer = site.get("/real.js")
    assert answer.text == "code"
    assert answer.headers["cache-control"] == "no-cache"


def test_an_api_route_that_does_not_exist_is_not_the_app(settings, tmp_path, monkeypatch):
    (tmp_path / "web").mkdir()
    (tmp_path / "web/index.html").write_text("the app", "utf-8")
    client = TestClient(create_app(settings, tmp_path / "web"))
    assert client.get("/api/nope").status_code == 404
    assert client.get("/listen").text == "the app"


# ---- still local only


@pytest.mark.parametrize(
    ("method", "address"),
    [
        ("get", "/api/library"),
        ("get", "/api/jobs"),
        ("get", "/api/diagnostics"),
        ("get", "/api/folders"),
        ("post", "/api/songs/1/correct"),
        ("post", "/api/mix/pair"),
    ],
)
def test_other_hosts_get_nothing(client, method, address):
    answer = client.request(method, address, headers={"host": "evil.example"}, json={})
    assert answer.status_code == 403


@pytest.mark.parametrize(
    "address", ["/api/songs/1/correct", "/api/mix/pair", "/api/folders/stop-watching"]
)
def test_other_sites_can_not_change_anything(client, address):
    assert (
        client.post(address, headers={"origin": "https://evil.example"}, json={}).status_code == 403
    )


# ---- analysis carries on by itself


def test_a_pause_is_remembered_across_a_restart(client, conn, monkeypatch):
    monkeypatch.setattr(
        "subprocess.Popen",
        lambda *_a, **_k: SimpleNamespace(poll=lambda: None, terminate=lambda: None),
    )
    client.post("/api/analysis/stop")
    assert db.preference(conn, "analysis_paused", False) is True
    client.post("/api/analysis/start")
    assert db.preference(conn, "analysis_paused", False) is False
