"""SF-0220-05: a locked song can't be shifted by moving another song past it."""

from __future__ import annotations

from fastapi.testclient import TestClient
from mix_helpers import _song_row

from selecta import db, mix
from selecta.api import create_app
from selecta.config import Settings


def _client_with_locked_middle(tmp_path):
    settings = Settings(tmp_path)
    conn = db.connect(settings.db_path)
    for song_id in (1, 2, 3, 4):
        _song_row(conn, song_id, f"Artist {song_id}", f"Song {song_id}")
    conn.commit()
    mix.write_order(conn, [(1, None, 0), (2, None, 1), (3, None, 0), (4, None, 0)])
    conn.close()
    return TestClient(create_app(settings, tmp_path / "no-web"))


def _order(client):
    return [(item["song_id"], bool(item["locked"])) for item in client.get("/api/mix").json()["mix"]]


def test_moving_a_song_past_a_locked_one_is_refused_and_changes_nothing(tmp_path):
    client = _client_with_locked_middle(tmp_path)
    before = _order(client)
    for source, target in ((0, 2), (3, 0), (0, 1), (2, 1)):
        answer = client.post("/api/mix/move", json={"source": source, "target": target})
        assert answer.status_code == 409
        assert "locked" in answer.json()["detail"]
        assert "nothing moved" in answer.json()["detail"]
        assert _order(client) == before


def test_moves_that_leave_the_locked_song_in_place_still_work(tmp_path):
    client = _client_with_locked_middle(tmp_path)
    moved = client.post("/api/mix/move", json={"source": 2, "target": 3}).json()["mix"]
    assert [(item["song_id"], bool(item["locked"])) for item in moved] == [
        (1, False),
        (2, True),
        (4, False),
        (3, False),
    ]


def test_moving_the_locked_song_itself_is_a_choice_and_keeps_its_lock(tmp_path):
    client = _client_with_locked_middle(tmp_path)
    moved = client.post("/api/mix/move", json={"source": 1, "target": 3}).json()["mix"]
    assert [(item["song_id"], bool(item["locked"])) for item in moved][3] == (2, True)


def test_the_same_guard_protects_a_draft(tmp_path):
    client = _client_with_locked_middle(tmp_path)
    draft = client.post("/api/drafts", json={"name": "Locked draft"}).json()["id"]
    conn = db.connect(Settings(tmp_path).db_path)
    mix.write_order(conn, [(1, None, 0), (2, None, 0), (3, None, 0)], draft)
    conn.close()
    assert client.post(f"/api/mix/1/lock?draft={draft}").status_code == 200
    answer = client.post(f"/api/mix/move?draft={draft}", json={"source": 0, "target": 2})
    assert answer.status_code == 409
    items = client.get(f"/api/mix?draft={draft}").json()["mix"]
    assert [item["song_id"] for item in items] == [1, 2, 3]
    assert items[1]["locked"]
