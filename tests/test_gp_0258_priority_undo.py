"""GP-0258-07: undoing a priority batch puts back each song's own processing priority, not 0.

A song can carry a priority that is neither 0 nor 100 (an older build, or a value set outside the
Library). The batch reports what each song had, and the restore action puts exactly that back,
and only while the song still shows the state the batch left it in.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from selecta import db
from selecta.api import create_app
from selecta.config import Settings


def _client(tmp_path):
    connection = db.connect(Settings(tmp_path).db_path)
    connection.executemany(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music,"
        "processing_priority) VALUES(?,?,'f',1,1.0,200.0,'Someone',?,1,?)",
        [(1, "a.flac", "A", 0), (2, "b.flac", "B", 50), (3, "c.flac", "C", 100)],
    )
    connection.commit()
    return connection, TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))


def _priorities(connection):
    rows = connection.execute("SELECT id,processing_priority FROM songs ORDER BY id")
    return {row[0]: row[1] for row in rows}


def test_a_priority_batch_reports_what_each_song_had(tmp_path):
    connection, client = _client(tmp_path)
    answer = client.post(
        "/api/library/batch",
        json={
            "action": "prioritize",
            "entries": [
                {"id": 1, "expected": False},
                {"id": 2, "expected": False},
            ],
        },
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["previous"] == [{"id": 1, "priority": 0}, {"id": 2, "priority": 50}]
    connection.close()


def test_restoring_puts_back_each_songs_own_priority(tmp_path):
    connection, client = _client(tmp_path)
    client.post(
        "/api/library/batch",
        json={
            "action": "prioritize",
            "entries": [
                {"id": 1, "expected": False},
                {"id": 2, "expected": False},
            ],
        },
    )
    answer = client.post(
        "/api/library/batch",
        json={
            "action": "restore_priority",
            "entries": [
                {"id": 1, "expected": True, "priority": 0},
                {"id": 2, "expected": True, "priority": 50},
            ],
        },
    )
    assert answer.status_code == 200, answer.text
    assert _priorities(connection) == {1: 0, 2: 50, 3: 100}
    connection.close()


def test_restoring_is_refused_whole_when_a_song_changed_again(tmp_path):
    connection, client = _client(tmp_path)
    client.post(
        "/api/library/batch",
        json={
            "action": "prioritize",
            "entries": [
                {"id": 1, "expected": False},
                {"id": 2, "expected": False},
            ],
        },
    )
    client.post("/api/songs/2/priority", params={"priority": 0})
    answer = client.post(
        "/api/library/batch",
        json={
            "action": "restore_priority",
            "entries": [
                {"id": 1, "expected": True, "priority": 0},
                {"id": 2, "expected": True, "priority": 50},
            ],
        },
    )
    assert answer.status_code == 409
    assert _priorities(connection) == {1: 100, 2: 0, 3: 100}
    connection.close()


def test_restoring_needs_a_priority_in_range_for_every_song(tmp_path):
    connection, client = _client(tmp_path)
    for entry in ({"id": 3, "expected": True}, {"id": 3, "expected": True, "priority": 101}):
        answer = client.post(
            "/api/library/batch", json={"action": "restore_priority", "entries": [entry]}
        )
        assert answer.status_code in (400, 422)
    assert _priorities(connection)[3] == 100
    connection.close()
