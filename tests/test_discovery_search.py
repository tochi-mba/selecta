import json

import numpy as np
import pytest

from selecta import db
from selecta.analysis.song import SongInfo
from selecta.discovery.search import MOST_PER_SONG, audio_search, lyric_links, spread_out
from selecta.discovery.sweep import sweep


def _song(song_id: int, chroma: np.ndarray | None) -> SongInfo:
    bars = len(chroma) if chroma is not None else 4
    return SongInfo(
        id=song_id,
        path=f"{song_id}.wav",
        artist=f"Artist {song_id}",
        title=f"Song {song_id}",
        genre=None,
        family="other",
        duration=60.0,
        bpm=120.0,
        beats=np.arange(bars * 4, dtype=float) * 0.5,
        bar_starts=np.arange(0, bars * 4, 4),
        beats_per_bar=4,
        constant_tempo=True,
        grid_confidence=1.0,
        sections=[],
        camelot="8A",
        key_confidence=1.0,
        lufs=-14.0,
        peak_db=-2.0,
        energy=0.5,
        energy_bars=np.ones(4, dtype=np.float32),
        low_share_bars=np.ones(4, dtype=np.float32) * 0.3,
        chroma_bars=chroma,
    )


def _insert_songs(conn, *ids: int) -> None:
    conn.executemany(
        "INSERT INTO songs(id,path,folder,size,mtime,duration) VALUES(?,?,?,?,?,?)",
        [(song_id, f"{song_id}.wav", "", 1, 0.0, 60.0) for song_id in ids],
    )


def test_lyric_links_ignore_legacy_synced_rows_without_text(tmp_path):
    conn = db.connect(tmp_path / "test.sqlite")
    _insert_songs(conn, 1)
    conn.execute("INSERT INTO lyrics(song_id,status,synced) VALUES(1,'synced',NULL)")
    conn.commit()

    assert lyric_links(conn) == []


def test_legacy_melody_claims_are_relabelled_without_losing_reviews(tmp_path):
    path = tmp_path / "legacy.sqlite"
    conn = db.connect(path)
    _insert_songs(conn, 1, 2)
    conn.execute(
        "INSERT INTO seam_book(id,song_a,song_b,kind,payload,score,status) "
        "VALUES(9,1,2,'same_melody','{}',.99,'approved')"
    )
    conn.commit()
    conn.close()
    for _ in range(2):
        conn = db.connect(path)
        row = conn.execute("SELECT * FROM seam_book WHERE id=9").fetchone()
        assert row["kind"] == "tonal_profile_cousin"
        assert row["status"] == "approved"
        assert json.loads(row["payload"])["legacy_kind"] == "same_melody"
        assert conn.execute("SELECT COUNT(*) FROM seam_book").fetchone()[0] == 1
        conn.close()


def test_audio_search_calls_average_chroma_a_tonal_profile_not_a_melody(tmp_path):
    conn = db.connect(tmp_path / "test.sqlite")
    _insert_songs(conn, 1, 2)
    # Same mean pitch-class profile but in a different bar order: this matcher has no
    # temporal evidence that could support a shared-melody label.
    a = np.eye(12, dtype=np.float32)[:4]
    b = a[[2, 0, 3, 1]]

    assert audio_search(conn, [_song(1, a), _song(2, b)]) == 1

    row = conn.execute("SELECT kind,payload FROM seam_book").fetchone()
    payload = json.loads(row["payload"])
    assert row["kind"] == "tonal_profile_cousin"
    assert payload["method"] == "whole_track_mean_chroma"
    assert "not a same-melody claim" in payload["reason"]
    conn.close()


def test_ordered_harmonic_candidate_persists_audition_cues_and_honors_zero_limit(tmp_path):
    conn = db.connect(tmp_path / "sequence.sqlite")
    _insert_songs(conn, 1, 2)
    progression = np.eye(12)[[0, 4, 7, 2, 5, 9, 1, 6]]
    incoming = np.vstack([np.zeros((3, 12)), np.roll(progression, 2, axis=1)])
    songs = [_song(1, progression), _song(2, incoming)]
    assert audio_search(conn, songs, limit=0) == 0
    assert conn.execute("SELECT COUNT(*) FROM seam_book").fetchone()[0] == 0
    assert audio_search(conn, songs, limit=1) == 1
    row = conn.execute("SELECT kind,payload FROM seam_book").fetchone()
    assert row["kind"] == "harmonic_sequence_candidate"
    payload = json.loads(row["payload"])
    assert (payload["a_at"], payload["b_at"], payload["bars"]) == (0, 6, 8)
    assert payload["transpose"] == 10
    assert payload["a_end"] > payload["a_at"]
    assert payload["b_end"] > payload["b_at"]
    conn.close()


def test_audio_search_skips_missing_chroma_and_honors_limit(tmp_path):
    conn = db.connect(tmp_path / "test.sqlite")
    _insert_songs(conn, 1, 2, 3, 4)
    profile = np.eye(12, dtype=np.float32)[:4]
    songs = [
        _song(1, None),
        _song(2, profile),
        _song(3, profile.copy()),
        _song(4, profile.copy()),
    ]

    checkpoints = []
    assert audio_search(conn, songs, limit=1, before_pair=lambda: checkpoints.append(True)) == 1
    assert checkpoints == [True]
    assert conn.execute("SELECT COUNT(*) FROM seam_book").fetchone()[0] == 1
    conn.close()


def _chroma(seed: int, bars: int = 32) -> np.ndarray:
    """Every song shares this chord loop, so every pair could match."""
    roots = [0, 5, 7, 9]
    rows = np.zeros((bars, 12), dtype=float)
    for bar in range(bars):
        root = roots[bar % 4]
        rows[bar, [root, (root + 4) % 12, (root + 7) % 12]] = 1.0
    return rows + np.random.default_rng(seed).random(rows.shape) * 0.01


def test_one_song_cannot_take_over_the_chord_list(tmp_path):
    """An earlier search walked the library in order, so the first song was on every row."""
    conn = db.connect(tmp_path / "selecta.sqlite")
    ids = list(range(1, 41))
    _insert_songs(conn, *ids)
    songs = [_song(song_id, _chroma(song_id)) for song_id in ids]
    audio_search(conn, songs, limit=60, seed=3)
    rows = conn.execute(
        "SELECT song_a,song_b FROM seam_book WHERE kind='harmonic_sequence_candidate'"
    ).fetchall()
    assert len(rows) >= 20
    appearances: dict[int, int] = {}
    for row in rows:
        for song in (row["song_a"], row["song_b"]):
            appearances[song] = appearances.get(song, 0) + 1
    assert max(appearances.values()) <= MOST_PER_SONG
    assert len(appearances) >= 25, "the matches should come from across the library"


def test_two_songs_by_one_artist_are_not_a_discovery(tmp_path):
    conn = db.connect(tmp_path / "selecta.sqlite")
    _insert_songs(conn, 1, 2)
    first, second = _song(1, _chroma(1)), _song(2, _chroma(2))
    first.artist = "Stevie Wonder"
    second.artist = "Stevie Wonder feat. Someone"
    assert audio_search(conn, [first, second], limit=10, seed=1) == 0


def test_the_search_order_changes_between_runs_unless_seeded(tmp_path):
    runs = iter(range(10))

    def order(seed):
        conn = db.connect(tmp_path / f"{next(runs)}.sqlite")
        ids = list(range(1, 21))
        _insert_songs(conn, *ids)
        audio_search(conn, [_song(i, _chroma(i)) for i in ids], limit=5, seed=seed)
        return [tuple(row) for row in conn.execute("SELECT song_a,song_b FROM seam_book")]

    assert order(1) == order(1)
    assert order(1) != order(2)


def _row(song_a, song_b, artist_a=None, artist_b=None):
    return {
        "song_a": song_a,
        "song_b": song_b,
        "artist_a": artist_a or f"Artist {song_a}",
        "artist_b": artist_b or f"Artist {song_b}",
    }


def test_the_list_leads_with_a_new_song_and_artist_on_every_row():
    rows = [_row(1, song) for song in range(2, 8)] + [_row(10, 11), _row(12, 13)]
    shown = spread_out(rows, 8)
    assert [(row["song_a"], row["song_b"]) for row in shown[:3]] == [(1, 2), (10, 11), (12, 13)]
    assert len(shown) == 8, "nothing is thrown away while there's room"


def test_the_same_artist_waits_behind_new_ones():
    rows = [_row(1, 2, "Stevie", "Someone"), _row(3, 4, "Stevie", "Other"), _row(5, 6)]
    assert [row["song_a"] for row in spread_out(rows, 3)] == [1, 5, 3]


def test_the_list_respects_its_limit_and_copes_with_nothing():
    assert spread_out([], 5) == []
    assert len(spread_out([_row(1, song) for song in range(2, 9)], 3)) == 3
    assert spread_out([_row(1, 2)], 0) == []


def test_exhaustive_sweep_resumes_remembers_nonmatches_and_invalidates_changes(tmp_path):
    conn = db.connect(tmp_path / 'sweep.sqlite')
    _insert_songs(conn, 1, 2, 3)
    songs = [_song(i, np.zeros((8, 12))) for i in (1, 2, 3)]
    checkpoints = []
    first = sweep(conn, songs, 1, lambda: checkpoints.append(True))
    assert first == dict(checked=1, cached=0, remaining=2, added=0)
    conn.close()
    conn = db.connect(tmp_path / 'sweep.sqlite')
    assert sweep(conn, songs, 10) == dict(checked=2, cached=1, remaining=0, added=0)
    assert sweep(conn, songs, 10, lambda: checkpoints.append(True))['cached'] == 3
    assert checkpoints == [True]
    songs[0].chroma_bars[0, 0] = 1
    changed = sweep(conn, songs, 10)
    assert changed['checked'] == 2
    assert changed['cached'] == 1
    conn.close()


def test_exhaustive_sweep_does_not_checkpoint_an_interrupted_pair(tmp_path):
    path = tmp_path / 'interrupted.sqlite'
    conn = db.connect(path)
    _insert_songs(conn, 1, 2, 3)
    songs = [_song(i, np.zeros((8, 12))) for i in (1, 2, 3)]
    calls = 0

    def interrupt():
        nonlocal calls
        calls += 1
        if calls == 2:
            raise InterruptedError('stop requested')

    with pytest.raises(InterruptedError):
        sweep(conn, songs, 10, interrupt)
    conn.close()
    conn = db.connect(path)
    assert conn.execute('SELECT COUNT(*) FROM discovery_comparisons').fetchone()[0] == 1
    assert sweep(conn, songs, 10) == dict(checked=2, cached=1, remaining=0, added=0)
    conn.close()
