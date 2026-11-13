"""Venue networks and the join gate for standing rooms (ADR-0451, BZ-0451-07).

A whole bar of guests shares the venue's Wi-Fi, so they reach us from one public address. The
kiosk's public address, reported on its heartbeat, is recorded as that venue's **venue network**
(only as a keyed hash, `selecta.rooms.codes.hash_ip`). Then:

- Joins to that venue's rooms from its network count against a crowd window, 500 in 10 minutes
  per network, instead of ADR-0416's 10 a minute per address. The relaxation applies only to
  that venue's rooms (a venue on CGNAT shares its address with strangers).
- Wrong codes from any venue network never lock the address. They count against the visitor's
  own token (the `selecta_venue_visitor` cookie a miss hands out), and the tenth miss in ten
  minutes locks that token for 15 minutes and tells the venue's managers. A visitor who refuses
  cookies is never locked by address; the crowd window still caps them.
- Everywhere else the ADR-0416 rules hold: 10 joins a minute and 10 misses per 10 minutes per
  address, then a 15-minute lockout.
"""

from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.rooms.schema import business_venue_networks
from selecta.persistence import new_id
from selecta.rooms import limits

CROWD_JOINS = limits.Window(500, 600.0)
LOCK = "bz-join-locked"


def record_network(conn: Connection, *, venue_id: str, workspace_id: str, organisation_id: str,
                   address_hash: str, at: float) -> None:
    t = business_venue_networks
    updated = conn.execute(
        t.update().where(t.c.venue_id == venue_id, t.c.address_hash == address_hash)
        .values(seen_at=at)
    ).rowcount
    if not updated:
        conn.execute(t.insert().values(
            id=new_id(), workspace_id=workspace_id, organisation_id=organisation_id,
            venue_id=venue_id, address_hash=address_hash, seen_at=at,
        ))


def network_venues(conn: Connection, address_hash: str) -> list[tuple[str, str, str]]:
    """(venue id, workspace id, organisation id) of every venue whose network this is."""
    t = business_venue_networks
    rows = conn.execute(
        sa.select(t.c.venue_id, t.c.workspace_id, t.c.organisation_id)
        .where(t.c.address_hash == address_hash)
    ).all()
    return [tuple(row) for row in rows]


@dataclass(frozen=True)
class Miss:
    locked: bool  # the visitor (or address) is now locked out
    notify_venues: tuple[tuple[str, str, str], ...] = ()


class JoinGate:
    def __init__(self, limiter: limits.Limiter) -> None:
        self.limiter = limiter

    def check_locks(self, ip_hash: str, visitor: str | None) -> None:
        """Raise `limits.Limited` while this visitor's token or this address is locked out."""
        if visitor:
            self.limiter.check_lock(LOCK, "v:" + visitor)
        self.limiter.check_lock(LOCK, "ip:" + ip_hash)

    def admit(self, ip_hash: str, *, venue_id: str, on_venue_network: bool) -> None:
        if on_venue_network:
            self.limiter.hit("bz-join-crowd", f"{venue_id}:{ip_hash}", CROWD_JOINS)
        else:
            self.limiter.hit("bz-join", ip_hash, limits.JOIN_PER_IP)

    def missed(self, ip_hash: str, visitor: str | None,
               networks: list[tuple[str, str, str]]) -> Miss:
        window = limits.GUESSES_PER_IP
        if networks:
            if not visitor:
                return Miss(False)
            key = "v:" + visitor
            if self.limiter.count("bz-join-miss", key, window) >= window.limit:
                self.limiter.lock(LOCK, key, limits.GUESS_LOCKOUT_S)
                return Miss(True, tuple(networks))
            return Miss(False)
        key = "ip:" + ip_hash
        if self.limiter.count("bz-join-miss", key, window) >= window.limit:
            self.limiter.lock(LOCK, key, limits.GUESS_LOCKOUT_S)
            return Miss(True)
        return Miss(False)


__all__ = ["CROWD_JOINS", "JoinGate", "Miss", "network_venues", "record_network"]
