"""r8d: backend speed outside the Library and mixes routes.

Query plans prove the new indexes are used, counters prove repeated work is no longer repeated, and
the conditional-GET tests prove rendered audio is revalidated rather than downloaded again. Wall
clock numbers live in the report: on a shared laptop they are too noisy to assert on.
"""

from __future__ import annotations

import asyncio
import json
import os

import numpy as np
import pytest
from fastapi.testclient import TestClient

from selecta import db, stems
from selecta.analysis import pipeline
from selecta.analysis.pipeline import features_path, load_features
from selecta.analysis.song import SONG_ARRAYS, load_song
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.lyrics.lrclib import Line
from selecta.routes.files import _matches

# ---- the fixture: a few songs, analysed, with lyrics, links and ratings


def _library(settings: Settings, songs: int = 6, links: int = 400):
    settings.ensure_dirs()
    conn = db.connect(settings.db_path)
    bars = 32
    beats = np.arange(bars * 4) * 0.5
    for n in range(songs):
        song_id = conn.execute(
            "INSERT INTO songs(path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,?,?,?,?,?,1)",
            (f"/music/{n}.flac", "/music", 1, 1.0, 64.0, f"Artist {n}", f"Title {n}"),
        ).lastrowid
        np.savez_compressed(
            features_path(settings, song_id),
            beats=beats,
            bar_starts=np.arange(0, beats.size, 4).astype(np.int32),
            raw_beats=beats.astype(np.float32),
            raw_downbeats=beats[::4].astype(np.float32),
            chroma_bars=np.zeros((bars, 12), np.float16),
            mfcc_bars=np.zeros((bars, 20), np.float16),
            energy_bars=np.full(bars, 0.5, np.float16),
            rms_db_bars=np.full(bars, -14.0, np.float16),
            low_share_bars=np.full(bars, 0.3, np.float16),
            peaks=np.zeros(2000, np.uint8),
        )
        db.save_analysis(
            conn,
            song_id,
            {
                "version": ANALYSIS_VERSION,
                "bpm": 120.0,
                "constant_tempo": 1,
                "grid_confidence": 0.9,
                "beats_per_bar": 4,
                "key": "A minor",
                "camelot": "8A",
                "key_confidence": 0.9,
                "key_agrees_chroma": 1,
                "lufs": -14.0,
                "peak_db": -2.0,
                "energy": 0.5,
                "sections": [
                    {
                        "start_bar": 0,
                        "end_bar": bars,
                        "label": "verse",
                        "energy": 0.5,
                        "group": 0,
                        "chorus_prob": 0.2,
                    }
                ],
                "timbre": [0.0] * 26,
                "timings": {},
            },
        )
        conn.execute("INSERT INTO lyrics(song_id,status) VALUES(?,?)", (song_id, "instrumental"))
    for i in range(links):
        conn.execute(
            "INSERT INTO seam_book(song_a,song_b,kind,payload,score) VALUES(?,?,?,?,?)",
            (1 + i % songs, 1 + (i + 1) % songs, "lyric_link", json.dumps({"i": i}), i / links),
        )
    conn.execute("INSERT INTO ratings(seam_id,song_a,song_b,method,rating) VALUES(1,1,2,'auto',4)")
    conn.commit()
    return conn


@pytest.fixture
def settings(tmp_path):
    return Settings(tmp_path / "home")


@pytest.fixture
def conn(settings):
    connection = _library(settings)
    yield connection
    connection.close()


@pytest.fixture
def client(settings, conn, tmp_path):
    return TestClient(create_app(settings, tmp_path / "no-web"))


def _plan(conn, sql: str, args: tuple = ()) -> str:
    return " | ".join(row[3] for row in conn.execute("EXPLAIN QUERY PLAN " + sql, args))


# ---- indexes (db.py)


def test_discover_reads_one_kind_best_first_from_an_index(conn):
    plan = _plan(
        conn,
        "SELECT d.* FROM seam_book d WHERE d.kind='harmonic_sequence_candidate' "
        "ORDER BY d.score DESC,d.id",
    )
    assert "seam_book_kind" in plan and "TEMP B-TREE" not in plan, plan


def test_every_connect_finds_legacy_kinds_without_walking_every_link(conn):
    plan = _plan(
        conn,
        "SELECT id,kind,payload FROM seam_book WHERE kind IN ('same_melody','harmonic_cousin')",
    )
    assert "seam_book_kind" in plan and "SCAN" not in plan, plan


def test_status_counts_come_from_covering_indexes(conn):
    analysed = _plan(
        conn, "SELECT COUNT(*) FROM analysis WHERE version=? AND error IS NULL", (ANALYSIS_VERSION,)
    )
    assert "COVERING INDEX analysis_version" in analysed, analysed
    synced = _plan(conn, "SELECT COUNT(*) FROM lyrics WHERE status='synced'")
    assert "COVERING INDEX lyrics_status" in synced, synced
    newest = _plan(conn, "SELECT MAX(version) FROM analysis")
    assert "analysis_version" in newest, newest


@pytest.mark.parametrize(
    ("sql", "index"),
    [
        ("SELECT 1 FROM ratings WHERE seam_id=?", "ratings_seam"),
        ("SELECT 1 FROM ratings WHERE song_a=?", "ratings_song_a"),
        ("SELECT 1 FROM ratings WHERE song_b=?", "ratings_song_b"),
        ("SELECT 1 FROM seam_book WHERE song_b=?", "seam_book_song_b"),
    ],
)
def test_foreign_key_lookups_have_an_index(conn, sql, index):
    """SQLite runs these for every song or link removed; without an index each is a full scan."""
    plan = _plan(conn, sql, (1,))
    assert index in plan and "SCAN" not in plan, plan


def test_removing_a_link_still_lets_go_of_its_ratings(conn):
    conn.execute("DELETE FROM seam_book WHERE id=1")
    conn.commit()
    assert conn.execute("SELECT seam_id FROM ratings").fetchone()[0] is None


# ---- the analysis pipeline: only the arrays planning uses, words found once


def test_load_features_reads_only_the_arrays_asked_for(settings, conn):
    wanted = load_features(settings, 1, ("beats", "bar_starts"))
    assert set(wanted) == {"beats", "bar_starts"}
    assert set(load_features(settings, 1)) >= {"peaks", "raw_beats", *SONG_ARRAYS}


def test_load_song_never_reads_the_waveform_or_raw_beats(settings, conn, monkeypatch):
    asked: list = []
    real = pipeline.load_features

    def watching(settings_, song_id, names=None):
        asked.append(names)
        return real(settings_, song_id, names)

    monkeypatch.setattr("selecta.analysis.song.load_features", watching)
    song = load_song(conn, settings, 1)
    assert asked == [SONG_ARRAYS]
    assert not {"peaks", "raw_beats", "raw_downbeats"} & set(SONG_ARRAYS)
    assert song.bar_times.size == 32 and song.mfcc_bars.shape == (32, 20)


def test_a_line_finds_its_words_once():
    line = Line(1.0, 2.0, "Hold me TONIGHT, hold me")
    assert line.words == ["hold", "me", "tonight", "hold", "me"]
    assert line.words is line.words
    assert line == Line(1.0, 2.0, "Hold me TONIGHT, hold me")  # the cache isn't part of it


# ---- rendered audio: revalidated, never reused by guesswork, never downloaded twice


def _clip(settings: Settings, key: str = "k1") -> os.PathLike:
    folder = settings.renders_dir / "seams" / key
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "clip.flac"
    path.write_bytes(b"fLaC pretend audio")
    return path


@pytest.mark.parametrize("which", ["clip", "preview"])
def test_a_seam_the_browser_already_has_comes_back_as_304(client, settings, which):
    path = _clip(settings)
    path.with_name("preview.flac").write_bytes(b"fLaC pretend preview")
    first = client.get(f"/api/seams/k1/{which}")
    assert first.status_code == 200
    assert first.headers["cache-control"] == "no-cache"
    tag = first.headers["etag"]
    again = client.get(f"/api/seams/k1/{which}", headers={"If-None-Match": tag})
    assert again.status_code == 304 and again.content == b""
    assert again.headers["etag"] == tag


def test_a_seam_rendered_again_is_sent_again(client, settings):
    path = _clip(settings)
    tag = client.get("/api/seams/k1/clip").headers["etag"]
    path.write_bytes(b"fLaC a different, longer take of it")
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 5_000_000_000))
    again = client.get("/api/seams/k1/clip", headers={"If-None-Match": tag})
    assert again.status_code == 200 and again.content == b"fLaC a different, longer take of it"


def test_serving_a_clip_keeps_its_tag(client, settings):
    """mark_used moves only the access time, so the tag a browser holds stays good."""
    _clip(settings)
    tags = {client.get("/api/seams/k1/clip").headers["etag"] for _ in range(3)}
    assert len(tags) == 1


def test_an_export_is_revalidated_too(client, settings):
    exports = settings.home / "exports"
    exports.mkdir(parents=True, exist_ok=True)
    (exports / "mix.flac").write_bytes(b"fLaC whole mix")
    first = client.get("/api/exports/mix.flac")
    assert first.status_code == 200 and "mix.flac" in first.headers["content-disposition"]
    again = client.get("/api/exports/mix.flac", headers={"If-None-Match": first.headers["etag"]})
    assert again.status_code == 304


def test_a_range_request_still_gets_its_range(client, settings):
    _clip(settings)
    part = client.get("/api/seams/k1/clip", headers={"Range": "bytes=0-3"})
    assert part.status_code == 206 and part.content == b"fLaC"


@pytest.mark.parametrize(
    ("header", "matches"),
    [
        ('"abc"', True),
        ('W/"abc"', True),
        ('"x", "abc"', True),
        ("*", True),
        ('"x"', False),
        (None, False),
        ("", False),
    ],
)
def test_if_none_match_is_compared_weakly(header, matches):
    assert _matches(header, '"abc"') is matches


# ---- word links: found again only when the lyrics change


def test_word_links_are_not_found_again_while_the_lyrics_stay_the_same(client, conn, monkeypatch):
    calls: list[int] = []

    def counting(_conn, *_args, **_kwargs):
        calls.append(1)
        return []

    monkeypatch.setattr("selecta.discovery.search.lyric_links", counting)
    for _ in range(3):
        assert client.get("/api/links").status_code == 200
    # a library with no links at all used to search every lyric on every call
    assert len(calls) == 1
    conn.execute(
        "UPDATE lyrics SET status='synced', synced='[00:01.00] a new line' WHERE song_id=1"
    )
    conn.commit()
    client.get("/api/links")
    assert len(calls) == 2


def test_links_look_at_renders_once_not_once_per_link(client, monkeypatch, settings):
    from selecta.seams import SeamStore

    readers: list[int] = []
    real = SeamStore.status_reader

    def counting(self):
        readers.append(1)
        return real(self)

    monkeypatch.setattr(SeamStore, "status_reader", counting)
    assert client.get("/api/links").status_code == 200
    assert readers == [1]


# ---- the cache is walked once per answer, not twice


@pytest.mark.parametrize("route", ["/api/jobs", "/api/diagnostics", "/api/storage"])
def test_status_pages_walk_the_cache_once(client, settings, monkeypatch, route):
    walks: list[str] = []
    real = stems._window_dirs

    def counting(root):
        walks.append(str(root))
        return real(root)

    for root in stems.cache_roots(settings):
        root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(stems, "_window_dirs", counting)
    assert client.get(route).status_code == 200
    assert walks and len(walks) == len(set(walks)), walks


def test_cache_room_matches_the_two_old_questions(settings, conn):
    folder = settings.home / "stems" / "w1"
    folder.mkdir(parents=True)
    (folder / "vocals.wav").write_bytes(b"x" * 1000)
    used, largest = stems.cache_room(settings)
    assert used == stems.cache_bytes(settings) == 1000
    assert largest == stems.largest_cache_bytes(settings)


# ---- blocking work stays off the event loop


def _off_the_loop() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return True
    return False


def test_checking_a_backup_runs_off_the_event_loop(client, monkeypatch):
    seen: list[bool] = []

    def validate(data):
        seen.append(_off_the_loop())
        return {"created_utc": "2026-11-12T00:00:00Z"}, None, {"songs": 0}

    monkeypatch.setattr("selecta.routes.system.validate_backup", validate)
    answer = client.post(
        "/api/backup/preview", content=b"PK zip", headers={"content-type": "application/zip"}
    )
    assert answer.status_code == 200
    assert seen == [True]


def test_staging_a_backup_runs_off_the_event_loop(client, monkeypatch):
    seen: list[bool] = []

    def stage(_settings, _data, _token):
        seen.append(_off_the_loop())
        return {"staged": True}

    monkeypatch.setattr("selecta.routes.system.stage_restore", stage)
    answer = client.post(
        "/api/backup/stage", content=b"PK zip", headers={"content-type": "application/zip"}
    )
    assert answer.status_code == 200 and answer.json() == {"staged": True}
    assert seen == [True]


# ---- analysis isn't started for songs that no longer need it


def test_asking_for_an_analysed_song_loads_no_models(settings, conn, monkeypatch):
    from typer.testing import CliRunner

    from selecta import cli

    loaded: list[int] = []
    monkeypatch.setenv("SELECTA_HOME", str(settings.home))
    monkeypatch.setattr(
        "selecta.analysis.pipeline.Analysers.load", lambda *_a, **_k: loaded.append(1)
    )
    result = CliRunner().invoke(
        cli.app, ["analyse", "--song", "1", "--song", "1", "--no-low-priority"]
    )
    assert result.exit_code == 0, result.output
    assert "Nothing to analyse" in result.output
    assert loaded == []


# ---- the render worker: the current mix still comes first, measured only when there's work


def test_the_worker_measures_the_cache_only_when_the_mix_has_a_seam_to_make(
    settings, conn, monkeypatch
):
    from selecta import mix, seam_worker
    from selecta.seams import SeamStore

    rooms: list[int] = []
    monkeypatch.setattr(seam_worker, "cache_room", lambda _s: rooms.append(1) or (0, 10**12))
    store = SeamStore(settings)
    next_seam, _keep, _moves = seam_worker._mix_seams(store, settings)
    assert next_seam() is None and rooms == []  # an empty mix: nothing to measure
    for song_id in (1, 2, 3):
        mix.add_song(conn, song_id)
    first = next_seam()
    assert (first.a, first.b) == (1, 2)  # the mix's own first seam, in order
    assert rooms == [1]


def test_a_full_cache_still_holds_the_mix_back(settings, conn, monkeypatch):
    from selecta import mix, seam_worker
    from selecta.seams import SeamStore

    monkeypatch.setattr(seam_worker, "cache_room", lambda _s: (10**12, 10**12))
    for song_id in (1, 2):
        mix.add_song(conn, song_id)
    next_seam, _keep, _moves = seam_worker._mix_seams(SeamStore(settings), settings)
    assert next_seam() is None
