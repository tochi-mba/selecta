"""GP-0260: what Discovery may change. A pair goes into exactly one named mix, source then
destination, guarded by the order the page saw; stale, reversed, duplicate or missing candidates
change nothing; hearing and answering a chord match never touch any mix."""

from __future__ import annotations

import json

from test_api_contracts import (  # noqa: F401 - pytest fixtures shared with the contract tests
    _somewhere_for_files,
    client,  # noqa: F811
    conn,  # noqa: F811
    settings,
)

from selecta import mix


def _order(client, draft=None):
    params = {"draft": draft} if draft else {}
    return [item["song_id"] for item in client.get("/api/mix", params=params).json()["mix"]]


def _fill(conn, *songs, draft=None):
    for song in songs:
        mix.add_song(conn, song, None, draft)


def _pair(client, a, b, order, draft=None, operation=None):
    headers = {"x-mix-order": order}
    if operation:
        headers["x-operation-id"] = operation
    address = "/api/mix/pair" + (f"?draft={draft}" if draft else "")
    return client.post(
        address, json={"a": a, "b": b, "move": "word_cut", "phrase": "night"}, headers=headers
    )


def test_the_pair_goes_in_source_then_destination_with_the_seam_on_the_destination(client, conn):
    _fill(conn, 1)
    answer = _pair(client, 6, 4, "1")
    assert answer.status_code == 200
    assert _order(client) == [1, 6, 4]
    entering = answer.json()["mix"][2]
    assert entering["song_id"] == 4
    assert entering["seam"]["settings"] == {"move": "word_cut", "phrase": "night"}
    assert answer.json()["mix"][1]["seam"]["settings"] == {}


def test_a_mix_that_changed_since_the_page_looked_refuses_and_stays_as_it_is(client, conn):
    _fill(conn, 1, 2)
    answer = _pair(client, 4, 5, "1")
    assert answer.status_code == 409
    assert answer.json()["code"] == "mix_changed"
    assert _order(client) == [1, 2]


def test_a_stale_draft_refuses_and_neither_the_draft_nor_the_current_mix_changes(client, conn):
    _fill(conn, 1)
    draft = client.post("/api/drafts", json={}).json()["id"]
    _fill(conn, 2, draft=draft)
    assert _pair(client, 4, 5, "", draft=draft).status_code == 409
    assert _order(client, draft) == [2]
    assert _order(client) == [1]
    assert _pair(client, 4, 5, "2", draft=draft).status_code == 200
    assert _order(client, draft) == [2, 4, 5]
    assert _order(client) == [1]


def test_a_reversed_pair_already_there_is_refused_not_reordered(client, conn):
    _fill(conn, 2, 1)
    answer = _pair(client, 1, 2, "2,1")
    assert answer.status_code == 409
    assert "both in this mix already" in answer.json()["detail"]
    assert _order(client) == [2, 1]


def test_a_duplicate_recording_or_non_music_file_is_refused_and_nothing_goes_in(client, conn):
    conn.execute("UPDATE songs SET duplicate_of=1 WHERE id=5")
    conn.execute("UPDATE songs SET is_music=0 WHERE id=6")
    conn.commit()
    for a, b in ((4, 5), (6, 4), (4, 999)):
        answer = _pair(client, a, b, "")
        assert answer.status_code == 409
        assert "no longer in your library" in answer.json()["detail"]
    assert _order(client) == []


def test_a_retried_add_after_a_lost_reply_goes_in_once(client):
    first = _pair(client, 4, 5, "", operation="pair-gp0260")
    again = _pair(client, 4, 5, "", operation="pair-gp0260")
    assert first.status_code == again.status_code == 200
    assert _order(client) == [4, 5]


def test_hearing_and_answering_a_chord_match_never_changes_a_mix(client, conn):
    _fill(conn, 1, 2)
    draft = client.post("/api/drafts", json={}).json()["id"]
    _fill(conn, 3, draft=draft)
    conn.execute(
        "INSERT INTO seam_book(id,song_a,song_b,kind,payload,score) VALUES(?,?,?,?,?,?)",
        (
            40,
            4,
            5,
            "harmonic_sequence_candidate",
            json.dumps({"a_at": 1, "b_at": 2, "bars": 4}),
            1.0,
        ),
    )
    conn.commit()
    listed = client.get("/api/discoveries").json()
    assert [(row["song_a"], row["song_b"]) for row in listed] == [(4, 5)]
    for verdict in ("approved", "new", "rejected"):
        assert (
            client.post("/api/discoveries/40/review", json={"verdict": verdict}).status_code == 200
        )
    assert (
        client.post("/api/discoveries/999/review", json={"verdict": "approved"}).status_code == 404
    )
    assert _order(client) == [1, 2]
    assert _order(client, draft) == [3]
