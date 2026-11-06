import sqlite3

import pytest

from selecta.requests import (
    Slot,
    add_request,
    cancel_request,
    find_slot,
    fit_requests,
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
    assert find_slot([1, 2, 3], 9, 1, edges((2, 8), (8, 9), (9, 3)),
                     bridge_songs=[8]) == Slot(2, (8, 9), (8,))
    assert find_slot([1, 2, 3], 9, 1, edges((2, 9), (9, 8), (8, 3)),
                     bridge_songs=[8]) == Slot(2, (9, 8), (8,))


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
    path = tmp_path / 'requests.sqlite'
    conn = sqlite3.connect(path)
    conn.execute('CREATE TABLE songs(id INTEGER PRIMARY KEY,is_music,duplicate_of,title,artist)')
    conn.execute("INSERT INTO songs VALUES(1,1,NULL,'Track','Artist')")
    conn.execute('CREATE TABLE queue(song_id)')
    conn.execute('INSERT INTO queue VALUES(99)')
    conn.commit()
    first = add_request(conn, 1)
    assert add_request(conn, 1) == first
    conn.close()
    conn = sqlite3.connect(path)
    assert [r['id'] for r in read_requests(conn)] == [first]
    assert cancel_request(conn, first)
    assert not cancel_request(conn, first)
    assert read_requests(conn) == []
    assert conn.execute('SELECT song_id FROM queue').fetchall() == [(99,)]
    assert add_request(conn, 1) != first
    conn.execute('DELETE FROM songs WHERE id=1')
    conn.commit()
    assert read_requests(conn)[0]['available'] == 0
    with pytest.raises(ValueError, match='still in your library'):
        add_request(conn, 1)
    conn.close()
