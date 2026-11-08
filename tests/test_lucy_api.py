"""Lucy's API end to end with the built-in Lucy: planning, critiques, questions, revisions,
exact approval and idempotent commits, settings and secrets, switches, memory and listening
history (ADR-0300, 0302, 0310, 0316, 0319, 0324..0327, 0330, 0331, 0334, 0338)."""

from __future__ import annotations

import json

from lucy_helpers import (
    approve,
    current,
    events,
    new_conversation,
    reply,
    say,
    snapshot,
    song_ids,
)

from selecta import db


def test_lucy_plans_a_proposal_that_is_not_built(lucy):
    before = lucy.get("/api/mix").json()["mix"]
    cid = new_conversation(lucy)
    snap = say(lucy, cid, "make me 6 songs that build up slowly, no Jo Marsh")
    revision = current(snap)
    assert len(song_ids(revision)) == 6
    titles = [song["title"] for song in revision["snapshot"]["songs"]]
    assert "Last Call" not in titles  # Jo Marsh's song
    labels = [rule["label"] for rule in revision["snapshot"]["constraints"]]
    assert {"6 songs", "Build up slowly", "No Jo Marsh"} <= set(labels)
    assert "proposed, not built" in reply(snap)["content"]
    assert lucy.get("/api/mix").json()["mix"] == before
    assert lucy.get("/api/drafts").json()["drafts"] == []
    assert snap["conversation"]["title"].startswith("make me 6 songs")


def test_questions_answer_without_writing_a_revision(lucy):
    cid = new_conversation(lucy)
    first = current(say(lucy, cid, "make me 5 songs"))
    snap = say(lucy, cid, "why did you pick these?")
    assert current(snap)["id"] == first["id"]
    assert "5 songs" in reply(snap)["content"]
    snap = say(lucy, cid, "how many songs are analysed?")
    assert "ready to mix" in reply(snap)["content"]
    assert len(snap["proposal"]["history"]) == 1


def test_critiques_change_as_little_as_possible(lucy):
    cid = new_conversation(lucy)
    one = current(say(lucy, cid, "make me 6 songs"))
    snap = say(lucy, cid, "remove the second one", one["id"])
    two = current(snap)
    assert song_ids(two) == [song_ids(one)[0]] + song_ids(one)[2:]
    kept = [s["occurrence"] for s in two["snapshot"]["songs"]]
    assert kept == [s["occurrence"] for s in one["snapshot"]["songs"] if s["occurrence"] in kept]
    assert two["snapshot"]["diff"]["counts"] == {"added": 0, "removed": 1, "replaced": 0,
                                                 "moved": 0, "kept": 5}
    counts = [r for r in two["snapshot"]["constraints"] if r["kind"] == "count"
              and r["status"] == "active"]
    assert counts[0]["value"] == 5  # the person's edit is the newer instruction
    three = current(say(lucy, cid, "swap song 3 for something calmer", two["id"]))
    removed_song = song_ids(one)[1]
    assert removed_song not in song_ids(three)  # taken out stays out
    assert three["snapshot"]["diff"]["counts"]["replaced"] == 1
    assert three["snapshot"]["diff"]["counts"]["kept"] == 4


def test_locked_songs_refuse_changes_until_unlocked(lucy):
    cid = new_conversation(lucy)
    one = current(say(lucy, cid, "make me 5 songs"))
    two = current(say(lucy, cid, "lock the first one", one["id"]))
    assert two["snapshot"]["songs"][0]["locked"]
    snap = say(lucy, cid, "remove the first one", two["id"])
    assert "locked" in reply(snap)["content"]
    assert current(snap)["id"] == two["id"]


def test_ambiguous_names_ask_instead_of_guessing(lucy):
    cid = new_conversation(lucy)
    snap = say(lucy, cid, "make 4 songs, start with Same Name")
    assert snap["proposal"] is None
    text = reply(snap)["content"]
    assert "Hal Greene" in text and "Iris Vale" in text


def test_direct_edits_rules_restore_branch_and_current(lucy):
    cid = new_conversation(lucy)
    one = current(say(lucy, cid, "make me 5 songs, no Jo Marsh"))
    occ = one["snapshot"]["songs"][0]["occurrence"]
    moved = lucy.post(f"/api/lucy/revisions/{one['id']}/edit",
                      json={"expected": one["id"], "op": {"op": "move", "occurrence": occ,
                                                          "to": 2}}).json()
    assert moved["snapshot"]["songs"][2]["occurrence"] == occ and moved["number"] == 2
    stale = lucy.post(f"/api/lucy/revisions/{one['id']}/edit",
                      json={"expected": one["id"], "op": {"op": "lock", "occurrence": occ}})
    assert stale.status_code == 409 and stale.json()["code"] == "stale_revision"
    rule = next(r for r in moved["snapshot"]["constraints"] if r["kind"] == "exclude_artist")
    relaxed = lucy.post(f"/api/lucy/revisions/{moved['id']}/rules/{rule['id']}/remove",
                        json={"expected": moved["id"]}).json()
    assert song_ids(relaxed) == song_ids(moved)
    assert all(r["status"] != "active" for r in relaxed["snapshot"]["constraints"]
               if r["id"] == rule["id"])
    restored = lucy.post(f"/api/lucy/revisions/{one['id']}/restore",
                         json={"expected": relaxed["id"]}).json()
    assert song_ids(restored) == song_ids(one) and restored["kind"] == "restore"
    branch = lucy.post(f"/api/lucy/revisions/{moved['id']}/branch",
                       json={"expected": restored["id"]}).json()
    assert branch["branch"].startswith("branch-") and branch["parent"] == moved["id"]
    proposal = snapshot(lucy, cid)["proposal"]["id"]
    back = lucy.post(f"/api/lucy/proposals/{proposal}/current",
                     json={"revision": one["id"], "expected": branch["id"]})
    assert back.status_code == 200 and back.json()["id"] == one["id"]
    diff = lucy.get(f"/api/lucy/revisions/{moved['id']}/diff?against={one['id']}").json()
    assert diff["counts"]["moved"] >= 1


def test_only_the_current_revision_can_be_approved_and_commits_are_idempotent(lucy):
    cid = new_conversation(lucy)
    one = current(say(lucy, cid, "make me 5 songs"))
    two = current(say(lucy, cid, "remove the last one", one["id"]))
    old = lucy.post("/api/lucy/approvals", json={"revision": one["id"], "hash": one["hash"],
                                                 "action": "draft"})
    assert old.status_code == 409 and old.json()["code"] == "not_current"
    wrong = lucy.post("/api/lucy/approvals", json={"revision": two["id"], "hash": "0" * 64,
                                                   "action": "draft"})
    assert wrong.status_code == 409 and wrong.json()["code"] == "stale_revision"
    granted = approve(lucy, two)
    assert granted["preflight"]["ok"] and granted["preflight"]["songs"] == 4
    body = {"token": granted["token"], "idempotency_key": "save-1"}
    first = lucy.post("/api/lucy/commits", json=body).json()
    again = lucy.post("/api/lucy/commits", json=body).json()
    assert first["status"] == "committed" and not first["repeat"]
    assert again["repeat"] and again["draft_id"] == first["draft_id"]
    assert lucy.get("/api/lucy/commits/save-1").json()["draft_id"] == first["draft_id"]
    assert lucy.get("/api/lucy/commits/never-sent").status_code == 404
    drafts = lucy.get("/api/drafts").json()["drafts"]
    assert len(drafts) == 1 and drafts[0]["songs"] == 4
    reused = lucy.post("/api/lucy/commits", json={"token": granted["token"],
                                                  "idempotency_key": "save-2"})
    assert reused.status_code == 409 and reused.json()["code"] == "used_token"
    draft = lucy.get(f"/api/mix?draft={first['draft_id']}").json()["mix"]
    assert [item["song_id"] for item in draft] == song_ids(two)
    for item, seam in zip(draft[1:], two["snapshot"]["seams"], strict=True):
        assert item["seam"]["state"]["key"] == seam["key"]  # the reviewed seams, exactly


def test_save_and_play_needs_its_own_confirmation(lucy):
    before = [item["song_id"] for item in lucy.get("/api/mix").json()["mix"]]
    cid = new_conversation(lucy)
    revision = current(say(lucy, cid, "make me 4 songs"))
    granted = approve(lucy, revision, "draft_and_play")
    refused = lucy.post("/api/lucy/commits", json={"token": granted["token"],
                                                   "idempotency_key": "p"})
    assert refused.status_code == 409 and refused.json()["code"] == "confirm_play"
    assert [item["song_id"] for item in lucy.get("/api/mix").json()["mix"]] == before
    granted = approve(lucy, revision, "draft_and_play")
    played = lucy.post("/api/lucy/commits", json={"token": granted["token"],
                                                  "idempotency_key": "p2",
                                                  "confirm_play": True}).json()
    assert played["played"] and played["current"]
    assert [item["song_id"] for item in lucy.get("/api/mix").json()["mix"]] == song_ids(revision)
    undone = lucy.post("/api/mix/undo").json()
    assert [item["song_id"] for item in undone["mix"]] == before


def test_a_crashed_commit_is_reconciled_by_looking_not_guessing(lucy, lucy_home):
    conn = db.connect(lucy_home / "selecta.sqlite")
    cid = new_conversation(lucy)
    revision = current(say(lucy, cid, "make me 3 songs"))
    conn.execute("INSERT INTO lucy_commits(idempotency_key,revision_id,hash,action,status,"
                 "result,created_at,updated_at) VALUES('lost',?,?,'draft','pending','{}',"
                 "'2020-01-01T00:00:00+00:00','2020-01-01T00:00:00+00:00')",
                 (revision["id"], revision["hash"]))
    conn.commit()
    found = lucy.get("/api/lucy/commits/lost").json()
    assert found["status"] == "failed" and "nothing was saved" in found["problems"][0]


def test_settings_keep_keys_on_the_server_and_need_consent(lucy, lucy_home):
    status = lucy.put("/api/lucy/settings", json={"provider": {
        "kind": "anthropic", "api_key": "sk-ant-secret"}}).json()
    assert status["provider"]["key_set"] and status["provider"]["mode"] == "unavailable"
    assert status["provider"]["model"] == "claude-opus-5-5"
    assert "sk-ant-secret" not in json.dumps(status)
    assert "sk-ant-secret" not in json.dumps(lucy.get("/api/lucy/status").json())
    conn = db.connect(lucy_home / "selecta.sqlite")
    assert "sk-ant-secret" not in json.dumps(
        [list(row) for row in conn.execute("SELECT * FROM preferences")])
    ready = lucy.put("/api/lucy/settings", json={"provider": {"consent": True}}).json()
    assert ready["provider"]["mode"] == "full" and ready["provider"]["consented"]
    sent = {item["id"]: item["sent"] for item in ready["privacy"]["data_classes"]}
    assert sent["messages"] and not sent["lyrics"] and not sent["history"]
    local = lucy.put("/api/lucy/settings", json={"provider": {
        "kind": "openai", "base_url": "http://localhost:11434/v1", "model": "llama3"}}).json()
    assert not local["provider"]["remote"] and local["provider"]["mode"] == "full"
    bad = lucy.put("/api/lucy/settings", json={"provider": {"base_url": "file:///etc"}})
    assert bad.status_code == 400


def test_turning_lucy_off_stops_writes_but_keeps_reading_and_mixing(lucy):
    cid = new_conversation(lucy)
    say(lucy, cid, "make me 3 songs")
    lucy.put("/api/lucy/settings", json={"enabled": False})
    sent = lucy.post(f"/api/lucy/conversations/{cid}/turns",
                     json={"client_id": "x", "text": "more"})
    assert sent.status_code == 403 and sent.json()["code"] == "lucy_off"
    assert lucy.get(f"/api/lucy/conversations/{cid}").status_code == 200
    assert lucy.post("/api/vibes/pick/build?count=4&as_draft=true").status_code in {200, 400}
    lucy.put("/api/lucy/settings", json={"enabled": True, "phases": {"commit": False}})
    revision = current(snapshot(lucy, cid))
    blocked = lucy.post("/api/lucy/approvals", json={"revision": revision["id"],
                                                     "hash": revision["hash"],
                                                     "action": "draft"})
    assert blocked.status_code == 403 and blocked.json()["code"] == "phase_off"


def test_listening_history_is_opt_in_and_counts_only_the_player(lucy):
    off = lucy.post("/api/listening/events", json={"song_id": 1, "session": "s",
                                                   "event": "complete", "heard": 80})
    assert off.json() == {"recorded": False}
    lucy.put("/api/lucy/settings", json={"phases": {"memory": True}})
    for _ in range(2):
        lucy.post("/api/listening/events", json={"song_id": 1, "session": "s",
                                                 "event": "complete", "heard": 80})
    lucy.post("/api/listening/events", json={"song_id": 2, "session": "s", "event": "skip",
                                             "heard": 5})
    preview = lucy.post("/api/listening/events", json={"song_id": 3, "session": "s",
                                                       "source": "preview", "event": "complete",
                                                       "heard": 90})
    assert preview.json() == {"recorded": False}
    memory = lucy.get("/api/lucy/memory").json()
    top = memory["history"]["top"]
    assert top[0]["song_id"] == 1 and top[0]["completes"] == 2
    assert next(row for row in top if row["song_id"] == 2)["skips"] == 1
    assert all(row["song_id"] != 3 for row in top)
    cleared = lucy.post("/api/lucy/memory/clear", json={"kind": "history"}).json()
    assert cleared["cleared"] == 3
    bad = lucy.post("/api/listening/events", json={"song_id": 1, "session": "s",
                                                   "event": "complete", "heard": -4})
    assert bad.status_code == 400


def test_memory_is_visible_editable_and_forgettable(lucy):
    fact = lucy.post("/api/lucy/memory", json={"subject": "Preference",
                                               "value": "No long intros"}).json()
    assert fact["kind"] == "explicit"
    edited = lucy.patch(f"/api/lucy/memory/{fact['id']}", json={"value": "Short intros"})
    assert edited.json()["value"] == "Short intros"
    memory = lucy.get("/api/lucy/memory").json()
    assert any(f["id"] == fact["id"] for f in memory["facts"])
    assert "Nothing" in memory["provider_receives"][0]
    assert lucy.delete(f"/api/lucy/memory/{fact['id']}").json() == {"forgotten": True}
    assert lucy.delete(f"/api/lucy/memory/{fact['id']}").status_code == 404
    cid = new_conversation(lucy)
    snap = say(lucy, cid, "remember that I love big piano endings")
    assert "keep that in mind" in reply(snap)["content"]
    remembered = lucy.get("/api/lucy/memory").json()["facts"]
    assert any("piano" in str(f["value"]) for f in remembered)


def test_conversations_list_rename_archive_branch_and_delete(lucy):
    cid = new_conversation(lucy)
    snap = say(lucy, cid, "make me 3 songs")
    renamed = lucy.patch(f"/api/lucy/conversations/{cid}", json={"title": "Sunday"}).json()
    assert renamed["title"] == "Sunday"
    message = reply(snap)["id"]
    branch = lucy.post(f"/api/lucy/conversations/{cid}/branch", json={"message": message}).json()
    branched = snapshot(lucy, branch["id"])
    assert song_ids(current(branched)) == song_ids(current(snap))
    lucy.patch(f"/api/lucy/conversations/{cid}", json={"archived": True})
    listed = [c["id"] for c in lucy.get("/api/lucy/conversations").json()["conversations"]]
    archived = [c["id"] for c in
                lucy.get("/api/lucy/conversations?archived=1").json()["conversations"]]
    assert cid not in listed and cid in archived
    assert lucy.delete(f"/api/lucy/conversations/{cid}").json()["drafts_kept"]
    assert lucy.get(f"/api/lucy/conversations/{cid}").status_code == 404


def test_scoped_conversations_read_the_mix_and_never_change_it(lucy):
    before = lucy.get("/api/mix").json()["mix"]
    cid = new_conversation(lucy, scope={"kind": "current", "occurrence": 1})
    snap = say(lucy, cid, "what do you think of this mix?")
    assert "That mix has 4 songs" in reply(snap)["content"]
    snap = say(lucy, cid, "improve this mix: remove the second one")
    assert len(song_ids(current(snap))) == 3
    assert lucy.get("/api/mix").json()["mix"] == before


def test_event_replay_and_snapshot_agree(lucy):
    cid = new_conversation(lucy)
    snap = say(lucy, cid, "make me 4 songs")
    replayed = events(lucy, cid)
    assert replayed[-1]["id"] == snap["cursor"]
    assert [e["id"] for e in replayed] == sorted(e["id"] for e in replayed)
    later = events(lucy, cid, after=replayed[3]["id"])
    assert later == replayed[4:]
    completed = [e for e in replayed if e["type"] == "message.completed"][-1]
    assert completed["payload"]["content"] == reply(snap)["content"]
    assert lucy.get("/api/lucy/conversations/cv_missing/events.json").status_code == 404
    assert lucy.get("/api/lucy/conversations/cv_missing/events").status_code == 404


def test_diagnostics_never_include_message_text(lucy):
    cid = new_conversation(lucy)
    say(lucy, cid, "make me 3 songs with a secret phrase zebra")
    text = json.dumps(lucy.get("/api/lucy/diagnostics").json())
    assert "zebra" not in text and '"state": "completed"' in text


def test_status_reports_versions_and_the_feature_flag(lucy):
    status = lucy.get("/api/lucy/status").json()
    assert status["event_schema"] == 1 and status["api_version"] >= 1
    assert status["provider"]["kind"] == "builtin" and status["provider"]["mode"] == "constrained"
    assert "lucy" in lucy.get("/api/status").json().get("features", ["lucy"])
