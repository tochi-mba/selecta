"""The S-KEY replacement benchmark (ADR-0405, SC-0405-02): scoring, the library read and the CLI."""

from __future__ import annotations

import json
import sqlite3

import pytest
from typer.testing import CliRunner

from selecta import db
from selecta.analysis import key_benchmark as bench
from selecta.cli import app as cli_app


@pytest.mark.parametrize(
    ("candidate", "reference", "found"),
    [
        ("A minor", "A minor", "same"),
        ("E minor", "A minor", "fifth"),
        ("D minor", "A minor", "fifth"),
        ("C major", "A minor", "relative"),
        ("A minor", "C major", "relative"),
        ("A major", "A minor", "parallel"),
        ("F# major", "A minor", "other"),
        ("8A", "A minor", "same"),
        ("A minor", "8B", "relative"),
    ],
)
def test_relations_follow_the_mirex_categories(candidate, reference, found):
    assert bench.relation(candidate, reference) == found


def test_the_weighted_score_uses_the_mirex_weights():
    score = bench.Score()
    for candidate in ("A minor", "E minor", "C major", "A major", "F# major"):
        score.add(candidate, "A minor")
    summary = score.as_dict()
    assert summary["songs"] == 5
    assert summary["exact"] == 0.2 and summary["mixable"] == 0.6
    assert summary["weighted"] == pytest.approx((1.0 + 0.5 + 0.3 + 0.2) / 5)


def _library(tmp_path):
    path = tmp_path / "selecta.sqlite"
    conn = db.connect(path)
    songs = [
        (1, "A minor", 0.9, 1, None, True),   # agrees
        (2, "A minor", 0.6, 0, "8B", True),   # candidate says C major; owner corrected to 8B
        (3, "C major", 0.2, 1, None, True),   # chroma stood in for S-KEY: skipped
        (4, "G major", 0.8, 1, None, False),  # file gone: skipped
    ]
    for song_id, key, confidence, agrees, owner, exists in songs:
        audio = tmp_path / f"song{song_id}.wav"
        if exists:
            audio.write_bytes(b"x")
        conn.execute(
            "INSERT INTO songs (id, path, folder, size, mtime, duration, artist, title) "
            "VALUES (?, ?, ?, 1, 0, 60, 'Artist', ?)",
            (song_id, str(audio), str(tmp_path), f"Song {song_id}"),
        )
        conn.execute(
            "INSERT INTO analysis (song_id, version, key, camelot, key_confidence, "
            "key_agrees_chroma) VALUES (?, 1, ?, '8A', ?, ?)",
            (song_id, key, confidence, agrees),
        )
        if owner:
            conn.execute("INSERT INTO song_overrides (song_id, camelot) VALUES (?, ?)",
                         (song_id, owner))
    conn.commit()
    conn.close()
    return path


GUESSES = {"song1.wav": "A minor", "song2.wav": "C major"}


def fake(path):
    return GUESSES[path.name]


def test_the_benchmark_reads_stored_skey_keys_read_only_and_scores_owner_corrections(tmp_path):
    path = _library(tmp_path)
    conn = bench.open_read_only(path)
    report = bench.run(conn, fake)
    with pytest.raises(sqlite3.OperationalError):
        conn.execute("DELETE FROM songs")
    assert report.against_skey.counts == {"same": 1, "relative": 1}
    assert dict(report.skipped) == {"no S-KEY answer": 1, "file missing": 1}
    assert report.candidate_vs_owner.counts == {"same": 1}
    assert report.skey_vs_owner.counts == {"relative": 1}
    assert report.disagreements == [{"song_id": 2, "artist": "Artist", "title": "Song 2",
                                     "skey": "A minor", "candidate": "C major",
                                     "relation": "relative"}]
    assert report.meets(0.65) and not report.meets(0.66)
    assert not bench.Report("empty").meets(0.0)


def test_a_candidate_that_fails_on_one_song_skips_only_that_song(tmp_path):
    def flaky(path):
        if path.name == "song2.wav":
            raise RuntimeError("could not decode")
        return "A minor"

    report = bench.run(bench.open_read_only(_library(tmp_path)), flaky)
    assert report.against_skey.songs == 1 and report.skipped["candidate failed"] == 1


def test_the_command_writes_a_report_with_the_threshold(tmp_path, monkeypatch):
    _library(tmp_path)
    monkeypatch.setenv("SELECTA_HOME", str(tmp_path))
    monkeypatch.setitem(bench.CANDIDATES, "chroma", fake)
    output = tmp_path / "report.json"
    result = CliRunner().invoke(
        cli_app, ["key-benchmark", "--threshold", "0.5", "--output", str(output)]
    )
    assert result.exit_code == 0, result.output
    assert "Meets the threshold." in result.output
    saved = json.loads(output.read_text("utf-8"))
    assert saved["meets_threshold"] is True and saved["against_skey"]["songs"] == 2
    unknown = CliRunner().invoke(cli_app, ["key-benchmark", "--candidate", "nope"])
    assert unknown.exit_code != 0
