"""Requests in standing rooms: placing, voting, the staff queue, approval, expiry and the slot.

Part of `ZoneRooms`. A song can wait in a room only once (a unique index), so 40 guests asking
for one song make one request with 40 votes. Every request is checked against the venue's
content rules (ADR-0450) when it's placed, when staff approve it and when its slot comes up; a
refused one is withdrawn and the guest sees only "That one doesn't fit the music here right now".

Approvals are one conditional UPDATE (`status = 'sent'`), so two staff tapping at once resolve
to one approval; the other is told who got there first.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.access import BusinessActor, BusinessConflict, BusinessNotFound
from selecta.business.rooms import screen_code, settings
from selecta.business.rooms.errors import Refused
from selecta.business.rooms.ports import utc
from selecta.business.rooms.schema import WAITING_STATUSES
from selecta.business.rooms.schema import business_zone_room_guests as guests_t
from selecta.business.rooms.schema import business_zone_room_requests as requests_t
from selecta.business.rooms.schema import business_zone_room_votes as votes_t
from selecta.business.rooms.schema import business_zone_rooms as rooms_t
from selecta.persistence import new_id, transaction
from selecta.rooms.ordering import round_robin

ACCEPTED = ("approved", "played")


def _count(conn: Connection, *where) -> int:
    return conn.execute(sa.select(sa.func.count()).select_from(requests_t).where(*where)
                        ).scalar_one()


def decider(actor: BusinessActor) -> tuple[str, str, str]:
    kind = "device" if actor.kind == "device" else "person"
    name = actor.display_name or ("Shared device" if kind == "device" else "A teammate")
    return kind, actor.device_id or actor.id, name


class RequestsMixin:
    # ---- guests --------------------------------------------------------------------------

    def place(self, token: str, song_id: str, *, room_key: str | None = None,
              typed_screen_code: str | None = None) -> dict:
        with transaction(self.engine) as conn:
            guest, room = self.guest_row(conn, token, room_key)
            now = self.clock()
            self.expire_due(conn, room, now)
            state = self.room_state(conn, room, now)
            if not state.can_request:
                raise Refused(409, "requests_closed", state.text)
            if room["screen_code_on"] and self.flag_on("business.rooms.screen_code") and not (
                    screen_code.matches(room["screen_seed"], self.pepper, typed_screen_code, now)):
                raise Refused(403, "screen_code", settings.TEXT_SCREEN_CODE)
            song_id = str(song_id)
            waiting = conn.execute(sa.select(requests_t).where(
                requests_t.c.room_id == room["id"], requests_t.c.song_id == song_id,
                requests_t.c.status.in_(WAITING_STATUSES))).mappings().first()
            if waiting is not None:
                self._add_vote(conn, waiting, guest["id"], now)
                return {"request_id": waiting["id"], "became_vote": True}
            song = self.songs.facts(conn, room["workspace_id"], [song_id]).get(song_id)
            if song is None:
                raise Refused(404, "no_such_song", "That song isn't here.")
            decision = self.content.check(conn, room["zone_id"], song, utc(now),
                                          directory=self.directory)
            if not decision.allowed:
                raise Refused(409, "doesnt_fit", settings.TEXT_DOESNT_FIT)
            self._check_limits(conn, room, guest, song_id, now)
            mode = self._flood_check(conn, room, now)
            status = "sent"
            values = {}
            if mode == settings.AUTO_ACCEPT:
                if self.accepted_this_hour(conn, room, now) >= self.limits_of(room) \
                        .accepted_per_hour:
                    raise Refused(429, "room_busy", "The music has plenty of requests for now. "
                                  "Try again later.")
                status = "approved"
                values = {"decided_by_kind": "auto", "decided_at": now}
            request_id = new_id()
            try:
                with conn.begin_nested():
                    conn.execute(requests_t.insert().values(
                        id=request_id, workspace_id=room["workspace_id"],
                        organisation_id=room["organisation_id"], room_id=room["id"],
                        zone_id=room["zone_id"], guest_id=guest["id"], song_id=song_id,
                        title=song.title, artist=song.artist, status=status, votes=0,
                        created_at=now, snapshot_version=getattr(decision, "snapshot_version",
                                                                 None), **values))
            except sa.exc.IntegrityError:
                waiting = conn.execute(sa.select(requests_t).where(
                    requests_t.c.room_id == room["id"], requests_t.c.song_id == song_id,
                    requests_t.c.status.in_(WAITING_STATUSES))).mappings().one()
                self._add_vote(conn, waiting, guest["id"], now)
                return {"request_id": waiting["id"], "became_vote": True}
            self._add_vote(conn, {"id": request_id, **room_ids(room)}, guest["id"], now)
            return {"request_id": request_id, "became_vote": False, "status": status}

    def vote(self, token: str, request_id: str, *, room_key: str | None = None) -> dict:
        with transaction(self.engine) as conn:
            guest, room = self.guest_row(conn, token, room_key)
            found = conn.execute(sa.select(requests_t).where(
                requests_t.c.id == request_id, requests_t.c.room_id == room["id"],
                requests_t.c.status.in_(WAITING_STATUSES))).mappings().first()
            if found is None:
                raise Refused(404, "no_such_request", "That request has gone.")
            votes = self._add_vote(conn, found, guest["id"], self.clock())
            return {"request_id": request_id, "votes": votes}

    def _add_vote(self, conn: Connection, request, guest_id: str, now: float) -> int:
        try:
            with conn.begin_nested():
                conn.execute(votes_t.insert().values(
                    id=new_id(), workspace_id=request["workspace_id"],
                    organisation_id=request["organisation_id"], request_id=request["id"],
                    guest_id=guest_id, created_at=now))
        except sa.exc.IntegrityError:
            pass  # one vote per guest per request
        votes = conn.execute(sa.select(sa.func.count()).select_from(votes_t).where(
            votes_t.c.request_id == request["id"])).scalar_one()
        conn.execute(requests_t.update().where(requests_t.c.id == request["id"])
                     .values(votes=votes))
        return votes

    def _check_limits(self, conn: Connection, room, guest, song_id: str, now: float) -> None:
        lim = self.limits_of(room)
        rid = requests_t.c.room_id == room["id"]
        if _count(conn, rid, requests_t.c.song_id == song_id, requests_t.c.status == "played",
                  requests_t.c.resolved_at > now - lim.song_cooldown_min * 60):
            raise Refused(429, "cooldown", "That one played a little while ago. Try another.")
        if _count(conn, requests_t.c.guest_id == guest["id"],
                  requests_t.c.status.in_(WAITING_STATUSES)) >= lim.pending_per_guest:
            raise Refused(429, "guest_pending_limit",
                          "You've got a request waiting. Ask again once it's played.")
        if _count(conn, requests_t.c.guest_id == guest["id"],
                  requests_t.c.created_at > now - 3600) >= lim.per_guest_per_hour:
            raise Refused(429, "guest_hourly_limit", "That's plenty of requests for this hour.")
        if _count(conn, rid, requests_t.c.status.in_(WAITING_STATUSES)) >= lim.pending_in_zone:
            raise Refused(429, "room_busy", "Lots of requests are waiting. Try again soon.")

    def _flood_check(self, conn: Connection, room, now: float) -> str:
        """More than 3x the hourly accepted limit in 10 minutes: switch to staff approval."""
        mode = self.effective_mode(conn, room, now)
        if mode != settings.AUTO_ACCEPT:
            return mode
        recent = _count(conn, requests_t.c.room_id == room["id"],
                        requests_t.c.created_at > now - settings.FLOOD_WINDOW_S)
        if recent + 1 <= settings.FLOOD_FACTOR * self.limits_of(room).accepted_per_hour:
            return mode
        conn.execute(rooms_t.update().where(rooms_t.c.id == room["id"])
                     .values(flood_switched_at=now, updated_at=now))
        zone = self.directory.zone(conn, room["zone_id"])
        self.recorder.activity(
            conn, None, "rooms.flood_switch",
            f"Lots of requests arrived at once in {zone.name if zone else 'a zone'}, so "
            "requests there now wait for staff approval.",
            organisation_id=room["organisation_id"], workspace_id=room["workspace_id"],
            venue_id=room["venue_id"], zone_id=room["zone_id"],
        )
        return settings.STAFF_APPROVE

    def accepted_this_hour(self, conn: Connection, room, now: float) -> int:
        return _count(conn, requests_t.c.room_id == room["id"],
                      requests_t.c.status.in_(ACCEPTED), requests_t.c.decided_at > now - 3600)

    def expire_due(self, conn: Connection, room, now: float) -> int:
        cutoff = now - self.limits_of(room).expiry_min * 60
        return conn.execute(requests_t.update().where(
            requests_t.c.room_id == room["id"], requests_t.c.status == "sent",
            requests_t.c.created_at <= cutoff).values(status="expired", reason="expired",
                                                      resolved_at=now)).rowcount

    def approved_order(self, conn: Connection, room) -> list:
        rows = conn.execute(sa.select(requests_t).where(
            requests_t.c.room_id == room["id"], requests_t.c.status == "approved")
        ).mappings().all()
        return round_robin(
            rows, guest_of=lambda r: r["guest_id"],
            key=lambda r: (r["decided_at"] or r["created_at"], -r["votes"], r["created_at"],
                           r["id"]),
        )

    # ---- staff ---------------------------------------------------------------------------

    def queue(self, conn: Connection, actor: BusinessActor, zone_id: str) -> list[dict]:
        zone = self.scoped_zone(conn, actor, zone_id)
        room = self.ensure_room(conn, zone)
        now = self.clock()
        self.seen_staff(conn, actor, zone)
        self.expire_due(conn, room, now)
        rows = conn.execute(
            sa.select(requests_t, guests_t.c.nickname)
            .select_from(requests_t.join(guests_t, requests_t.c.guest_id == guests_t.c.id))
            .where(requests_t.c.room_id == room["id"], requests_t.c.status == "sent")
            .order_by(requests_t.c.votes.desc(), requests_t.c.created_at, requests_t.c.id)
        ).mappings().all()
        return [{"id": r["id"], "zone_id": zone.id, "title": r["title"], "artist": r["artist"],
                 "nickname": r["nickname"], "waited_seconds": int(now - r["created_at"]),
                 "votes": r["votes"]} for r in rows]

    def seen_staff(self, conn: Connection, actor: BusinessActor, zone) -> None:
        kind, actor_id, _name = decider(actor)
        self.presence.touch(conn, venue_id=zone.venue_id, workspace_id=zone.workspace_id,
                            organisation_id=zone.organisation_id, actor_kind=kind,
                            actor_id=actor_id, at=self.clock())

    def decide(self, conn: Connection, actor: BusinessActor, zone_id: str, request_id: str,
               verdict: str) -> dict:
        zone = self.scoped_zone(conn, actor, zone_id)
        room = self.ensure_room(conn, zone)
        now = self.clock()
        self.seen_staff(conn, actor, zone)
        self.expire_due(conn, room, now)
        found = conn.execute(sa.select(requests_t).where(
            requests_t.c.id == request_id, requests_t.c.room_id == room["id"])).mappings().first()
        if found is None:
            raise BusinessNotFound("There's no such request.")
        status = "approved" if verdict == "approve" else "passed"
        if status == "approved" and found["status"] == "sent":
            if self.accepted_this_hour(conn, room, now) >= self.limits_of(room) \
                    .accepted_per_hour:
                raise BusinessConflict("This zone has had its accepted requests for this hour.",
                                       code="hourly_limit")
            if not self._still_fits(conn, room, found, now):
                # Not raised: the withdrawal must commit. Staff may be told why; guests never.
                return {"id": request_id, "status": "withdrawn", "decided_by": None,
                        "message": "That song doesn't fit this zone's music rules right now, "
                                   "so it was withdrawn."}
        kind, actor_id, name = decider(actor)
        changed = conn.execute(requests_t.update().where(
            requests_t.c.id == request_id, requests_t.c.status == "sent").values(
            status=status, decided_by_kind=kind, decided_by_id=actor_id, decided_by_name=name,
            decided_at=now, resolved_at=None if status == "approved" else now)).rowcount
        if not changed:
            raise self._already(found["id"], conn)
        self.recorder.activity(
            conn, actor, f"rooms.request_{status}",
            f"{name} {'approved' if status == 'approved' else 'passed on'} "
            f"{found['title']} by {found['artist']}.",
            organisation_id=zone.organisation_id, workspace_id=zone.workspace_id,
            venue_id=zone.venue_id, zone_id=zone.id,
            metadata={"request_id": request_id, "song_id": found["song_id"]},
        )
        return {"id": request_id, "status": status, "decided_by": name}

    @staticmethod
    def _already(request_id: str, conn: Connection) -> BusinessConflict:
        row = conn.execute(sa.select(requests_t.c.status, requests_t.c.decided_by_name).where(
            requests_t.c.id == request_id)).one()
        who = row.decided_by_name or "someone"
        words = {"approved": f"Already approved by {who}", "passed": f"Already passed by {who}",
                 "played": "That one has played", "expired": "That request has expired",
                 "withdrawn": "That request was withdrawn"}
        return BusinessConflict(words.get(row.status, "That request has moved on"),
                                code=f"already_{row.status}")

    def _still_fits(self, conn: Connection, room, request, now: float) -> bool:
        song = self.songs.facts(conn, room["workspace_id"], [request["song_id"]]).get(
            request["song_id"])
        ok = song is not None and self.content.check(
            conn, room["zone_id"], song, utc(now), directory=self.directory).allowed
        if not ok:
            conn.execute(requests_t.update().where(requests_t.c.id == request["id"]).values(
                status="withdrawn", reason="content", resolved_at=now))
        return ok

    # ---- the planner ---------------------------------------------------------------------

    def slot_up(self, zone_id: str) -> dict | None:
        """The next approved request for the planner, re-checked now; refused ones are
        withdrawn on the way. Bridges the planner adds are its own allowed songs."""
        with transaction(self.engine) as conn:
            room = self.room_row(conn, zone_id)
            if room is None:
                return None
            now = self.clock()
            for row in self.approved_order(conn, room):
                if self._still_fits(conn, room, row, now):
                    return {"id": row["id"], "song_id": row["song_id"], "title": row["title"],
                            "artist": row["artist"], "votes": row["votes"]}
            return None

    def mark_played(self, zone_id: str, request_id: str) -> None:
        with transaction(self.engine) as conn:
            conn.execute(requests_t.update().where(
                requests_t.c.id == request_id, requests_t.c.zone_id == zone_id,
                requests_t.c.status == "approved").values(status="played",
                                                          resolved_at=self.clock()))


def room_ids(room) -> dict:
    return {"workspace_id": room["workspace_id"], "organisation_id": room["organisation_id"]}


__all__ = ["RequestsMixin", "decider"]
