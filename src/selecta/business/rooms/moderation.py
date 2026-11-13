"""Abuse handling and guest data retention for standing rooms (ADR-0451, BZ-0451-09).

Part of `ZoneRooms`. Staff can remove a guest, ban one for a day or 7 days, and pause or resume
requests for a zone; pausing changes nothing else and resuming undoes it. Bans hold the guest's
token, and their address too unless the address is the venue's own network (banning that would
ban the whole bar). Guest data (the guest row, hashed address, nickname, requests and votes) is
deleted 30 days after the guest was last active in that room.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.access import BusinessActor, BusinessInvalid, BusinessNotFound
from selecta.business.rooms import network, settings
from selecta.business.rooms.requests import decider
from selecta.business.rooms.schema import business_zone_room_guests as guests_t
from selecta.business.rooms.schema import business_zone_room_requests as requests_t
from selecta.business.rooms.schema import business_zone_room_votes as votes_t
from selecta.business.rooms.schema import business_zone_rooms as rooms_t
from selecta.persistence import transaction

BAN_LENGTHS = {"day": settings.BAN_DAY_S, "week": settings.BAN_WEEK_S}


class ModerationMixin:
    def _guest_in(self, conn: Connection, room, guest_id: str):
        guest = conn.execute(sa.select(guests_t).where(
            guests_t.c.id == guest_id, guests_t.c.room_id == room["id"])).mappings().first()
        if guest is None:
            raise BusinessNotFound("There's no such guest.")
        return guest

    def _withdraw_waiting(self, conn: Connection, guest_id: str, now: float) -> None:
        conn.execute(requests_t.update().where(
            requests_t.c.guest_id == guest_id, requests_t.c.status == "sent").values(
            status="withdrawn", reason="removed", resolved_at=now))

    def remove_guest(self, conn: Connection, actor: BusinessActor, zone_id: str,
                     guest_id: str) -> dict:
        zone = self.scoped_zone(conn, actor, zone_id)
        room = self.ensure_room(conn, zone)
        guest = self._guest_in(conn, room, guest_id)
        now = self.clock()
        conn.execute(guests_t.update().where(guests_t.c.id == guest_id).values(status="removed"))
        self._withdraw_waiting(conn, guest_id, now)
        self._moderation_note(conn, actor, zone, "rooms.guest_removed",
                              f"{decider(actor)[2]} removed {guest['nickname']}.")
        return {"guest_id": guest_id, "status": "removed"}

    def ban_guest(self, conn: Connection, actor: BusinessActor, zone_id: str, guest_id: str,
                  length: str) -> dict:
        if length not in BAN_LENGTHS:
            raise BusinessInvalid("Ban for a day or for 7 days.", code="bad_ban")
        zone = self.scoped_zone(conn, actor, zone_id)
        room = self.ensure_room(conn, zone)
        guest = self._guest_in(conn, room, guest_id)
        now = self.clock()
        until = now + BAN_LENGTHS[length]
        own_network = guest["ip_hash"] and any(
            v == zone.venue_id for v, _w, _o in network.network_venues(conn, guest["ip_hash"]))
        conn.execute(guests_t.update().where(guests_t.c.id == guest_id).values(
            status="banned", banned_until=until,
            # On the venue's own Wi-Fi the address isn't a ban key; drop it from the row.
            ip_hash=None if own_network else guest["ip_hash"]))
        self._withdraw_waiting(conn, guest_id, now)
        self._moderation_note(conn, actor, zone, "rooms.guest_banned",
                              f"{decider(actor)[2]} banned {guest['nickname']} for "
                              f"{'a day' if length == 'day' else '7 days'}.")
        return {"guest_id": guest_id, "status": "banned", "banned_until": until}

    def set_paused(self, conn: Connection, actor: BusinessActor, zone_id: str,
                   paused: bool) -> dict:
        zone = self.scoped_zone(conn, actor, zone_id)
        room = self.ensure_room(conn, zone)
        conn.execute(rooms_t.update().where(rooms_t.c.id == room["id"]).values(
            paused=paused, updated_at=self.clock()))
        words = "paused requests" if paused else "turned requests back on"
        self._moderation_note(conn, actor, zone, "rooms.requests_paused" if paused else
                              "rooms.requests_resumed", f"{decider(actor)[2]} {words} in "
                              f"{zone.name}.")
        return {"zone_id": zone_id, "paused": paused}

    def _moderation_note(self, conn, actor, zone, kind: str, words: str) -> None:
        self.recorder.activity(conn, actor, kind, words, organisation_id=zone.organisation_id,
                               workspace_id=zone.workspace_id, venue_id=zone.venue_id,
                               zone_id=zone.id)

    def purge(self) -> int:
        """Delete guests idle in their room for 30 days, with their requests and votes."""
        cutoff = self.clock() - settings.GUEST_PURGE_S
        with transaction(self.engine) as conn:
            stale = sa.select(guests_t.c.id).where(guests_t.c.last_seen < cutoff)
            stale_requests = sa.select(requests_t.c.id).where(requests_t.c.guest_id.in_(stale))
            conn.execute(votes_t.delete().where(sa.or_(
                votes_t.c.guest_id.in_(stale), votes_t.c.request_id.in_(stale_requests))))
            conn.execute(requests_t.delete().where(requests_t.c.guest_id.in_(stale)))
            return conn.execute(guests_t.delete().where(guests_t.c.last_seen < cutoff)).rowcount


__all__ = ["BAN_LENGTHS", "ModerationMixin"]
