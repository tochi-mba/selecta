"""Guests of standing rooms: joining by code, the guest page's state and song search.

Part of `ZoneRooms`. A guest is an anonymous token (only its SHA-256 is stored), a generated
nickname and a keyed hash of their address. Everything a guest receives is built here, from a
short allow list of fields: the venue's and zone's names, the branding, the honest state, songs
(title, artist, length) and the guest's own requests. Never staff names, other venues, billing,
licence or device state.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.rooms import branding, network, settings
from selecta.business.rooms.errors import Refused, unavailable
from selecta.business.rooms.ports import utc
from selecta.business.rooms.schema import business_zone_room_guests as guests_t
from selecta.business.rooms.schema import business_zone_room_requests as requests_t
from selecta.business.rooms.schema import business_zone_room_retired_codes as retired
from selecta.business.rooms.schema import business_zone_rooms as rooms_t
from selecta.persistence import new_id, transaction
from selecta.rooms import codes, limits, nicknames

STATUS_TEXT = {
    "sent": settings.TEXT_WAITING,
    "approved": settings.TEXT_COMING_UP,
    "passed": settings.TEXT_NOT_THIS_TIME,
    "expired": settings.TEXT_NOT_THIS_TIME,
    "withdrawn": settings.TEXT_DOESNT_FIT,
    "played": settings.TEXT_PLAYED,
}


@dataclass(frozen=True)
class Joined:
    room_id: str
    token: str
    nickname: str


@dataclass(frozen=True)
class RoomState:
    state: str  # unavailable | closed | off | paused | music_paused | open
    text: str
    can_request: bool


class GuestsMixin:
    def hash_ip(self, ip: str) -> str:
        return codes.hash_ip(ip, self.pepper)

    def record_kiosk_address(self, conn: Connection, zone_id: str, ip: str) -> None:
        zone = self.zone(conn, zone_id)
        network.record_network(conn, venue_id=zone.venue_id, workspace_id=zone.workspace_id,
                               organisation_id=zone.organisation_id,
                               address_hash=self.hash_ip(ip), at=self.clock())

    # ---- joining ------------------------------------------------------------------------

    def join(self, code_text: str, ip: str, *, visitor: str | None = None,
             existing_token: str | None = None) -> Joined:
        ip_hash = self.hash_ip(ip)
        try:
            self.gate.check_locks(ip_hash, visitor)
        except limits.Limited as error:
            raise Refused(429, "rate_limited", "That's a lot of tries. Wait a moment and try "
                          "again.", retry_after_s=error.retry_after_s) from error
        with transaction(self.engine) as conn:
            row = self._room_by_code(conn, code_text)
            if row is None:
                refusal = self._miss(conn, ip_hash, visitor)  # notices commit with this
        if row is None:
            raise refusal
        with transaction(self.engine) as conn:
            if row == "retired":
                raise Refused(410, "code_changed", settings.TEXT_CODE_CHANGED)
            on_network = any(v == row["venue_id"] for v, _w, _o in
                             network.network_venues(conn, ip_hash))
            try:
                self.gate.admit(ip_hash, venue_id=row["venue_id"], on_venue_network=on_network)
            except limits.Limited as error:
                raise Refused(429, "rate_limited", "Lots of people are joining. Try again in a "
                              "moment.", retry_after_s=error.retry_after_s) from error
            zone = self.directory.zone(conn, row["zone_id"])
            if zone is None or not row["requests_on"]:
                raise unavailable()
            return self._admit_guest(conn, row, ip_hash, on_network, existing_token)

    def _room_by_code(self, conn: Connection, code_text: str):
        try:
            code_hash = codes.code_hash(code_text, self.pepper)
        except codes.InvalidCode:
            return None
        row = conn.execute(sa.select(rooms_t).where(rooms_t.c.code_hash == code_hash)
                           ).mappings().first()
        if row is not None:
            return row
        old = conn.execute(sa.select(retired.c.id).where(retired.c.code_hash == code_hash)).first()
        return "retired" if old else None

    def _miss(self, conn: Connection, ip_hash: str, visitor: str | None) -> Refused:
        networks = network.network_venues(conn, ip_hash)
        fresh = None if visitor or not networks else codes.new_token()
        miss = self.gate.missed(ip_hash, visitor, networks)
        for venue_id, workspace_id, organisation_id in miss.notify_venues:
            self.recorder.activity(
                conn, None, "rooms.code_guessing",
                "A phone on your Wi-Fi kept typing wrong room codes. It is locked out for "
                "15 minutes; everyone else can still join.",
                organisation_id=organisation_id, workspace_id=workspace_id, venue_id=venue_id,
            )
        return Refused(404, "no_such_room", "That code doesn't match a room. Check it and try "
                       "again.", visitor=fresh)

    def _admit_guest(self, conn: Connection, room, ip_hash: str, on_network: bool,
                     existing_token: str | None) -> Joined:
        now = self.clock()
        if existing_token:
            mine = conn.execute(sa.select(guests_t).where(
                guests_t.c.token_hash == codes.token_hash(existing_token),
                guests_t.c.room_id == room["id"])).mappings().first()
            if mine is not None and self._banned(mine, now):
                raise Refused(403, "banned", "You can't join this room right now.")
            if mine is not None and mine["status"] == "active":
                return Joined(room["id"], existing_token, mine["nickname"])
        if not on_network:
            banned = conn.execute(sa.select(guests_t.c.id).where(
                guests_t.c.room_id == room["id"], guests_t.c.ip_hash == ip_hash,
                guests_t.c.status == "banned", guests_t.c.banned_until > now)).first()
            if banned:
                raise Refused(403, "banned", "You can't join this room right now.")
        present = conn.execute(sa.select(sa.func.count()).select_from(guests_t).where(
            guests_t.c.room_id == room["id"], guests_t.c.status == "active",
            guests_t.c.last_seen > now - settings.GUEST_ACTIVE_S)).scalar_one()
        if present >= self.limits_of(room).guests_at_once:
            raise Refused(403, "room_full", "This room is full right now. Try again later.")
        taken = set(conn.execute(sa.select(guests_t.c.nickname).where(
            guests_t.c.room_id == room["id"])).scalars())
        token, nickname = codes.new_token(), nicknames.unique(taken)
        conn.execute(guests_t.insert().values(
            id=new_id(), workspace_id=room["workspace_id"],
            organisation_id=room["organisation_id"], room_id=room["id"],
            token_hash=codes.token_hash(token), nickname=nickname, ip_hash=ip_hash,
            status="active", joined_at=now, last_seen=now,
        ))
        return Joined(room["id"], token, nickname)

    @staticmethod
    def _banned(guest, now: float) -> bool:
        return guest["status"] == "banned" and (guest["banned_until"] or 0) > now

    # ---- the guest page ------------------------------------------------------------------

    def guest_row(self, conn: Connection, token: str, room_key: str | None = None):
        guest = conn.execute(sa.select(guests_t).where(
            guests_t.c.token_hash == codes.token_hash(token or ""))).mappings().first()
        now = self.clock()
        if guest is None or guest["status"] == "removed":
            raise Refused(401, "not_a_guest", "Scan the code again to join this room.")
        if self._banned(guest, now):
            raise Refused(403, "banned", "You can't make requests here right now.")
        room = conn.execute(sa.select(rooms_t).where(rooms_t.c.id == guest["room_id"])
                            ).mappings().one()
        if room_key is not None and not self._names_room(conn, room, room_key):
            raise Refused(401, "not_a_guest", "Scan the code again to join this room.")
        values = {"last_seen": now}
        if guest["status"] == "banned":
            values["status"] = "active"  # the ban ran out
        conn.execute(guests_t.update().where(guests_t.c.id == guest["id"]).values(**values))
        return guest, room

    def _names_room(self, conn: Connection, room, key: str) -> bool:
        """A guest's routes may name the room by id, its code, or a code it had before."""
        if key == room["id"]:
            return True
        try:
            code_hash = codes.code_hash(key, self.pepper)
        except codes.InvalidCode:
            return False
        if code_hash == room["code_hash"]:
            return True
        return conn.execute(sa.select(retired.c.id).where(
            retired.c.code_hash == code_hash, retired.c.room_id == room["id"])).first() is not None

    def room_state(self, conn: Connection, room, now: float) -> RoomState:
        zone = self.directory.zone(conn, room["zone_id"])
        if zone is None or not room["requests_on"] or not self.flag_on("business.rooms"):
            return RoomState("unavailable", settings.TEXT_UNAVAILABLE, False)
        at = utc(now)
        if not self.hours.is_open(conn, zone.id, at):
            nxt = self.hours.next_open(conn, zone.id, at)
            if nxt is None:
                return RoomState("closed", settings.TEXT_UNAVAILABLE, False)
            local = nxt.astimezone(ZoneInfo(zone.time_zone)).strftime("%H:%M")
            return RoomState("closed", settings.opens_at_text(local), False)
        mode = self.effective_mode(conn, room, now)
        if mode == settings.OFF:
            return RoomState("off", settings.TEXT_OFF, False)
        if room["paused"] or (mode == settings.STAFF_APPROVE and not self._staff_here(
                conn, zone.venue_id, now)):
            return RoomState("paused", settings.TEXT_PAUSED, False)
        if self.playback.state(conn, zone.id).paused:
            return RoomState("music_paused", settings.TEXT_MUSIC_PAUSED, True)
        return RoomState("open", settings.TEXT_OPEN, True)

    def _staff_here(self, conn: Connection, venue_id: str, now: float) -> bool:
        seen = self.presence.last_seen(conn, venue_id)
        return seen is not None and now - seen <= settings.STAFF_ABSENT_S

    def guest_state(self, token: str, room_key: str | None = None) -> dict:
        with transaction(self.engine) as conn:
            guest, room = self.guest_row(conn, token, room_key)
            now = self.clock()
            self.expire_due(conn, room, now)
            state = self.room_state(conn, room, now)
            zone = self.directory.zone(conn, room["zone_id"])
            venue = self.directory.venue(conn, room["venue_id"]) if zone else None
            shown = state.state in ("open", "music_paused", "paused", "off")
            payload = {
                "room_id": room["id"],
                "state": state.state,
                "text": state.text,
                "can_request": state.can_request,
                "needs_screen_code": bool(room["screen_code_on"])
                and self.flag_on("business.rooms.screen_code"),
                "nickname": guest["nickname"],
                "branding": branding.guest_branding(
                    venue_name=venue.name if venue else "", zone_name=zone.name if zone else "",
                    logo_url=room["logo_url"], welcome=room["welcome"], accent=room["accent"],
                    branding_on=self.flag_on("business.rooms.branding"),
                ),
                "now_playing": None, "coming_up": [], "my_requests": [],
            }
            if not shown:
                return payload  # nothing about what played is shown outside opening hours
            playing = self.playback.state(conn, room["zone_id"]).now_playing
            if playing:
                payload["now_playing"] = {k: playing.get(k) for k in ("title", "artist",
                                                                      "length_s")}
            payload["coming_up"] = [
                {"request_id": r["id"], "title": r["title"], "artist": r["artist"],
                 "votes": r["votes"], "mine": r["guest_id"] == guest["id"]}
                for r in self.approved_order(conn, room)
            ]
            mine = conn.execute(sa.select(requests_t).where(
                requests_t.c.guest_id == guest["id"]).order_by(requests_t.c.created_at.desc())
                .limit(10)).mappings().all()
            payload["my_requests"] = [
                {"request_id": r["id"], "title": r["title"], "artist": r["artist"],
                 "status": r["status"], "text": STATUS_TEXT[r["status"]], "votes": r["votes"]}
                for r in mine
            ]
            return payload

    def search(self, token: str, query: str, *, room_key: str | None = None,
               limit: int = 20) -> list[dict]:
        with transaction(self.engine) as conn:
            _guest, room = self.guest_row(conn, token, room_key)
            if not self.room_state(conn, room, self.clock()).can_request:
                return []
            found = self.songs.search(conn, room["workspace_id"], (query or "")[:100],
                                      limit * 3)
            allowed = self.content.filter_allowed(conn, room["zone_id"], list(found),
                                                  utc(self.clock()), directory=self.directory)
            return [{"song_id": str(s.song_id), "title": s.title, "artist": s.artist,
                     "length_s": getattr(s, "length_s", None)} for s in allowed[:limit]]


def local_time(at: datetime, tz: str) -> str:
    return at.astimezone(ZoneInfo(tz)).strftime("%H:%M")


__all__ = ["GuestsMixin", "Joined", "RoomState", "STATUS_TEXT"]
