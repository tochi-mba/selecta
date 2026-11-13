"""ADR-0431 Autopilot moderated requests (AV-0431-01 to AV-0431-05)."""

from __future__ import annotations

import re
from pathlib import Path

from selecta import db
from selecta.requests import Slot, add_request, read_requests
from selecta.rooms.schema import REQUEST_STATUSES
from selecta.rooms.store import RequestStatus, RoomRequest
from selecta.venueops import venue_requests as vr

ROOT = Path(__file__).resolve().parents[1]


def req(rid: str, guest: str, *, at: float, status=RequestStatus.ACCEPTED, votes=0, song=1):
    return RoomRequest(
        id=rid, room_id="r", workspace_id="w", guest_id=guest, song_id=song,
        song_request_id=None, status=status, reason=None, votes=votes, created_at=at,
        approved_at=at, submitted_at=None, resolved_at=None,
    )


def test_status_mapping_is_one_to_one_and_complete():
    assert {s.value for s in vr.ROOM_TO_AUTOPILOT} == set(REQUEST_STATUSES)
    assert len(set(vr.ROOM_TO_AUTOPILOT.values())) == len(vr.ROOM_TO_AUTOPILOT)
    assert set(vr.ROOM_TO_AUTOPILOT.values()) == set(vr.AutopilotRequestStatus)
    for room in RequestStatus:
        assert vr.to_room(vr.to_autopilot(room)) is room
    assert vr.to_autopilot("sent") is vr.AutopilotRequestStatus.AWAITING_HOST


def test_every_rooms_control_is_kept():
    found = set()
    for name in ("api_host.py", "api_guest.py"):
        text = (ROOT / "src" / "selecta" / "rooms" / name).read_text("utf-8")
        found |= {(m.upper(), p) for m, p in re.findall(r'@app\.(\w+)\("([^"]+)"', text)}
    kept = {(c.method, c.path) for c in vr.ROOMS_CONTROLS}
    assert kept == found
    assert {c.who for c in vr.ROOMS_CONTROLS} == {"host", "guest", "display"}


def test_only_host_accepted_requests_are_planned():
    pool = [req("a", "g1", at=1, status=RequestStatus.SENT),
            req("b", "g2", at=2, status=RequestStatus.PASSED),
            req("c", "g3", at=3, status=RequestStatus.UNFIT),
            req("d", "g4", at=4)]
    assert [r.id for r in vr.plan_candidates(pool, slots=5, now=10)] == ["d"]


def test_fair_round_robin_cap_and_no_starvation():
    heavy = [req(f"h{i}", "heavy", at=i) for i in range(5)]
    late = req("x", "newcomer", at=50)
    picked = vr.plan_candidates([*heavy, late], slots=3, now=60, per_guest_cap=2)
    assert [r.id for r in picked] == ["h0", "x", "h1"]  # newcomer gets a turn in round one
    assert sum(r.guest_id == "heavy" for r in picked) == 2  # capped
    held = vr.plan_candidates([*heavy, late], slots=3, now=60, already={"heavy": 2},
                              per_guest_cap=2)
    assert [r.id for r in held] == ["x"]
    many = [req(f"g{i}", f"guest{i}", at=1000 + i) for i in range(5)]
    old = req("old", "patient", at=0)
    # The patient guest already holds a spot, so round-robin alone would put them last.
    waiting = vr.plan_candidates([*many, old], slots=1, now=1100, already={"patient": 1},
                                 per_guest_cap=2, max_wait=1800)
    assert [r.id for r in waiting] == ["g0"]
    starving = vr.plan_candidates([*many, old], slots=1, now=1900, already={"patient": 1},
                                  per_guest_cap=2, max_wait=1800)
    assert [r.id for r in starving] == ["old"]
    fresh = vr.plan_candidates([*many, req("o2", "p", at=999)], slots=1, now=1010,
                               max_wait=1800)
    assert fresh[0].id == "o2"  # oldest first anyway when nobody is starving
    assert vr.plan_candidates(heavy, slots=0, now=1) == []


def _mix(tmp_path):
    conn = db.connect(tmp_path / "venue.sqlite")
    for song in (1, 2, 3, 8, 9):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration) VALUES(?,?,?,?,?,?)",
            (song, str(song), "", 1, 0, 100),
        )
    before = ((1, None, 0), (2, None, 0), (3, None, 0))
    conn.executemany(
        "INSERT INTO queue(position,song_id,seam,locked) VALUES(?,?,?,?)",
        [(i, *item) for i, item in enumerate(before)],
    )
    conn.commit()
    return conn, before


def _queue(conn):
    rows = conn.execute("SELECT song_id,seam,locked FROM queue ORDER BY position")
    return [tuple(r) for r in rows]


def test_bridge_commits_as_one_unit_or_not_at_all(tmp_path):
    conn, before = _mix(tmp_path)
    request = add_request(conn, 9)
    unconsented = vr.BridgePlan(request, Slot(2, (8, 9), (8,)), before, 1, ({}, {}, {}))
    assert not vr.commit_bridge(conn, unconsented).committed
    missing_seam = vr.BridgePlan(request, Slot(2, (8, 9), (8,)), before, 1, ({}, {}), (8,))
    result = vr.commit_bridge(conn, missing_seam)
    assert not result.committed and "blend" in result.reason
    stale = vr.BridgePlan(request, Slot(2, (8, 9), (8,)), before[:2], 1, ({}, {}, {}), (8,))
    assert not vr.commit_bridge(conn, stale).committed
    assert _queue(conn) == list(before) and len(read_requests(conn)) == 1
    whole = vr.BridgePlan(request, Slot(2, (8, 9), (8,)), before, 1,
                          ({"move": "a"}, {"move": "b"}, {"move": "c"}), (8,))
    assert vr.commit_bridge(conn, whole).committed
    assert [row[0] for row in _queue(conn)] == [1, 2, 8, 9, 3]
    assert read_requests(conn) == []
    again = vr.commit_bridge(conn, whole)
    assert not again.committed  # a second commit of the same bridge changes nothing
    assert [row[0] for row in _queue(conn)] == [1, 2, 8, 9, 3]
    conn.close()


def test_honest_guest_outcomes():
    msg = vr.guest_message
    assert msg("sent").outcome is vr.GuestOutcome.QUEUED
    assert msg("accepted").outcome is vr.GuestOutcome.APPROVED
    assert msg("accepted", playing_next=True).words == "Playing next."
    assert msg("played").outcome is vr.GuestOutcome.PLAYED
    declined = msg("passed", "host")
    assert declined.outcome is vr.GuestOutcome.DECLINED and "host passed" in declined.words
    assert msg("unfit").outcome is vr.GuestOutcome.COULD_NOT_FIT
    assert msg("withdrawn", "guest").outcome is vr.GuestOutcome.WITHDRAWN
    gone = msg("withdrawn", "song_gone")
    assert gone.outcome is vr.GuestOutcome.DECLINED and "isn't available" in gone.words
    assert "room has ended" in msg("withdrawn", "room_ended").words
    for status in RequestStatus:
        words = msg(status, "host").words
        assert words and "—" not in words
    many = vr.guest_messages([req("a", "g", at=1), req("b", "g", at=2)], ["b"])
    assert many["a"].outcome is vr.GuestOutcome.APPROVED
    assert many["b"].outcome is vr.GuestOutcome.PLAYING_NEXT
