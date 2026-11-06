"""The request routes together: asking, answering, adding anyway, and new songs arriving."""

from __future__ import annotations

import json
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from selecta import api_common as api_module
from selecta import db
from selecta import requests as song_requests
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.seams import SeamStore, request_from


def _song(conn, song_id, analysed=True):
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,?,?,?,?,?,?,1)",
        (song_id, f"{song_id}.flac", "f", 1, 1.0, 200.0, f"Artist {song_id}", f"Song {song_id}"),
    )
    if analysed:
        conn.execute(
            "INSERT INTO analysis(song_id,version,bpm,camelot) VALUES(?,?,?,?)",
            (song_id, ANALYSIS_VERSION, 120.0, "8A"),
        )


@pytest.fixture
def client(tmp_path, monkeypatch):
    settings = Settings(tmp_path)
    conn = db.connect(settings.db_path)
    for song_id in range(1, 7):
        _song(conn, song_id)
    _song(conn, 9, analysed=False)
    conn.commit()
    conn.close()

    def load_song(_conn, _settings, song_id):
        if song_id == 9:
            raise KeyError("not analysed")
        return SimpleNamespace(id=song_id, title=f"Song {song_id}", vocals_known=True, bpm=120.0)

    monkeypatch.setattr("selecta.analysis.song.load_song", load_song)
    monkeypatch.setattr("selecta.planner.reel.load_library", lambda _conn, _settings: [])
    sent = []

    def submit(self, request, urgent=False, retry=False, after=None):
        sent.append((request, urgent, after))
        return {"status": "queued", "key": request.key}

    monkeypatch.setattr(SeamStore, "submit", submit)
    test_client = TestClient(create_app(settings, tmp_path / "no-web"))
    test_client.sent = sent
    for song_id in (1, 2, 3):
        assert test_client.post("/api/mix/songs", json={"song_id": song_id}).status_code == 200
    return test_client


def _playback(position=0):
    return {"order": [1, 2, 3], "position": position, "phase": "playing", "seconds_left": 100.0}


def _plan(monkeypatch, songs=(5,), bridges=(), position=2, seams=None):
    def propose(rows, *_args, **_kwargs):
        chain = len(songs) + 1
        plan = {
            "position": position,
            "songs": list(songs),
            "bridges": list(bridges),
            "seams": seams or [{"move": "bass_swap_blend", "from_request": True}] * chain,
        }
        return [{**row, "plan": plan, "stage": None} for row in rows]

    monkeypatch.setattr("selecta.request_planner.proposals", propose)


def _consider(client, position=0):
    return client.post("/api/requests/consider", json=_playback(position)).json()["requests"][0]


def _ready_all(client, tmp_path, chain):
    """Finished seams on disk, as if the worker had rendered them."""
    for a, b in zip(chain, chain[1:], strict=False):
        key = request_from(a, b, {"move": "bass_swap_blend", "from_request": True}).key
        folder = Settings(tmp_path).renders_dir / "seams" / key
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "clip.flac").write_bytes(b"prepared")
        (folder / "seam.json").write_text(
            json.dumps({"status": "ready", "key": key, "passed": True}), "utf-8"
        )


def test_a_request_says_where_it_will_go_and_lists_its_transitions(client, monkeypatch):
    client.post("/api/requests", json={"song_id": 5})
    _plan(monkeypatch)
    row = _consider(client)
    assert row["stage"] == "preparing"
    assert row["ready"] is False
    assert len(row["transitions"]) == 2
    assert [t["status"] for t in row["transitions"]] == ["none", "none"]
    assert row["seconds"] > 0


def test_a_requests_seams_go_after_only_what_plays_before_it(client, monkeypatch):
    client.post("/api/requests", json={"song_id": 5})
    _plan(monkeypatch, position=2)
    _consider(client)
    _request, urgent, after = client.sent[-1]
    assert urgent is False
    assert after == [request_from(1, 2, None).key], "what plays before it, not the whole mix"
    assert request_from(2, 3, None).key not in after, "that's the one it's about to replace"


def test_a_later_spot_waits_for_everything_heard_before_it(client, monkeypatch):
    client.post("/api/requests", json={"song_id": 5})
    _plan(monkeypatch, position=3)
    _consider(client)
    assert client.sent[-1][2] == [request_from(1, 2, None).key, request_from(2, 3, None).key]


def test_a_request_only_waits_for_the_next_two_transitions(client, monkeypatch):
    """Waiting for everything before it meant sitting behind a whole unrendered mix."""
    for song_id in (4, 6):
        client.post("/api/mix/songs", json={"song_id": song_id})
    client.post("/api/requests", json={"song_id": 5})
    _plan(monkeypatch, position=5)
    client.post(
        "/api/requests/consider",
        json={"order": [1, 2, 3, 4, 6], "position": 0, "phase": "playing", "seconds_left": 100.0},
    )
    assert client.sent[-1][2] == [request_from(1, 2, None).key, request_from(2, 3, None).key]


def test_a_transition_says_what_kind_it_is_and_how_far_along(client, monkeypatch):
    client.post("/api/requests", json={"song_id": 5})
    _plan(monkeypatch)
    row = _consider(client)
    assert row["transitions"][0]["label"] == "Blend"
    assert row["after_id"] == 2


# ---- a bridge joins all at once


def _bridge_plan(monkeypatch):
    _plan(monkeypatch, songs=(4, 5), bridges=(4,), position=2)


def test_a_bridge_does_not_join_until_every_transition_is_ready(client, monkeypatch, tmp_path):
    client.post("/api/requests", json={"song_id": 5})
    _bridge_plan(monkeypatch)
    client.post("/api/requests/1/bridge", json={"allow": True, "songs": [4, 5]})
    _ready_all(client, tmp_path, [2, 4, 5])
    row = _consider(client)
    assert row["ready"] is False
    assert row["stage"] == "preparing"
    assert [seam["status"] for seam in row["transitions"]][:2] == ["ready", "ready"]
    refused = client.post("/api/requests/insert", json={**_playback(), "offer": row["offer"]})
    assert refused.status_code == 409
    assert [item["song_id"] for item in client.get("/api/mix").json()["mix"]] == [1, 2, 3]


def test_when_it_does_they_all_come_in_at_once_as_one_step(client, monkeypatch, tmp_path):
    client.post("/api/requests", json={"song_id": 5})
    _bridge_plan(monkeypatch)
    client.post("/api/requests/1/bridge", json={"allow": True, "songs": [4, 5]})
    _ready_all(client, tmp_path, [2, 4, 5, 3])
    row = _consider(client)
    assert row["ready"] is True
    joined = client.post("/api/requests/insert", json={**_playback(), "offer": row["offer"]}).json()
    assert [item["song_id"] for item in joined["mix"]] == [1, 2, 4, 5, 3]
    undone = client.post("/api/mix/undo").json()
    assert [item["song_id"] for item in undone["mix"]] == [1, 2, 3]


def test_a_bridge_nobody_agreed_to_can_not_join(client, monkeypatch, tmp_path):
    client.post("/api/requests", json={"song_id": 5})
    _bridge_plan(monkeypatch)
    _ready_all(client, tmp_path, [2, 4, 5, 3])
    row = _consider(client)
    assert row["ready"] is False
    assert row["stage"] == "approve"


def test_agreeing_to_one_bridge_does_not_agree_to_another(client, monkeypatch):
    client.post("/api/requests", json={"song_id": 5})
    client.post("/api/requests/1/bridge", json={"allow": True, "songs": [6, 5]})
    _bridge_plan(monkeypatch)
    assert _consider(client)["stage"] == "approve"


def test_a_yes_with_no_songs_named_stands_whatever_the_route(client, monkeypatch):
    client.post("/api/requests", json={"song_id": 5})
    client.post("/api/requests/1/bridge", json={"allow": True})
    _bridge_plan(monkeypatch)
    assert _consider(client)["stage"] == "preparing"


# ---- finding a bridge


def _search_plan(monkeypatch, routes=None, direct=False, looked_at=3):
    routes = (
        routes
        if routes is not None
        else [
            {
                "position": 2,
                "songs": [4, 5],
                "bridges": [4],
                "chain": [2, 4, 5, 3],
                "seams": [{"move": "bass_swap_blend", "from_request": True}] * 3,
                "words": "Tempo barely moves, keys match.",
            }
        ]
    )
    monkeypatch.setattr(
        "selecta.request_planner.bridge_options",
        lambda *_a, **_k: {"routes": routes, "direct": direct, "looked_at": looked_at},
    )


@pytest.fixture
def stocked(client, monkeypatch, tmp_path):
    songs = [
        SimpleNamespace(id=i, title=f"Song {i}", artist=f"Artist {i}", bpm=120.0, camelot="8A")
        for i in (1, 2, 3, 4, 5, 6)
    ]
    monkeypatch.setattr("selecta.planner.reel.load_library", lambda _conn, _settings: songs)
    monkeypatch.setattr("selecta.planner.vibes.traits_of", lambda _songs, _years: {})
    # the library is kept until something about it changes, so something has to
    conn = db.connect(Settings(tmp_path).db_path)
    conn.execute("INSERT INTO lyrics(song_id,status) VALUES(1,'instrumental')")
    conn.commit()
    conn.close()
    client.post("/api/requests", json={"song_id": 5})
    return client


def test_finding_a_bridge_lists_what_it_found(stocked, monkeypatch):
    _search_plan(monkeypatch)
    found = stocked.post("/api/requests/1/bridges", json={"order": [1, 2, 3], "position": 0}).json()
    assert found["looked_at"] == 3
    option = found["options"][0]
    assert option["best"] is True
    assert option["after"] == "Song 2"
    assert option["before"] == "Song 3"
    assert [song["bridge"] for song in option["songs"]] == [True, False]
    assert len(option["transitions"]) == 3
    assert option["transitions"][0]["label"] == "Blend"


def test_finding_a_bridge_renders_nothing_and_changes_nothing(stocked, monkeypatch):
    _search_plan(monkeypatch)
    stocked.post("/api/requests/1/bridges", json={"order": [1, 2, 3], "position": 0})
    assert stocked.sent == []
    assert [item["song_id"] for item in stocked.get("/api/mix").json()["mix"]] == [1, 2, 3]
    assert stocked.get("/api/requests").json()["requests"][0]["picked"] is None


def test_it_works_when_nothing_is_playing(stocked, monkeypatch):
    _search_plan(monkeypatch)
    assert stocked.post("/api/requests/1/bridges", json={}).status_code == 200


def test_hearing_one_found_only_renders_that_one(stocked, monkeypatch):
    _search_plan(monkeypatch)
    found = stocked.post("/api/requests/1/bridges", json={}).json()
    key = found["options"][0]["transitions"][1]["key"]
    assert stocked.post("/api/requests/1/hear", json={"keys": [key]}).status_code == 200
    assert [sent[0].key for sent in stocked.sent] == [key]


def test_hearing_something_it_never_found_is_refused(stocked):
    assert stocked.post("/api/requests/1/hear", json={"keys": ["nope"]}).status_code == 409


def test_a_request_that_has_gone_can_not_look_for_a_bridge(stocked):
    stocked.delete("/api/requests/1")
    assert stocked.post("/api/requests/1/bridges", json={}).status_code == 409


def test_a_song_selecta_can_not_place_says_so(client):
    client.post("/api/requests", json={"song_id": 6})
    problem = client.post("/api/requests/1/bridges", json={})
    assert problem.status_code == 409
    assert "singing" in problem.json()["detail"]


def test_a_song_already_in_the_mix_says_so(client):
    client.post("/api/requests", json={"song_id": 5})
    client.post("/api/mix/songs", json={"song_id": 5})
    problem = client.post("/api/requests/1/bridges", json={})
    assert problem.status_code == 409
    assert "already in your mix" in problem.json()["detail"]


def test_choosing_saves_those_exact_songs(client):
    client.post("/api/requests", json={"song_id": 5})
    saved = client.post("/api/requests/1/bridge", json={"allow": True, "songs": [4, 5]}).json()
    assert saved["requests"][0]["picked"] == [4, 5]
    assert saved["requests"][0]["bridge_choice"] is True


def test_saying_no_clears_what_was_chosen(client):
    client.post("/api/requests", json={"song_id": 5})
    client.post("/api/requests/1/bridge", json={"allow": True, "songs": [4, 5]})
    saved = client.post("/api/requests/1/bridge", json={"allow": False}).json()
    assert saved["requests"][0]["picked"] is None
    assert saved["requests"][0]["bridge_choice"] is False


@pytest.mark.parametrize(
    ("songs", "words"),
    [
        ([4], "make sense"),
        ([4, 5, 5], "make sense"),
        ([4, 4, 5], "make sense"),
        ([1, 5], "already in your mix"),
        ([6, 5], "Another request"),
        ([99, 5], "no longer in your library"),
    ],
)
def test_a_route_that_makes_no_sense_is_refused(client, songs, words):
    client.post("/api/requests", json={"song_id": 5})
    client.post("/api/requests", json={"song_id": 6})
    refused = client.post("/api/requests/1/bridge", json={"allow": True, "songs": songs})
    assert refused.status_code == 409
    assert words in refused.json()["detail"]


def test_two_requests_can_not_choose_the_same_bridge(client):
    client.post("/api/requests", json={"song_id": 5})
    client.post("/api/requests", json={"song_id": 6})
    assert (
        client.post("/api/requests/1/bridge", json={"allow": True, "songs": [4, 5]}).status_code
        == 200
    )
    refused = client.post("/api/requests/2/bridge", json={"allow": True, "songs": [4, 6]})
    assert refused.status_code == 409


def test_a_request_can_change_its_mind_about_its_own_bridge(client):
    client.post("/api/requests", json={"song_id": 5})
    client.post("/api/requests/1/bridge", json={"allow": True, "songs": [4, 5]})
    changed = client.post("/api/requests/1/bridge", json={"allow": True, "songs": [6, 5]})
    assert changed.json()["requests"][0]["picked"] == [6, 5]


def test_a_song_on_its_way_as_a_bridge_can_not_also_be_requested(client):
    client.post("/api/requests", json={"song_id": 5})
    client.post("/api/requests/1/bridge", json={"allow": True, "songs": [4, 5]})
    refused = client.post("/api/requests", json={"song_id": 4})
    assert refused.status_code == 400
    assert "bridge" in refused.json()["detail"]


def test_once_that_request_is_cancelled_it_can(client):
    client.post("/api/requests", json={"song_id": 5})
    client.post("/api/requests/1/bridge", json={"allow": True, "songs": [4, 5]})
    client.delete("/api/requests/1")
    assert client.post("/api/requests", json={"song_id": 4}).status_code == 200


# ---- rechecking


def test_a_song_put_in_the_mix_by_hand_settles_its_request(client, monkeypatch):
    client.post("/api/requests", json={"song_id": 5})
    client.post("/api/mix/songs", json={"song_id": 5})
    _plan(monkeypatch)
    answer = client.post(
        "/api/requests/consider",
        json={"order": [1, 2, 3, 5], "position": 0, "phase": "playing", "seconds_left": 100.0},
    ).json()
    assert answer["settled"] == ["Song 5"]
    assert answer["requests"] == []
    assert client.get("/api/requests").json()["requests"] == []


def test_each_request_counts_the_work_of_those_ahead_of_it(client, monkeypatch):
    client.post("/api/requests", json={"song_id": 4})
    client.post("/api/requests", json={"song_id": 5})

    def two(rows, *_a, **_k):
        return [
            {
                **row,
                "plan": {
                    "position": row["song_id"] - 2,
                    "songs": [row["song_id"]],
                    "bridges": [],
                    "seams": [{"move": "bass_swap_blend", "from_request": True}] * 2,
                },
            }
            for row in rows
        ]

    monkeypatch.setattr("selecta.request_planner.proposals", two)
    rows = client.post("/api/requests/consider", json=_playback()).json()["requests"]
    assert rows[1]["seconds"] > rows[0]["seconds"]


def test_transitions_a_plan_has_stopped_needing_are_withdrawn(client, monkeypatch):
    kept = []
    monkeypatch.setattr(SeamStore, "keep_requested", lambda _self, wanted: kept.append(set(wanted)))
    client.post("/api/requests", json={"song_id": 5})
    _plan(monkeypatch)
    row = _consider(client)
    assert kept[-1] == {seam["key"] for seam in row["transitions"]}
    client.delete("/api/requests/1")
    assert kept[-1] == set()


def test_what_someone_is_waiting_to_hear_is_not_withdrawn(stocked, monkeypatch):
    kept = []
    monkeypatch.setattr(SeamStore, "keep_requested", lambda _self, wanted: kept.append(set(wanted)))
    _search_plan(monkeypatch)
    key = stocked.post("/api/requests/1/bridges", json={}).json()["options"][0]["transitions"][0][
        "key"
    ]
    stocked.post("/api/requests/1/hear", json={"keys": [key]})
    _plan(monkeypatch)
    _consider(stocked)
    assert key in kept[-1]


def test_a_transition_with_nowhere_to_go_sends_the_request_somewhere_else(
    client, monkeypatch, tmp_path
):
    client.post("/api/requests", json={"song_id": 5})
    _plan(monkeypatch, seams=[{"move": "echo_out", "from_request": True, "leave_after": 150.0}] * 2)
    key = request_from(2, 5, {"move": "echo_out", "from_request": True, "leave_after": 150.0}).key
    folder = Settings(tmp_path).renders_dir / "seams" / key
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "seam.json").write_text(json.dumps({"status": "failed", "key": key}), "utf-8")
    assert _consider(client)["stage"] == "searching"


# ---- going past a way out


def test_going_past_the_way_out_makes_another_further_on(client):
    answer = client.post("/api/mix/1/leave-later", json={"after": 100.0}).json()
    assert answer["moved"] is True
    settings = answer["mix"][1]["seam"]["settings"]
    assert settings["leave_after"] == 130.0
    assert settings["soft"] is True


def test_a_slow_move_gives_way_to_a_quick_one(client):
    client.post("/api/mix/1/seam", json={"move": "vocal_ride"})
    answer = client.post("/api/mix/1/leave-later", json={"after": 100.0}).json()
    assert answer["mix"][1]["seam"]["settings"]["move"] == "echo_out"


def test_a_quick_move_stays(client):
    client.post("/api/mix/1/seam", json={"move": "delay_throw"})
    answer = client.post("/api/mix/1/leave-later", json={"after": 100.0}).json()
    assert answer["mix"][1]["seam"]["settings"]["move"] == "delay_throw"


def test_with_no_time_left_it_is_left_to_fade(client):
    answer = client.post("/api/mix/1/leave-later", json={"after": 175.0}).json()
    assert answer["moved"] is False
    assert "leave_after" not in answer["mix"][1]["seam"]["settings"]


def test_a_place_someone_chose_is_not_moved(client):
    client.post("/api/mix/1/seam", json={"move": "delay_throw", "exit_bar": 40})
    assert client.post("/api/mix/1/leave-later", json={"after": 100.0}).json()["moved"] is False


def test_a_transition_that_has_gone_says_so(client):
    assert client.post("/api/mix/9/leave-later", json={"after": 10.0}).status_code == 404
    assert client.post("/api/mix/0/leave-later", json={"after": 10.0}).status_code == 404


def test_what_has_already_played_is_not_waited_for(client, monkeypatch):
    client.post("/api/requests", json={"song_id": 5})
    _plan(monkeypatch, position=3)
    _consider(client, position=1)
    assert client.sent[-1][2] == [request_from(2, 3, None).key]


def test_a_bridge_needs_an_answer_and_nothing_renders_until_then(client, monkeypatch):
    client.post("/api/requests", json={"song_id": 5})
    _plan(monkeypatch, songs=(4, 5), bridges=(4,))
    before = len(client.sent)
    row = _consider(client)
    assert row["stage"] == "approve"
    assert row["needs_approval"] is True
    assert len(client.sent) == before


def test_a_yes_lasts_however_the_route_changes(client, monkeypatch):
    """The bug: each new route needed approving again, so it asked over and over."""
    request_id = client.post("/api/requests", json={"song_id": 5}).json()["id"]
    _plan(monkeypatch, songs=(4, 5), bridges=(4,))
    _consider(client)
    answer = client.post(f"/api/requests/{request_id}/bridge", json={"allow": True})
    assert answer.status_code == 200
    assert answer.json()["requests"][0]["bridge_choice"] is True
    assert _consider(client)["stage"] == "preparing"
    _plan(monkeypatch, songs=(5, 6), bridges=(6,), position=3)
    assert _consider(client)["stage"] == "preparing", "a different bridge, and no new question"


def test_a_yes_does_not_need_the_mix_to_be_playing(client):
    request_id = client.post("/api/requests", json={"song_id": 5}).json()["id"]
    answer = client.post(f"/api/requests/{request_id}/bridge", json={"allow": True})
    assert answer.status_code == 200


def test_a_no_keeps_it_waiting_for_a_direct_spot(client, monkeypatch):
    request_id = client.post("/api/requests", json={"song_id": 5}).json()["id"]
    client.post(f"/api/requests/{request_id}/bridge", json={"allow": False})
    _plan(monkeypatch, songs=(4, 5), bridges=(4,))
    before = len(client.sent)
    row = _consider(client)
    assert row["stage"] == "searching"
    assert row["declined"] is True
    assert len(client.sent) == before, "and nothing renders for a route it turned down"


def test_a_no_does_not_stop_a_direct_spot(client, monkeypatch):
    request_id = client.post("/api/requests", json={"song_id": 5}).json()["id"]
    client.post(f"/api/requests/{request_id}/bridge", json={"allow": False})
    _plan(monkeypatch)
    assert _consider(client)["stage"] == "preparing"


def test_answering_a_cancelled_request_says_so(client):
    request_id = client.post("/api/requests", json={"song_id": 5}).json()["id"]
    client.delete(f"/api/requests/{request_id}")
    answer = client.post(f"/api/requests/{request_id}/bridge", json={"allow": True})
    assert answer.status_code == 409


def test_hearing_a_route_renders_it_without_saying_yes(client, monkeypatch):
    request_id = client.post("/api/requests", json={"song_id": 5}).json()["id"]
    _plan(monkeypatch, songs=(4, 5), bridges=(4,))
    _consider(client)
    before = len(client.sent)
    assert client.post(f"/api/requests/{request_id}/hear").status_code == 200
    assert len(client.sent) == before + 3, "into the bridge, into the song, and back to the mix"
    assert all(after == [] for _, _, after in client.sent[before:])
    assert _consider(client)["stage"] == "approve", "still asking"


def test_hearing_a_route_that_has_gone_says_so(client):
    request_id = client.post("/api/requests", json={"song_id": 5}).json()["id"]
    assert client.post(f"/api/requests/{request_id}/hear").status_code == 409


def test_a_request_joins_and_is_marked_and_can_be_undone(client, monkeypatch, tmp_path):
    client.post("/api/requests", json={"song_id": 5})
    _plan(monkeypatch)
    _ready_all(client, tmp_path, [2, 5, 3])
    row = _consider(client)
    assert row["stage"] == "ready"
    joined = client.post("/api/requests/insert", json={**_playback(), "offer": row["offer"]})
    assert joined.status_code == 200
    mix = joined.json()["mix"]
    assert [item["song_id"] for item in mix] == [1, 2, 5, 3]
    assert mix[2]["from_request"] == {"kind": "requested"}
    assert "from_request" not in mix[1]
    assert client.get("/api/requests").json()["requests"] == []
    undone = client.post("/api/mix/undo").json()
    assert [item["song_id"] for item in undone["mix"]] == [1, 2, 3]
    assert not any("from_request" in item for item in undone["mix"])


def test_a_near_miss_can_join_but_a_real_failure_can_not(client, monkeypatch, tmp_path):
    client.post("/api/requests", json={"song_id": 5})
    _plan(monkeypatch)
    _ready_all(client, tmp_path, [2, 5, 3])
    states = Settings(tmp_path).renders_dir / "seams"
    for meta in states.glob("*/seam.json"):
        state = json.loads(meta.read_text("utf-8"))
        meta.write_text(json.dumps({**state, "passed": False, "near_miss": True}), "utf-8")
    assert _consider(client)["ready"] is True
    for meta in states.glob("*/seam.json"):
        state = json.loads(meta.read_text("utf-8"))
        meta.write_text(json.dumps({**state, "passed": False, "near_miss": False}), "utf-8")
    assert _consider(client)["ready"] is False


def test_a_seam_a_request_added_does_not_block_the_next_request(client, monkeypatch, tmp_path):
    client.post("/api/requests", json={"song_id": 5})
    _plan(monkeypatch)
    _ready_all(client, tmp_path, [2, 5, 3])
    row = _consider(client)
    joined = client.post("/api/requests/insert", json={**_playback(), "offer": row["offer"]})
    seam = [item["seam"]["settings"] for item in joined.json()["mix"][1:]]
    assert not any(song_requests.custom_seam(json.dumps(settings)) for settings in seam[1:])


def test_playing_it_anyway_goes_straight_after_the_next_song(client):
    request_id = client.post("/api/requests", json={"song_id": 5}).json()["id"]
    body = {"order": [1, 2, 3], "position": 0}
    answer = client.post(f"/api/requests/{request_id}/add", json=body)
    assert answer.status_code == 200
    mix = answer.json()["mix"]
    assert [item["song_id"] for item in mix] == [1, 2, 5, 3]
    assert mix[2]["from_request"] == {"kind": "requested"}
    assert mix[3]["seam"]["settings"] == {"move": "auto"}, "the new pair starts fresh"
    assert client.get("/api/requests").json()["requests"] == []


def test_playing_it_anyway_with_nothing_playing_goes_at_the_end(client):
    """The page sends an empty body when nothing is playing, and this used to be refused."""
    request_id = client.post("/api/requests", json={"song_id": 5}).json()["id"]
    answer = client.post(f"/api/requests/{request_id}/add", json={})
    assert answer.status_code == 200
    assert [item["song_id"] for item in answer.json()["mix"]] == [1, 2, 3, 5]


def test_playing_it_anyway_never_moves_a_locked_song(client):
    client.post("/api/mix/2/lock")
    request_id = client.post("/api/requests", json={"song_id": 5}).json()["id"]
    body = {"order": [1, 2, 3], "position": 0}
    answer = client.post(f"/api/requests/{request_id}/add", json=body)
    assert [item["song_id"] for item in answer.json()["mix"]] == [1, 2, 3, 5]


def test_playing_it_anyway_can_be_undone(client):
    request_id = client.post("/api/requests", json={"song_id": 5}).json()["id"]
    client.post(f"/api/requests/{request_id}/add", json={})
    undone = client.post("/api/mix/undo").json()
    assert [item["song_id"] for item in undone["mix"]] == [1, 2, 3]


def test_playing_it_anyway_needs_it_analysed(client):
    request_id = client.post("/api/requests", json={"song_id": 9}).json()["id"]
    assert client.post(f"/api/requests/{request_id}/add", json={}).status_code == 404


def test_playing_it_anyway_twice_is_refused_kindly(client):
    request_id = client.post("/api/requests", json={"song_id": 5}).json()["id"]
    client.post(f"/api/requests/{request_id}/add", json={})
    assert client.post(f"/api/requests/{request_id}/add", json={}).status_code == 409


def test_a_song_that_cannot_be_placed_says_so_even_when_nothing_is_playing(client):
    client.post("/api/requests", json={"song_id": 5})
    row = client.get("/api/requests").json()["requests"][0]
    assert row["no_cues"] is True, "analysed, but the library can't use it"


def test_a_song_still_being_analysed_is_told_apart(client, monkeypatch):
    monkeypatch.setattr(
        api_module.subprocess,
        "Popen",
        lambda *_a, **_k: SimpleNamespace(poll=lambda: None, wait=lambda: 0),
    )
    client.post("/api/requests", json={"song_id": 9})
    row = client.get("/api/requests").json()["requests"][0]
    assert row["waiting_on"] == "analysis"
    assert row["no_cues"] is False


def test_a_never_play_song_says_so(client, tmp_path):
    client.post("/api/requests", json={"song_id": 5})
    conn = db.connect(Settings(tmp_path).db_path)
    db.set_preference(conn, "never_play", [5])
    conn.close()
    assert client.get("/api/requests").json()["requests"][0]["never"] is True


# ---- new songs arriving


def _flac(path, title):
    import numpy as np
    import soundfile as sf
    from mutagen.flac import FLAC

    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, np.zeros((6000, 2)), 100, format="FLAC", subtype="PCM_16")
    tags = FLAC(path)
    tags["title"], tags["artist"] = title, f"{title} artist"
    tags.save()
    old = 1_000_000_000
    import os

    os.utime(path, (old, old))


@pytest.fixture
def library(tmp_path, monkeypatch):
    settings = Settings(tmp_path / "home")
    settings.home.mkdir()
    ran = []
    monkeypatch.setattr(
        api_module.subprocess, "run", lambda command, **_kwargs: ran.append(command)
    )
    monkeypatch.setattr(
        api_module._Background,
        "analyse",
        lambda self, *songs: ran.append(("analyse", songs)) or SimpleNamespace(poll=lambda: None),
    )
    root = tmp_path / "music"
    _flac(root / "one.flac", "One")
    conn = db.connect(settings.db_path)
    from selecta.library.scan import scan_folder

    scan_folder(conn, root)
    db.set_preference(conn, "library_folders", [str(root)])
    conn.close()
    return TestClient(create_app(settings, tmp_path / "no-web")), root, ran


def _wait_for(done, seconds=5.0):
    limit = time.monotonic() + seconds
    while time.monotonic() < limit:
        if done():
            return
        time.sleep(0.02)
    raise AssertionError("it never happened")


def test_new_songs_appear_before_their_lyrics_are_looked_up(library, monkeypatch):
    """Lyrics for a hundred songs take minutes, and that shouldn't hold up seeing them."""
    client, root, ran = library
    release = threading.Event()
    monkeypatch.setattr(api_module.subprocess, "run", lambda *_a, **_k: release.wait(5))
    _flac(root / "two.flac", "Two")
    assert client.post("/api/library/check").json() == {"new": 1}
    assert client.get("/api/status").json()["counts"]["total"] == 2
    release.set()
    # finish here, so it can't turn up in the next test
    _wait_for(lambda: any(step[0] == "analyse" for step in ran))


def test_nothing_new_does_nothing(library):
    client, _root, ran = library
    assert client.post("/api/library/check").json() == {"new": 0}
    assert ran == []
    assert client.get("/api/status").json()["new_songs"] is None


def test_a_new_song_joins_the_library_and_starts_being_analysed(library):
    client, root, ran = library
    _flac(root / "two.flac", "Two")
    assert client.post("/api/library/check").json() == {"new": 1}
    status = client.get("/api/status").json()
    assert status["new_songs"]["count"] == 1
    assert status["new_songs"]["first"] == "Two"
    _wait_for(lambda: any(step[0] == "analyse" for step in ran))
    assert any(isinstance(step, list) and "lyrics" in step for step in ran), "lyrics looked up"
    assert client.post("/api/library/check").json() == {"new": 0}, "and only once"


def test_a_new_song_respects_analysis_being_paused(library):
    client, root, ran = library
    client.post("/api/analysis/stop")
    _flac(root / "two.flac", "Two")
    assert client.post("/api/library/check").json() == {"new": 1}
    _wait_for(lambda: any(isinstance(step, list) and "lyrics" in step for step in ran))
    time.sleep(0.2)
    assert not any(step[0] == "analyse" for step in ran)
    client.post("/api/analysis/start")
    assert any(step[0] == "analyse" for step in ran), "until someone starts it again"


def test_an_unplugged_folder_loses_nothing(library, tmp_path):
    client, root, _ran = library
    root.rename(tmp_path / "away")
    assert client.post("/api/library/check").json() == {"new": 0}
    assert client.get("/api/status").json()["counts"]["total"] == 1
