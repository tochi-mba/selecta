import json

import numpy as np

from selecta import db
from selecta.analysis.song import SongInfo
from selecta.discovery.search import audio_search


def _song(song_id: int, chroma: np.ndarray | None) -> SongInfo:
    bars = len(chroma) if chroma is not None else 4
    return SongInfo(
        id=song_id,
        path=f"{song_id}.wav",
        artist="Artist",
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
