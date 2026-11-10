"""Long random parties (ADR-0416, docs/saas/18-test-plan.md §18.2 and §18.12): guests join, ask,
vote and leave, the host approves, passes, bans and ends rooms, the planner plays, refuses and
fails, and time passes. After every step the rules that must always hold are checked."""

from __future__ import annotations

from collections import Counter

import sqlalchemy as sa
from hypothesis import settings
from hypothesis import strategies as st
from hypothesis.stateful import RuleBasedStateMachine, invariant, rule, run_state_machine_as_test
from test_cloud_rooms_fakes import follow_clock, make_rooms

from selecta.persistence import new_id, transaction
from selecta.rooms import planning
from selecta.rooms.errors import RoomError
from selecta.rooms.schema import room_guests, room_requests, room_votes, rooms

SONGS = st.integers(1, 8)
PICK = st.integers(0, 50)


def test_random_parties_keep_every_room_rule(sqlite_engine, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    engine = sqlite_engine

    class Party(RuleBasedStateMachine):
        def __init__(self) -> None:
            super().__init__()
            self.host = new_id()
            self.rooms = make_rooms(engine)
            self.room_id: str | None = None
            self.code: str | None = None
            self.tokens: list[str] = []
            self.guest_ids: list[str] = []

        def _token(self, index: int) -> str | None:
            return self.tokens[index % len(self.tokens)] if self.tokens else None

        def _requests(self) -> list[dict]:
            with transaction(engine, self.host) as conn:
                return [
                    dict(row)
                    for row in conn.execute(
                        sa.select(room_requests).where(room_requests.c.workspace_id == self.host)
                    ).mappings()
                ]

        def _request_id(self, index: int) -> str | None:
            rows = self._requests()
            return rows[index % len(rows)]["id"] if rows else None

        # ---- the host

        @rule(
            mode=st.sampled_from(["auto", "approve"]),
            join=st.sampled_from(["anyone", "approve"]),
            votes=st.booleans(),
            renders=st.sampled_from([1, 2, 60]),
        )
        def open_room(self, mode, join, votes, renders) -> None:
            settings_ = {
                "request_mode": mode,
                "join_mode": join,
                "votes": votes,
                "renders_per_hour": renders,
                "pending_per_guest": 2,
                "pending_per_room": 5,
            }
            try:
                opened = self.rooms.open_room(self.host, "Party", settings_)
            except RoomError:
                return
            self.room_id, self.code = opened.room.id, opened.code

        @rule(request=PICK, approve=st.booleans())
        def decide(self, request: int, approve: bool) -> None:
            target = self._request_id(request)
            if self.room_id is None or target is None:
                return
            call = self.rooms.approve if approve else self.rooms.pass_request
            try:
                call(self.host, self.room_id, target)
            except RoomError:
                pass

        @rule(guest=PICK, how=st.sampled_from(["approve", "remove", "ban"]))
        def moderate(self, guest: int, how: str) -> None:
            if self.room_id is None or not self.guest_ids:
                return
            guest_id = self.guest_ids[guest % len(self.guest_ids)]
            call = {
                "approve": self.rooms.approve_guest,
                "remove": self.rooms.remove_guest,
                "ban": self.rooms.ban_guest,
            }[how]
            try:
                call(self.host, self.room_id, guest_id)
            except RoomError:
                pass

        @rule(change=st.sampled_from([{"votes": True}, {"votes": False}, {"request_mode": "auto"}]))
        def change_settings(self, change: dict) -> None:
            if self.room_id is not None:
                try:
                    self.rooms.update_settings(self.host, self.room_id, change)
                except RoomError:
                    pass

        @rule(remove_everyone=st.booleans())
        def new_code(self, remove_everyone: bool) -> None:
            if self.room_id is not None:
                try:
                    self.code = self.rooms.rotate_code(
                        self.host, self.room_id, remove_everyone=remove_everyone
                    )
                except RoomError:
                    pass

        @rule()
        def end_room(self) -> None:
            if self.room_id is not None:
                self.rooms.end_room(self.host, self.room_id)

        # ---- guests

        @rule(address=st.sampled_from([None, "a", "b"]))
        def join(self, address: str | None) -> None:
            if self.code is None:
                return
            ip_hash = self.rooms.hash_ip(address) if address else None
            try:
                joined = self.rooms.join(self.code, ip_hash)
            except RoomError:
                return
            self.tokens.append(joined.guest_token)
            self.guest_ids.append(joined.guest_id)

        @rule(guest=PICK, song=SONGS)
        def ask(self, guest: int, song: int) -> None:
            token = self._token(guest)
            if token is not None:
                try:
                    self.rooms.request(token, song)
                except RoomError:
                    pass

        @rule(guest=PICK, request=PICK, how=st.sampled_from(["vote", "unvote", "withdraw"]))
        def guest_acts(self, guest: int, request: int, how: str) -> None:
            token, target = self._token(guest), self._request_id(request)
            if token is None or target is None:
                return
            try:
                getattr(self.rooms, how)(token, target)
            except RoomError:
                pass

        # ---- the planner, the library and time

        @rule(request=PICK, outcome=st.sampled_from(["played", "unfit", "song_gone"]))
        def planner_reports(self, request: int, outcome: str) -> None:
            held = [row for row in self._requests() if row["song_request_id"]]
            if not held:
                return
            song_request_id = held[request % len(held)]["song_request_id"]
            if outcome == "played":
                self.rooms.planner.finish(song_request_id)
            self.rooms.record_outcome(self.host, song_request_id, outcome)

        @rule(song=SONGS)
        def song_removed(self, song: int) -> None:
            self.rooms.song_removed(self.host, song)

        @rule(fails=st.integers(0, 2))
        def planner_trouble(self, fails: int) -> None:
            self.rooms.planner.fail_next = fails

        @rule(seconds=st.sampled_from([1, 60, 600, 3601]))
        def time_passes(self, seconds: int) -> None:
            clock.advance(seconds)

        @rule()
        def sweep(self) -> None:
            self.rooms.expire_rooms()

        # ---- what must always be true

        @invariant()
        def every_rule_holds(self) -> None:
            requests = self._requests()
            with transaction(engine, self.host) as conn:
                votes = Counter(
                    conn.execute(
                        sa.select(room_votes.c.request_id).where(
                            room_votes.c.workspace_id == self.host
                        )
                    ).scalars()
                )
                guests = {
                    row.id: row.status
                    for row in conn.execute(
                        sa.select(room_guests.c.id, room_guests.c.status).where(
                            room_guests.c.workspace_id == self.host
                        )
                    )
                }
                room_rows = {
                    row["id"]: row
                    for row in conn.execute(
                        sa.select(rooms).where(rooms.c.workspace_id == self.host)
                    ).mappings()
                }
            live = [room for room in room_rows.values() if room["status"] != "ended"]
            assert len(live) <= 1, "one open room per workspace"
            waiting = Counter(
                (row["room_id"], row["song_id"])
                for row in requests
                if row["status"] in ("sent", "accepted", "unfit")
            )
            assert all(count == 1 for count in waiting.values()), "one waiting request per song"
            for row in requests:
                assert row["votes"] == votes[row["id"]], "the vote count matches the votes"
                if guests[row["guest_id"]] == "banned":
                    assert row["status"] not in ("sent", "accepted", "unfit"), (
                        "a banned guest has nothing waiting"
                    )
                room = room_rows[row["room_id"]]
                if room["status"] == "ended":
                    assert row["status"] != "sent", "an ended room has nothing to decide"
                    if row["status"] == "accepted":
                        assert row["song_request_id"], "only what the planner holds carries on"
            now = clock.now
            for room in room_rows.values():
                used = sum(
                    1
                    for row in requests
                    if row["room_id"] == room["id"]
                    and row["submitted_at"] is not None
                    and row["submitted_at"] > now - planning.RENDER_WINDOW_SECONDS
                )
                limit = room["settings"]["renders_per_hour"]
                assert used <= limit, "the render cap holds"
                if room["status"] == "ended":
                    assert room["code_hash"] is not None, "codes stay blocked after the end"

    examples = min(settings().max_examples, 30)
    run_state_machine_as_test(
        Party, settings=settings(max_examples=examples, stateful_step_count=30, deadline=None)
    )
