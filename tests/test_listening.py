import json
import sqlite3

import pytest

from selecta.listening import create_trials, public_trials, respond


def test_trials_hide_conditions_and_leave_unanswered_trials_unanswered():
    conn = sqlite3.connect(":memory:")
    ids = create_trials(
        conn, "held-out", [{"pair": "1-2", "conditions": ["adaptive", "baseline"]}], 42
    )
    public = public_trials(conn, "held-out")
    assert public == [{"id": ids[0], "options": ["a", "b"]}]
    assert "adaptive" not in json.dumps(public)
    assert conn.execute("SELECT COUNT(*) FROM listening_responses").fetchone()[0] == 0
    respond(conn, ids[0], "listener-1", "tie", "headphones")
    respond(conn, ids[0], "listener-1", "cannot_judge", "headphones")
    assert conn.execute("SELECT choice FROM listening_responses").fetchall() == [("cannot_judge",)]
    with pytest.raises(ValueError):
        respond(conn, ids[0], "listener-1", "adaptive", "headphones")
    with pytest.raises(ValueError):
        respond(conn, "missing", "listener-1", "a", "headphones")


def test_invalid_pairs_do_not_partially_create_a_study():
    conn = sqlite3.connect(":memory:")
    with pytest.raises(ValueError):
        create_trials(conn, "bad", [{"pair": "1-2", "conditions": ["same", "same"]}], 1)
    assert conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == []
