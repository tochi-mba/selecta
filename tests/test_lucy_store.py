"""Lucy's durable records: conversations, turn ordering, the event log, and immutable proposal
revisions with compare-and-swap and exact diffs (ADR-0302, 0303, 0323, 0325)."""

from __future__ import annotations

import pytest

from selecta import db
from selecta.lucy import conversations, events, proposals, schema


@pytest.fixture
def lconn(tmp_path):
    conn = db.connect(tmp_path / "selecta.sqlite")
    return schema.ensure(conn)


def snap(songs: list[tuple[str, int]], title: str = "Test") -> dict:
    return {
        "title": title,
        "ready_only": False,
        "songs": [{"occurrence": occ, "song_id": song, "locked": False, "title": f"S{song}"}
                  for occ, song in songs],
        "seams": [{"a_occ": a[0], "b_occ": b[0], "key": f"k{a[1]}-{b[1]}", "settings": {}}
                  for a, b in zip(songs, songs[1:], strict=False)],
        "constraints": [],
    }


def test_schema_is_additive_and_idempotent(lconn):
    schema.ensure(lconn)
    schema.ensure(lconn)
    tables = {row[0] for row in lconn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"lucy_conversations", "lucy_events", "lucy_revisions", "lucy_commits",
            "listening_events", "drafts", "queue", "songs"} <= tables


def test_turns_are_ordered_by_the_server_and_a_repeat_send_is_one_turn(lconn):
    cv = conversations.create(lconn)
    first, new = conversations.accept_turn(lconn, cv["id"], "client-a", "make a mix")
    again, repeat = conversations.accept_turn(lconn, cv["id"], "client-a", "make a mix")
    second, _ = conversations.accept_turn(lconn, cv["id"], "client-b", "now shorter")
    assert new and not repeat and again["id"] == first["id"]
    assert second["seq"] > first["seq"]
    assert conversations.turn_by_id(lconn, first["id"])["status"] == "superseded"
    users = [m for m in conversations.messages(lconn, cv["id"]) if m["role"] == "user"]
    assert [m["content"] for m in users] == ["make a mix", "now shorter"]
    assert conversations.get(lconn, cv["id"])["title"] == "make a mix"


def test_empty_and_overlong_messages_are_refused(lconn):
    cv = conversations.create(lconn)
    with pytest.raises(ValueError):
        conversations.accept_turn(lconn, cv["id"], "c", "   ")
    with pytest.raises(ValueError):
        conversations.accept_turn(lconn, cv["id"], "c", "x" * 5000)


def test_branch_copies_history_without_touching_the_original(lconn):
    cv = conversations.create(lconn, "Original")
    conversations.accept_turn(lconn, cv["id"], "a", "first")
    reply = conversations.add_message(lconn, cv["id"], "assistant", "answer one")
    conversations.accept_turn(lconn, cv["id"], "b", "second")
    before = conversations.messages(lconn, cv["id"])
    branch = conversations.branch(lconn, cv["id"], reply["id"])
    assert [m["content"] for m in conversations.messages(lconn, branch["id"])] == [
        "first", "answer one"]
    assert conversations.messages(lconn, cv["id"]) == before
    assert branch["parent_id"] == cv["id"]


def test_deleting_a_conversation_keeps_drafts(lconn):
    lconn.execute("INSERT INTO drafts(name,items) VALUES('Kept','[]')")
    lconn.commit()
    cv = conversations.create(lconn)
    events.append(lconn, cv["id"], "conversation.updated", {"title": "x"})
    result = conversations.delete(lconn, cv["id"])
    assert result["drafts_kept"]
    assert lconn.execute("SELECT COUNT(*) FROM drafts").fetchone()[0] == 1
    assert lconn.execute("SELECT COUNT(*) FROM lucy_events").fetchone()[0] == 0
    with pytest.raises(conversations.NotFound):
        conversations.get(lconn, cv["id"])


def test_search_finds_titles_and_message_text(lconn):
    one = conversations.create(lconn, "Sunday chill")
    two = conversations.create(lconn, "Party")
    conversations.add_message(lconn, two["id"], "user", "lots of afrobeats please")
    assert [c["id"] for c in conversations.listing(lconn, "afrobeats")] == [two["id"]]
    assert [c["id"] for c in conversations.listing(lconn, "sunday")] == [one["id"]]


def test_events_replay_in_order_from_any_cursor(lconn):
    cv = conversations.create(lconn)
    ids = [events.append(lconn, cv["id"], "message.delta", {"text": str(i)}) for i in range(5)]
    found = events.since(lconn, cv["id"], ids[1])
    assert [e["payload"]["text"] for e in found["events"]] == ["2", "3", "4"]
    assert found["cursor"] == ids[-1] and not found["gap"]
    assert all(e["v"] == 1 for e in found["events"])
    with pytest.raises(ValueError):
        events.append(lconn, cv["id"], "not.a.type", {})


def test_compacted_events_tell_an_old_cursor_to_take_a_snapshot(lconn):
    cv = conversations.create(lconn)
    for i in range(30):
        events.append(lconn, cv["id"], "message.delta", {"text": str(i)})
    events.append(lconn, cv["id"], "message.completed", {"content": "all"})
    removed = events.prune(lconn, cv["id"], keep=5)
    assert removed > 0
    old = events.since(lconn, cv["id"], 0)
    assert old["gap"]
    assert any(e["type"] == "message.completed" for e in old["events"])
    assert not events.since(lconn, cv["id"], events.latest_id(lconn, cv["id"]))["gap"]


def test_sse_frames_carry_resumable_ids(lconn):
    cv = conversations.create(lconn)
    events.append(lconn, cv["id"], "run.state", {"state": "queued"})
    text = events.sse(events.since(lconn, cv["id"], 0)["events"])
    assert text.startswith("id: ") and "event: lucy" in text and text.endswith("\n\n")


def test_revisions_are_immutable_hash_bound_and_compare_and_swap(lconn):
    cv = conversations.create(lconn)
    proposal = proposals.ensure_proposal(lconn, cv["id"])
    one = proposals.add_revision(lconn, proposal, snap([("o1", 1), ("o2", 2)]), kind="plan",
                                 expected_current=None)
    assert one["hash"] == proposals.snapshot_hash(one["snapshot"])
    two = proposals.add_revision(lconn, proposal, snap([("o1", 1), ("o3", 3)]), kind="revise",
                                 expected_current=one["id"])
    with pytest.raises(proposals.StaleRevision):
        proposals.add_revision(lconn, proposal, snap([("o9", 9)]), kind="revise",
                               expected_current=one["id"])
    assert proposals.get_revision(lconn, one["id"])["snapshot"] == one["snapshot"]
    assert proposals.current(lconn, proposal)["id"] == two["id"]
    assert [r["number"] for r in proposals.history(lconn, proposal)] == [2, 1]
    assert two["parent"] == one["id"]


def test_a_hash_changes_with_order_locks_seams_and_rules_but_not_display_text():
    base = snap([("a", 1), ("b", 2)])
    digest = proposals.snapshot_hash(base)
    renamed = {**base, "songs": [{**s, "title": "other"} for s in base["songs"]]}
    assert proposals.snapshot_hash(renamed) == digest
    locked = {**base, "songs": [{**base["songs"][0], "locked": True}, base["songs"][1]]}
    assert proposals.snapshot_hash(locked) != digest
    reordered = snap([("b", 2), ("a", 1)])
    assert proposals.snapshot_hash(reordered) != digest
    ruled = {**base, "constraints": [{"kind": "count", "target": "", "value": 2,
                                      "strength": "hard", "status": "active"}]}
    assert proposals.snapshot_hash(ruled) != digest


def test_set_current_moves_only_the_pointer_and_checks_what_was_seen(lconn):
    cv = conversations.create(lconn)
    proposal = proposals.ensure_proposal(lconn, cv["id"])
    one = proposals.add_revision(lconn, proposal, snap([("a", 1)]), kind="plan",
                                 expected_current=None)
    two = proposals.add_revision(lconn, proposal, snap([("b", 2)]), kind="plan",
                                 expected_current=one["id"])
    with pytest.raises(proposals.StaleRevision):
        proposals.set_current(lconn, proposal, one["id"], one["id"])
    proposals.set_current(lconn, proposal, one["id"], two["id"])
    assert proposals.current(lconn, proposal)["id"] == one["id"]


def test_diff_uses_occurrence_identity_not_titles_or_positions():
    before = snap([("a", 1), ("b", 2), ("c", 3), ("d", 4)])
    after = snap([("a", 1), ("x", 9), ("d", 4), ("c", 3)])
    change = proposals.diff(before, after)
    statuses = {item["occurrence"]: item["status"] for item in change["songs"]}
    assert statuses["x"] == "replaced"
    assert change["counts"]["replaced"] == 1 and change["counts"]["moved"] == 1
    assert change["counts"]["kept"] == 2
    # the same song twice is two occurrences: replacing one doesn't touch the other
    twice = snap([("p", 5), ("q", 5)])
    swapped = snap([("p", 5), ("r", 6)])
    assert proposals.diff(twice, swapped)["removed"][0]["occurrence"] == "q"
    assert proposals.summary_text(change).startswith("1 replaced")
