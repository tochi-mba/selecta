import json
import sqlite3

import pytest

from selecta import db
from selecta.requests import (
    PlacementChanged,
    Slot,
    add_request,
    cancel_request,
    find_slot,
    fit_requests,
    insert_ready,
    read_requests,
)


def edges(*pairs):
    return lambda a, b: (a, b) in pairs


def test_request_waits_past_protected_audio_and_checks_return_to_mix():
    fits = edges((1, 9), (9, 2), (2, 9), (3, 9), (9, 4))
    assert find_slot([1, 2, 3, 4], 9, 1, fits) == Slot(3, (9,))


def test_unfitting_first_request_does_not_block_second():
    plans = fit_requests([1, 2, 3], [(10, 8), (11, 9)], 1, edges((2, 9), (9, 3)))
    assert plans == [(10, None), (11, Slot(2, (9,)))]


def test_direct_fit_later_beats_bridge_earlier():
    fits = edges((2, 8), (8, 9), (9, 3), (3, 9))
    assert find_slot([1, 2, 3], 9, 1, fits, bridge_songs=[8]) == Slot(3, (9,))


def test_bridge_can_lead_into_request_or_back_to_set():
    assert find_slot([1, 2, 3], 9, 1, edges((2, 8), (8, 9), (9, 3)), bridge_songs=[8]) == Slot(
        2, (8, 9), (8,)
    )
    assert find_slot([1, 2, 3], 9, 1, edges((2, 9), (9, 8), (8, 3)), bridge_songs=[8]) == Slot(
        2, (9, 8), (8,)
    )


def test_locks_custom_seams_duplicates_and_no_current_mix():
    def fits(a, b):
        return True

    assert find_slot([1, 2, 3], 9, 0, fits, locked=[2]) == Slot(3, (9,))
    assert find_slot([1, 2, 3], 9, 0, fits, custom_seams=[1, 2]) == Slot(3, (9,))
    assert find_slot([1, 2, 3], 2, 0, fits) is None
    assert find_slot([], 9, 0, fits) is None
    assert find_slot([1, 2], 9, -1, fits) is None
    assert find_slot([1, 2], 9, 2, fits) is None


def test_requests_survive_restart_deduplicate_and_cancel_without_changing_mix(tmp_path):
    path = tmp_path / "requests.sqlite"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE songs(id INTEGER PRIMARY KEY,is_music,duplicate_of,title,artist)")
    conn.execute("INSERT INTO songs VALUES(1,1,NULL,'Track','Artist')")
    conn.execute("CREATE TABLE queue(song_id)")
    conn.execute("INSERT INTO queue VALUES(99)")
    conn.commit()
    first = add_request(conn, 1)
    assert add_request(conn, 1) == first
    conn.close()
    conn = sqlite3.connect(path)
    assert [r["id"] for r in read_requests(conn)] == [first]
    assert cancel_request(conn, first)
    assert not cancel_request(conn, first)
    assert read_requests(conn) == []
    assert conn.execute("SELECT song_id FROM queue").fetchall() == [(99,)]
    assert add_request(conn, 1) != first
    conn.execute("DELETE FROM songs WHERE id=1")
    conn.commit()
    assert read_requests(conn)[0]["available"] == 0
    with pytest.raises(ValueError, match="still in your library"):
        add_request(conn, 1)
    conn.close()


def test_ready_insertion_is_atomic_and_rejects_stale_or_unapproved_plans(tmp_path):
    conn = db.connect(tmp_path / "insert.sqlite")
    for song in (1, 2, 3, 8, 9):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration) VALUES(?,?,?,?,?,?)",
            (song, str(song), "", 1, 0, 100),
        )
    before = [(1, None, 0), (2, None, 0), (3, None, 0)]
    conn.executemany(
        "INSERT INTO queue(position,song_id,seam,locked) VALUES(?,?,?,?)",
        [(i, *item) for i, item in enumerate(before)],
    )
    conn.commit()
    request = add_request(conn, 9)
    with pytest.raises(PlacementChanged, match="bridge"):
        insert_ready(conn, request, Slot(2, (8, 9), (8,)), before, 1, [{}, {}, {}])
    with pytest.raises(PlacementChanged, match="protected"):
        insert_ready(conn, request, Slot(2, (9,)), before, 2, [{}, {}])
    with pytest.raises(PlacementChanged, match="changed"):
        insert_ready(conn, request, Slot(2, (9,)), before[:-1], 1, [{}, {}])
    assert [
        tuple(r) for r in conn.execute("SELECT song_id,seam,locked FROM queue ORDER BY position")
    ] == before
    assert len(read_requests(conn)) == 1
    insert_ready(
        conn, request, Slot(2, (9,)), before, 1, [{"move": "vocal_ride"}, {"move": "filter_sweep"}]
    )
    assert [r[0] for r in conn.execute("SELECT song_id FROM queue ORDER BY position")] == [
        1,
        2,
        9,
        3,
    ]
    assert read_requests(conn) == []
    assert db.preference(conn, "mix_undo", [])[-1]["items"] == [list(item) for item in before]
    conn.close()


def test_evicted_request_audio_can_be_prepared_again_without_erasing_failures(tmp_path):
    from selecta.config import Settings
    from selecta.seams import SeamRequest, SeamStore

    store = SeamStore(Settings(tmp_path))
    request = SeamRequest(1, 2, "bass_swap_blend")
    folder = store.folder(request.key)
    folder.mkdir(parents=True)
    state = dict(
        key=request.key,
        status="ready",
        request={"move": request.move},
        style=request.move,
        passed=True,
        tried=[],
    )
    (folder / "seam.json").write_text(json.dumps(state))
    store._remember(state)
    store._states[request.key] = state
    assert store.forget_missing_audio(request.key)
    assert store.status(request.key)["status"] == "none"
    assert (tmp_path / "seam-history" / f"{request.key}.json").exists()
    (folder / "seam.json").write_text(json.dumps({**state, "status": "failed"}))
    assert not store.forget_missing_audio(request.key)
    assert store.status(request.key)["status"] == "failed"


def test_bridge_approval_survives_restart_but_cannot_transfer_to_a_changed_route(tmp_path):
    from selecta.requests import approve_bridge, bridge_approved

    path = tmp_path / "approval.sqlite"
    conn = db.connect(path)
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration) VALUES(1,?, ?,1,0,100)",
        ("track.wav", ""),
    )
    conn.commit()
    request = add_request(conn, 1)
    assert approve_bridge(conn, request, "exact-route-and-mix-snapshot")
    conn.close()
    conn = db.connect(path)
    assert bridge_approved(conn, request, "exact-route-and-mix-snapshot")
    assert not bridge_approved(conn, request, "different-route-or-mix")
    cancel_request(conn, request)
    assert not bridge_approved(conn, request, "exact-route-and-mix-snapshot")
    assert not approve_bridge(conn, request, "exact-route-and-mix-snapshot")
    conn.close()
