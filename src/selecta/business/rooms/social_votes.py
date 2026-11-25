"""Standing rooms: the vote for the next song, the day's recap and patron screens (ADR-0488).
Part of `ZoneRooms`; settings, plays, the pulse, reactions and dedications are in `social`.

The vote. In a venue the server offers the songs, because the venue's own content rules decide
what may play: every option has passed the zone's rules for this hour (blocklists, the explicit
filter, dayparts), so the winner needs no staff approval. It becomes an approved request asked
for by "the room" and is the next one the zone's player is given. Staff start and call off
votes; a zone can also start one by itself every so many songs. Counting and the tie-break are
`roomsocial.rounds`, the same as a party room's.

The recap. A standing room never ends, so "tonight in numbers" is the last trading stretch: the
hours since the zone last opened, eighteen at most. No guest and no staff name is in it.

Patron screens. A screen opens `/display` and shows a pairing code, exactly as for a party
room; staff type the code for a zone, and the screen then reads that zone's room. It counts as
showing only while it has looked in the last half minute, and nothing waits for it.
"""

from __future__ import annotations

import random
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.access import BusinessActor, BusinessConflict, BusinessNotFound
from selecta.business.rooms import branding
from selecta.business.rooms import social_schema as tables
from selecta.business.rooms.errors import Refused
from selecta.business.rooms.ports import utc
from selecta.business.rooms.schema import WAITING_STATUSES
from selecta.business.rooms.schema import business_zone_room_guests as guests_t
from selecta.business.rooms.schema import business_zone_room_requests as requests_t
from selecta.business.rooms.schema import business_zone_room_votes as votes_t
from selecta.persistence import new_id, transaction
from selecta.rooms import codes
from selecta.rooms.schema import display_pairings
from selecta.rooms.social_schema import crowd_marks
from selecta.roomsocial import recap as recap_rules
from selecta.roomsocial import rounds as rules

RESULT_S = 45.0
TIMER_FRESH_S = 20.0
RECAP_HOURS = 18
OFFERED = 3
FAR_FUTURE = 4102444800.0  # the room's own guest row is never idle


class VotesMixin:
    # ---- the vote ------------------------------------------------------------------------

    def _round(self, conn: Connection, row) -> dict[str, Any]:
        options = conn.execute(sa.select(tables.round_options).where(
            tables.round_options.c.round_id == row["id"]).order_by(
            tables.round_options.c.position)).mappings().all()
        status = None
        if row["winner_request_id"]:
            status = conn.execute(sa.select(requests_t.c.status).where(
                requests_t.c.id == row["winner_request_id"])).scalar()
        outcome = {None: row["outcome"], "sent": rules.WAITING, "approved": rules.WAITING,
                   "played": rules.IN_MIX}.get(status, rules.NOT_PLACED)
        return {
            "round_id": row["id"], "state": row["status"], "opened_by": row["opened_by"],
            "opened_at": row["opened_at"], "closes_at": row["closes_at"],
            "closed_at": row["closed_at"], "total": sum(o["votes"] for o in options),
            "options": [{"position": o["position"], "song_id": o["song_id"], "votes": o["votes"],
                         "song": {"song_id": 0, "title": o["title"], "artist": o["artist"],
                                  "length_s": 0}} for o in options],
            "winner": next((o["position"] for o in options
                            if o["song_id"] == row["winner_song_id"]), None),
            "outcome": outcome,
        }

    def _latest_round(self, conn: Connection, room):
        return conn.execute(sa.select(tables.rounds).where(
            tables.rounds.c.room_id == room["id"]).order_by(
            tables.rounds.c.opened_at.desc(), tables.rounds.c.id.desc()).limit(1)
        ).mappings().first()

    def _open_round(self, conn: Connection, room):
        return conn.execute(sa.select(tables.rounds).where(
            tables.rounds.c.room_id == room["id"], tables.rounds.c.status == rules.OPEN)
        ).mappings().first()

    def round_showing(self, conn: Connection, room, now: float) -> dict | None:
        row = self._latest_round(conn, room)
        if row is None:
            return None
        if row["status"] != rules.OPEN and now - (row["closed_at"] or 0.0) > RESULT_S:
            return None
        return self._round(conn, row)

    def _candidates(self, conn: Connection, room, now: float) -> list:
        """Up to three songs the zone may play now that nobody is waiting on and that have not
        just played, favouring what this zone's guests have loved, with some chance."""
        every = getattr(self.songs, "all", None)
        pool = every(conn, room["workspace_id"]) if every else self.songs.search(
            conn, room["workspace_id"], "", 2000)
        allowed = self.content.filter_allowed(conn, room["zone_id"], list(pool), utc(now),
                                              directory=self.directory)
        waiting = set(conn.execute(sa.select(requests_t.c.song_id).where(
            requests_t.c.room_id == room["id"],
            requests_t.c.status.in_(WAITING_STATUSES))).scalars())
        recent = {(row.title, row.artist) for row in conn.execute(sa.select(
            tables.plays.c.title, tables.plays.c.artist).where(
            tables.plays.c.room_id == room["id"]).order_by(
            tables.plays.c.started_at.desc()).limit(20))}
        local = getattr(self.songs, "local_id", None)
        loved: dict[int, int] = {}
        try:  # the crowd marks belong to the party rooms' tables, which may not be here
            with conn.begin_nested():
                loved = {int(row.song_id): int(row.rooms) for row in conn.execute(sa.select(
                    crowd_marks.c.song_id, crowd_marks.c.rooms).where(
                    crowd_marks.c.workspace_id == room["workspace_id"],
                    crowd_marks.c.zone_key == room["zone_id"],
                    crowd_marks.c.next_song_id == 0))}
        except sa.exc.SQLAlchemyError:
            pass

        def score(song) -> float:
            known = local(conn, room["workspace_id"], str(song.song_id)) if local else None
            return min(3, loved.get(known, 0)) + random.random()

        fit = [song for song in allowed if str(song.song_id) not in waiting
               and (song.title, song.artist) not in recent]
        return sorted(fit, key=score, reverse=True)[:OFFERED]

    def _start_round(self, conn: Connection, room, now: float, opened_by: str,
                     chosen: dict[str, Any]) -> dict | None:
        if self._open_round(conn, room) is not None:
            raise BusinessConflict("The room is already voting.", code="round_open")
        songs = self._candidates(conn, room, now)
        if len(songs) < rules.MIN_OPTIONS:
            return None
        round_id = new_id()
        ids = {"workspace_id": room["workspace_id"],
               "organisation_id": room["organisation_id"]}
        try:
            with conn.begin_nested():
                conn.execute(tables.rounds.insert().values(
                    id=round_id, room_id=room["id"], status=rules.OPEN, opened_by=opened_by,
                    opened_at=now, closes_at=now + float(chosen["round_seconds"]), **ids))
        except sa.exc.IntegrityError:
            raise BusinessConflict("The room is already voting.", code="round_open") from None
        for position, song in enumerate(songs):
            conn.execute(tables.round_options.insert().values(
                id=new_id(), round_id=round_id, position=position, song_id=str(song.song_id),
                title=song.title, artist=song.artist, votes=0, **ids))
        self.forget_pulse(room["id"])
        return self._round(conn, self._open_round(conn, room))

    def start_round(self, conn: Connection, actor: BusinessActor, zone_id: str) -> dict:
        zone = self.scoped_zone(conn, actor, zone_id)
        room = self.ensure_room(conn, zone)
        now = self.clock()
        chosen = self._need(conn, room, now, "rounds")
        self.settle_round(conn, room, now)
        started = self._start_round(conn, room, now, "host", chosen)
        if started is None:
            raise BusinessConflict("There aren't enough songs to vote on right now.",
                                   code="too_few_songs")
        return started

    def cancel_round(self, conn: Connection, actor: BusinessActor, zone_id: str,
                     round_id: str) -> dict:
        zone = self.scoped_zone(conn, actor, zone_id)
        room = self.ensure_room(conn, zone)
        conn.execute(tables.rounds.update().where(
            tables.rounds.c.id == round_id, tables.rounds.c.room_id == room["id"],
            tables.rounds.c.status == rules.OPEN).values(
            status=rules.CANCELLED, closed_at=self.clock(), outcome="called_off"))
        self.forget_pulse(room["id"])
        row = conn.execute(sa.select(tables.rounds).where(
            tables.rounds.c.id == round_id, tables.rounds.c.room_id == room["id"])
        ).mappings().first()
        if row is None:
            raise BusinessNotFound("There's no such vote.")
        return self._round(conn, row)

    def maybe_want_round(self, conn: Connection, room, now: float, online: int,
                         chosen: dict[str, Any]) -> None:
        """Start a vote by itself: the zone set "every N songs", two guests are here, nothing is
        open or still waiting to play, this song has just started and it is the Nth."""
        every = int(chosen["round_every_songs"])
        if every <= 0 or online < rules.MIN_VOTERS:
            return
        last = self._latest_round(conn, room)
        since = 0.0
        if last is not None:
            if last["status"] == rules.OPEN or self._round(conn, last)["outcome"] == rules.WAITING:
                return
            since = last["opened_at"]
        newest = conn.execute(sa.select(tables.plays.c.started_at).where(
            tables.plays.c.room_id == room["id"]).order_by(
            tables.plays.c.started_at.desc()).limit(1)).scalar()
        if newest is None or now - newest > TIMER_FRESH_S:
            return
        played = conn.execute(sa.select(sa.func.count()).select_from(tables.plays).where(
            tables.plays.c.room_id == room["id"],
            tables.plays.c.started_at > max(since, now - RECAP_HOURS * 3600))).scalar_one()
        if played >= every:
            try:
                self._start_round(conn, room, now, "timer", chosen)
            except BusinessConflict:
                pass  # another look started it

    def cast_round_vote(self, token: str, round_id: str, position: int, *,
                        room_key: str | None = None) -> dict[str, Any]:
        with transaction(self.engine) as conn:
            guest, room = self.guest_row(conn, token, room_key)
            now = self.clock()
            self._need(conn, room, now, "rounds")
            self.settle_round(conn, room, now)
            current = self._open_round(conn, room)
            if current is None or current["id"] != round_id or now >= current["closes_at"]:
                raise Refused(409, "no_round", "That vote has closed.")
            if guest["joined_at"] > current["opened_at"]:
                raise Refused(403, "joined_late", "This vote opened before you joined. "
                              "You can vote in the next one.")
            if conn.execute(sa.select(tables.round_options.c.id).where(
                    tables.round_options.c.round_id == round_id,
                    tables.round_options.c.position == position)).first() is None:
                raise Refused(422, "not_an_option", "That song isn't in this vote.")
            mine = (tables.round_votes.c.round_id == round_id,
                    tables.round_votes.c.guest_id == guest["id"])
            if not conn.execute(tables.round_votes.update().where(*mine).values(
                    position=position)).rowcount:
                try:
                    with conn.begin_nested():
                        conn.execute(tables.round_votes.insert().values(
                            id=new_id(), workspace_id=room["workspace_id"],
                            organisation_id=room["organisation_id"], round_id=round_id,
                            guest_id=guest["id"], position=position, created_at=now))
                except sa.exc.IntegrityError:
                    pass
            self._recount_round(conn, round_id)
            self.forget_pulse(room["id"])
            return {"round_id": round_id, "position": position,
                    "pulse": self.pulse(conn, room, now)}

    def _recount_round(self, conn: Connection, round_id: str) -> None:
        count = sa.select(sa.func.count()).select_from(tables.round_votes).where(
            tables.round_votes.c.round_id == tables.round_options.c.round_id,
            tables.round_votes.c.position == tables.round_options.c.position).scalar_subquery()
        conn.execute(tables.round_options.update().where(
            tables.round_options.c.round_id == round_id).values(votes=count))

    def my_round_vote(self, conn: Connection, guest, room) -> dict[str, Any]:
        current = self._open_round(conn, room)
        if current is None:
            return {}
        position = conn.execute(sa.select(tables.round_votes.c.position).where(
            tables.round_votes.c.round_id == current["id"],
            tables.round_votes.c.guest_id == guest["id"])).scalar()
        return {"my_vote": {"round_id": current["id"], "position": position,
                            "can_vote": guest["joined_at"] <= current["opened_at"]}}

    def _room_guest(self, conn: Connection, room, now: float) -> str:
        """The guest row that stands for the room itself as the asker of its picks."""
        kept = conn.execute(sa.select(tables.social.c.room_guest_id).where(
            tables.social.c.room_id == room["id"])).scalar()
        if kept and conn.execute(sa.select(guests_t.c.id).where(guests_t.c.id == kept)).first():
            return kept
        guest_id = new_id()
        conn.execute(guests_t.insert().values(
            id=guest_id, workspace_id=room["workspace_id"],
            organisation_id=room["organisation_id"], room_id=room["id"],
            token_hash=codes.token_hash(codes.new_token()), nickname="The room",
            status="removed", joined_at=now, last_seen=FAR_FUTURE))
        if not conn.execute(tables.social.update().where(
                tables.social.c.room_id == room["id"]).values(room_guest_id=guest_id)).rowcount:
            conn.execute(tables.social.insert().values(
                room_id=room["id"], workspace_id=room["workspace_id"],
                organisation_id=room["organisation_id"], settings={}, room_guest_id=guest_id,
                updated_at=now))
        return guest_id

    def settle_round(self, conn: Connection, room, now: float) -> None:
        """Close the open vote once its time is up and send its winner to the front of the
        zone's approved requests. Whoever looks first does it; the answer is the same."""
        current = self._open_round(conn, room)
        if current is None or now < current["closes_at"]:
            return
        options = [rules.Option(o["position"], o["song_id"], o["votes"]) for o in conn.execute(
            sa.select(tables.round_options).where(
                tables.round_options.c.round_id == current["id"])).mappings()]
        playable = [o.song_id for o in options if self._fits_now(conn, room, o.song_id, now)]
        won = rules.winner(current["id"], options, playable)
        values: dict[str, Any] = {"status": rules.VOID, "outcome": rules.void_reason(
            sum(o.votes for o in options))}
        if won is not None:
            waiting = conn.execute(sa.select(requests_t).where(
                requests_t.c.room_id == room["id"], requests_t.c.song_id == won.song_id,
                requests_t.c.status.in_(WAITING_STATUSES))).mappings().first()
            if waiting is not None:
                request_id = waiting["id"]
                conn.execute(requests_t.update().where(requests_t.c.id == request_id).values(
                    status="approved", decided_by_kind="auto", decided_at=0.0))
            else:
                option = conn.execute(sa.select(tables.round_options).where(
                    tables.round_options.c.round_id == current["id"],
                    tables.round_options.c.song_id == won.song_id)).mappings().one()
                request_id = new_id()
                # decided at the dawn of time, so it is the next one the player is given
                conn.execute(requests_t.insert().values(
                    id=request_id, workspace_id=room["workspace_id"],
                    organisation_id=room["organisation_id"], room_id=room["id"],
                    zone_id=room["zone_id"], guest_id=self._room_guest(conn, room, now),
                    song_id=won.song_id, title=option["title"], artist=option["artist"],
                    status="approved", votes=won.votes, decided_by_kind="auto", decided_at=0.0,
                    created_at=now))
            values = {"status": rules.CLOSED, "winner_song_id": won.song_id,
                      "winner_request_id": request_id, "outcome": rules.WAITING}
            zone = self.directory.zone(conn, room["zone_id"])
            self.recorder.activity(
                conn, None, "rooms.round_won",
                f"The room picked {option['title'] if waiting is None else waiting['title']} "
                "as the next song.",
                organisation_id=room["organisation_id"], workspace_id=room["workspace_id"],
                venue_id=room["venue_id"], zone_id=zone.id if zone else room["zone_id"])
        conn.execute(tables.rounds.update().where(
            tables.rounds.c.id == current["id"], tables.rounds.c.status == rules.OPEN).values(
            closed_at=now, **values))
        self.forget_pulse(room["id"])

    def forget_guest_social(self, conn: Connection, room, guest_id: str) -> None:
        """A guest staff removed or banned no longer has a say: their vote in the open round
        goes, and so do their taps, with the plays they were on counted again."""
        current = self._open_round(conn, room)
        if current is not None and conn.execute(tables.round_votes.delete().where(
                tables.round_votes.c.round_id == current["id"],
                tables.round_votes.c.guest_id == guest_id)).rowcount:
            self._recount_round(conn, current["id"])
        touched = set(conn.execute(sa.select(tables.reactions.c.play_id).where(
            tables.reactions.c.room_id == room["id"],
            tables.reactions.c.guest_id == guest_id)).scalars())
        if touched:
            conn.execute(tables.reactions.delete().where(
                tables.reactions.c.room_id == room["id"],
                tables.reactions.c.guest_id == guest_id))
            for kind, column in (("love", tables.plays.c.loves), ("blend", tables.plays.c.blends)):
                count = sa.select(sa.func.count()).select_from(tables.reactions).where(
                    tables.reactions.c.play_id == tables.plays.c.id,
                    tables.reactions.c.kind == kind).scalar_subquery()
                conn.execute(tables.plays.update().where(
                    tables.plays.c.id.in_(sorted(touched))).values({column.name: count}))
        self.forget_pulse(room["id"])

    def queue_dedications(self, conn: Connection, request_ids: list[str]) -> dict[str, str]:
        """The dedication on each of these requests, in words, for the staff queue."""
        from selecta.roomsocial import dedications as lines

        if not request_ids or not self.flag_on("business.rooms.dedications"):
            return {}
        return {row.request_id: lines.words_of(row.line) or "" for row in conn.execute(
            sa.select(tables.dedications.c.request_id, tables.dedications.c.line).where(
                tables.dedications.c.request_id.in_(request_ids)))}

    # ---- the recap -----------------------------------------------------------------------

    def recap(self, conn: Connection, room, now: float) -> dict[str, Any] | None:
        """The last trading stretch in numbers. Totals only: no guest, no staff name."""
        since = now - RECAP_HOURS * 3600
        rid = room["id"]
        zone = self.directory.zone(conn, room["zone_id"])

        def count(table, *where) -> int:
            return conn.execute(sa.select(sa.func.count()).select_from(table).where(
                table.c.room_id == rid, *where)).scalar_one()

        plays = tables.plays
        first = conn.execute(sa.select(sa.func.min(plays.c.started_at)).where(
            plays.c.room_id == rid, plays.c.started_at > since)).scalar()
        loved = conn.execute(sa.select(plays.c.title, plays.c.artist,
                                       sa.func.sum(plays.c.loves).label("loves")).where(
            plays.c.room_id == rid, plays.c.started_at > since).group_by(
            plays.c.title, plays.c.artist).order_by(
            sa.func.sum(plays.c.loves).desc()).limit(recap_rules.TOP_SONGS)).all()
        before = plays.alias("before")
        blend = conn.execute(sa.select(before.c.title.label("was"), plays.c.title,
                                       plays.c.blends).select_from(
            plays.join(before, before.c.id == plays.c.previous_play_id)).where(
            plays.c.room_id == rid, plays.c.started_at > since).order_by(
            plays.c.blends.desc()).limit(1)).first()
        room_guest = conn.execute(sa.select(tables.social.c.room_guest_id).where(
            tables.social.c.room_id == rid)).scalar() or ""
        asked = (requests_t.c.created_at > since, requests_t.c.guest_id != room_guest)
        round_votes = conn.execute(sa.select(sa.func.count()).select_from(
            tables.round_votes.join(tables.rounds,
                                    tables.rounds.c.id == tables.round_votes.c.round_id)).where(
            tables.rounds.c.room_id == rid, tables.rounds.c.opened_at > since)).scalar_one()
        request_votes = conn.execute(sa.select(sa.func.count()).select_from(
            votes_t.join(requests_t, requests_t.c.id == votes_t.c.request_id)).where(
            requests_t.c.room_id == rid, votes_t.c.created_at > since)).scalar_one()
        return recap_rules.build(
            name=zone.name if zone else "Tonight",
            started_at=first or since, ended_at=now,
            guests=count(guests_t, guests_t.c.last_seen > since, guests_t.c.id != room_guest),
            songs_played=count(plays, plays.c.started_at > since),
            requests_asked=count(requests_t, *asked),
            requests_played=count(requests_t, *asked, requests_t.c.status == "played"),
            votes=round_votes + request_votes,
            loved=[{"title": row.title, "artist": row.artist, "loves": int(row.loves or 0)}
                   for row in loved],
            blend=None if blend is None else {"from": blend.was, "to": blend.title,
                                              "loves": int(blend.blends or 0)},
            rounds=count(tables.rounds, tables.rounds.c.opened_at > since,
                         tables.rounds.c.status == rules.CLOSED),
        )

    def recap_view(self, conn: Connection, actor: BusinessActor, zone_id: str) -> dict:
        zone = self.scoped_zone(conn, actor, zone_id)
        room = self.ensure_room(conn, zone)
        built = self.recap(conn, room, self.clock())
        return {"recap": built, "lines": recap_rules.lines(built) if built else []}

    def guest_recap(self, token: str, room_key: str | None = None) -> dict[str, Any]:
        """A guest sees the recap once the zone has closed for the night."""
        with transaction(self.engine) as conn:
            _guest, room = self.guest_row(conn, token, room_key)
            now = self.clock()
            closed = self.room_state(conn, room, now).state == "closed"
            on = self.flag_on("business.rooms.recap") and self.social_of(conn, room)["recap"]
            built = self.recap(conn, room, now) if closed and on else None
            return {"recap": built, "lines": recap_rules.lines(built) if built else []}

    # ---- patron screens ------------------------------------------------------------------

    def screens(self, conn: Connection, room, now: float) -> list[dict[str, Any]]:
        rows = conn.execute(sa.select(tables.displays).where(
            tables.displays.c.room_id == room["id"]).order_by(tables.displays.c.paired_at)
        ).mappings().all()
        return [{"id": row["id"], "label": f"Screen {number}", "paired_at": row["paired_at"],
                 "last_seen_at": row["last_seen_at"],
                 "online": row["last_seen_at"] is not None
                 and now - row["last_seen_at"] <= 30.0}
                for number, row in enumerate(rows, start=1)]

    def screens_live(self, conn: Connection, room, now: float) -> int:
        if not self.flag_on("business.rooms.display"):
            return 0
        return sum(1 for screen in self.screens(conn, room, now) if screen["online"])

    def pair_screen(self, conn: Connection, actor: BusinessActor, zone_id: str,
                    pairing_code: str) -> dict:
        """Staff typed the code a screen is showing. The screen's waiting pairing is moved
        here, so its next look is this zone's room."""
        zone = self.scoped_zone(conn, actor, zone_id)
        room = self.ensure_room(conn, zone)
        now = self.clock()
        try:
            digest = codes.pairing_hash(pairing_code, self.pepper)
        except codes.InvalidCode:
            raise BusinessNotFound("That code isn't showing on any screen.") from None
        try:  # a screen's waiting pairing is kept with the party rooms' tables
            with conn.begin_nested():
                waiting = conn.execute(sa.select(display_pairings).where(
                    display_pairings.c.pairing_code_hash == digest,
                    display_pairings.c.room_id.is_(None),
                    display_pairings.c.expires_at > now)).mappings().first()
                if waiting is not None:
                    conn.execute(display_pairings.delete().where(
                        display_pairings.c.id == waiting["id"]))
        except sa.exc.SQLAlchemyError:
            waiting = None
        if waiting is None:
            raise BusinessNotFound("That code isn't showing on any screen.")
        conn.execute(tables.displays.insert().values(
            id=new_id(), workspace_id=room["workspace_id"],
            organisation_id=room["organisation_id"], room_id=room["id"],
            token_hash=waiting["token_hash"], paired_at=now))
        self.forget_pulse(room["id"])
        return {"screens": self.screens(conn, room, now)}

    def unpair_screen(self, conn: Connection, actor: BusinessActor, zone_id: str,
                      display_id: str) -> dict:
        zone = self.scoped_zone(conn, actor, zone_id)
        room = self.ensure_room(conn, zone)
        conn.execute(tables.displays.delete().where(
            tables.displays.c.id == display_id, tables.displays.c.room_id == room["id"]))
        self.forget_pulse(room["id"])
        return {"screens": self.screens(conn, room, self.clock())}

    def screen_view(self, display_token: str) -> dict[str, Any] | None:
        """What a patron screen shows, or None when this token is not a venue screen's."""
        if not display_token or not self.flag_on("business.rooms.display"):
            return None
        with transaction(self.engine) as conn:
            found = conn.execute(sa.select(tables.displays).where(
                tables.displays.c.token_hash == codes.token_hash(display_token))
            ).mappings().first()
            if found is None:
                return None
            now = self.clock()
            conn.execute(tables.displays.update().where(
                tables.displays.c.id == found["id"]).values(last_seen_at=now))
            from selecta.business.rooms.schema import business_zone_rooms as rooms_t

            room = conn.execute(sa.select(rooms_t).where(rooms_t.c.id == found["room_id"])
                                ).mappings().one()
            zone = self.directory.zone(conn, room["zone_id"])
            venue = self.directory.venue(conn, room["venue_id"]) if zone else None
            state = self.room_state(conn, room, now)
            code = self.code_of(room)
            pulse = self.pulse(conn, room, now)
            song = pulse["song"] if state.state in ("open", "music_paused") else None
            view: dict[str, Any] = {
                "state": "paired",
                "room_name": " · ".join(part for part in (
                    venue.name if venue else "", zone.name if zone else "") if part) or "Room",
                "code": codes.display(code),
                "join_path": f"/r/{code}?at=venue",
                "now_playing": song,
                "up_next": [],
                "upcoming": [
                    {"request_id": r["id"], "song": {"song_id": 0, "title": r["title"],
                                                     "artist": r["artist"], "length_s": 0},
                     "votes": r["votes"], "nickname": None}
                    for r in self.approved_order(conn, room)[:5]],
                "music_paused": state.state == "music_paused",
                "music": None,
                "pulse": pulse,
                "branding": branding.guest_branding(
                    venue_name=venue.name if venue else "", zone_name=zone.name if zone else "",
                    logo_url=room["logo_url"], welcome=room["welcome"], accent=room["accent"],
                    branding_on=self.flag_on("business.rooms.branding")),
            }
            if state.state == "closed" and pulse["shows"].get("recap") is not False \
                    and self.flag_on("business.rooms.recap") \
                    and self.social_of(conn, room)["screen_recap"]:
                built = self.recap(conn, room, now)
                if built:
                    view["state"] = "ended"
                    view["recap_lines"] = recap_rules.lines(built)
            return view

    def unpair_self(self, display_token: str) -> bool:
        with transaction(self.engine) as conn:
            return bool(conn.execute(tables.displays.delete().where(
                tables.displays.c.token_hash == codes.token_hash(display_token or ""))
            ).rowcount)

    # ---- retention -----------------------------------------------------------------------

    def purge(self) -> int:
        """A guest idle for 30 days takes their taps and votes with them; then the guest data
        itself goes, as before."""
        from selecta.business.rooms import settings

        cutoff = self.clock() - settings.GUEST_PURGE_S
        with transaction(self.engine) as conn:
            stale = sa.select(guests_t.c.id).where(guests_t.c.last_seen < cutoff)
            conn.execute(tables.reactions.delete().where(tables.reactions.c.guest_id.in_(stale)))
            conn.execute(tables.round_votes.delete().where(
                tables.round_votes.c.guest_id.in_(stale)))
            conn.execute(tables.dedications.delete().where(tables.dedications.c.request_id.in_(
                sa.select(requests_t.c.id).where(requests_t.c.guest_id.in_(stale)))))
            conn.execute(tables.plays.delete().where(
                tables.plays.c.started_at < cutoff))
        return super().purge()


__all__ = ["VotesMixin"]
