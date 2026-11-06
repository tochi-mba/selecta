import json
import sqlite3

import pytest

from selecta import db
from selecta.requests import (
    PlacementChanged,
    Slot,
    add_request,
    bridge_choice,
    cancel_request,
    choose_bridge,
    custom_seam,
    find_slot,
    fit_requests,
    insert_ready,
    marks_for,
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


def test_an_answer_about_a_bridge_stands_however_the_route_changes(tmp_path):
    """Being asked again every time the mix moved on is what made this unusable."""
    path = tmp_path / "approval.sqlite"
    conn = db.connect(path)
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration) VALUES(1,?, ?,1,0,100)",
        ("track.wav", ""),
    )
    conn.commit()
    request = add_request(conn, 1)
    assert bridge_choice(conn, request) is None, "not asked yet"
    assert choose_bridge(conn, request, True)
    conn.close()
    conn = db.connect(path)
    assert bridge_choice(conn, request) is True, "and it's still yes after a restart"
    assert choose_bridge(conn, request, False)
    assert bridge_choice(conn, request) is False, "and a person can change their mind"
    cancel_request(conn, request)
    assert bridge_choice(conn, request) is None
    assert not choose_bridge(conn, request, True), "a cancelled request can't be answered"
    conn.close()


def test_leaving_a_seam_on_auto_is_not_choosing_it():
    assert not custom_seam(None)
    assert not custom_seam("{}")
    assert not custom_seam('{"move": "auto"}')
    assert not custom_seam('{"move": "auto", "soft": false}'), "what the page saves for Auto"
    assert not custom_seam('{"move": "echo_out", "soft": true}'), "planned, not chosen"
    assert not custom_seam('{"move": "echo_out", "from_request": true}'), "a request added it"
    assert not custom_seam("{not json")
    assert custom_seam('{"move": "echo_out"}')
    assert custom_seam('{"move": "echo_out", "soft": false}')


# ---- marks on songs a request added


def _mix_db(tmp_path, *songs):
    conn = db.connect(tmp_path / "marks.sqlite")
    for song in songs:
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,1)",
            (song, f"{song}.flac", "f", 1, 1.0, 200.0, f"Artist {song}", f"Song {song}"),
        )
    conn.commit()
    return conn


def _insert(conn, request_song, slot, order=(1, 2)):
    current = [(song, None, 0) for song in order]
    conn.executemany(
        "INSERT INTO queue(position,song_id,seam,locked) VALUES(?,?,?,?)",
        [(i, *item) for i, item in enumerate(current)],
    )
    conn.commit()
    request = add_request(conn, request_song)
    seams = [{"move": "bass_swap_blend"}] * (len(slot.songs) + int(slot.position < len(order)))
    insert_ready(conn, request, slot, current, 0, seams, approved_bridges=slot.bridges)


def test_a_song_a_request_added_is_marked(tmp_path):
    conn = _mix_db(tmp_path, 1, 2, 9)
    _insert(conn, 9, Slot(1, (9,)))
    assert marks_for(conn, [1, 9, 2]) == {9: {"kind": "requested"}}


def test_a_bridge_says_which_request_it_leads_to(tmp_path):
    conn = _mix_db(tmp_path, 1, 2, 8, 9)
    _insert(conn, 9, Slot(1, (8, 9), (8,)))
    marks = marks_for(conn, [1, 8, 9, 2])
    assert marks[9] == {"kind": "requested"}
    assert marks[8] == {"kind": "bridge", "for": "Song 9"}


def test_nothing_is_marked_before_it_has_joined(tmp_path):
    conn = _mix_db(tmp_path, 1, 2, 9)
    add_request(conn, 9)
    assert marks_for(conn, [1, 2]) == {}


def test_the_mark_stays_while_the_song_stays(tmp_path):
    conn = _mix_db(tmp_path, 1, 2, 9)
    _insert(conn, 9, Slot(1, (9,)))
    assert marks_for(conn, [9, 1, 2]) == {9: {"kind": "requested"}}, "moved, and still marked"
    assert marks_for(conn, [9, 1, 2]) == {9: {"kind": "requested"}}, "reading changes nothing"


def test_a_song_that_leaves_loses_its_mark_for_good(tmp_path):
    """The same song in a later mix wasn't requested, it was just chosen."""
    conn = _mix_db(tmp_path, 1, 2, 9)
    _insert(conn, 9, Slot(1, (9,)))
    assert marks_for(conn, [1, 2]) == {}
    assert marks_for(conn, [1, 2, 9]) == {}

