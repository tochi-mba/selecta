"""Fenced speaker leases: only one speaker plays a zone at a time (ADR-0429 AV-0429-03).

A speaker may play a zone only while it holds that zone's lease. Every lease carries a fencing
token that only ever goes up, across the whole table and across releases, so a token is never
reused. Each audio command a speaker sends carries its token; the table refuses any token that is
not the current one. That way a speaker that froze, lost the network or slept and then woke up
with an old lease is fenced out: its late commands are refused instead of playing over the new
holder.

Leases expire unless renewed. A takeover (staff moving the music, or the night recovering from a
dead speaker) issues a fresh, higher token and invalidates the old holder at once, even before the
old lease would have expired.

The device ideas come from `selecta.playback.devices`: a device that can't play audio can only be
a remote, so it can never hold a speaker lease. This module stays in memory on purpose; the venue
night owns one table and persists its snapshot with the rest of the night's state.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from selecta import flags

FLAG = "venue.continuity"
DEFAULT_TTL_S = 15.0  # a speaker renews every few seconds; a silent one loses the zone quickly


class LeaseError(RuntimeError):
    """A lease operation that can't be honoured."""


class LeaseHeld(LeaseError):
    def __init__(self, zone_id: str, holder: str) -> None:
        self.zone_id = zone_id
        self.holder = holder
        super().__init__(f"Zone {zone_id!r} is already playing on {holder!r}.")


class StaleLease(LeaseError):
    """A speaker used a token that is no longer the zone's current one."""

    def __init__(self, zone_id: str, token: int, current: int | None) -> None:
        self.zone_id = zone_id
        self.token = token
        self.current = current
        super().__init__(
            f"Speaker lease {token} for zone {zone_id!r} is no longer valid"
            + (f" (current is {current})." if current is not None else " (no current lease).")
        )


class NotASpeaker(LeaseError):
    def __init__(self, speaker_id: str) -> None:
        super().__init__(f"{speaker_id!r} can't play audio, so it can only be a remote.")


@dataclass(frozen=True)
class Lease:
    zone_id: str
    holder: str
    token: int
    granted_at: float
    expires_at: float

    def live(self, now: float) -> bool:
        return now < self.expires_at


@dataclass(frozen=True)
class LeaseEvent:
    at: float
    kind: str  # "granted", "renewed", "released", "expired", "taken_over", "fenced"
    zone_id: str
    holder: str
    token: int
    detail: str = ""


@dataclass
class LeaseTable:
    ttl_s: float = DEFAULT_TTL_S
    _next_token: int = 1
    _leases: dict[str, Lease] = field(default_factory=dict)
    events: list[LeaseEvent] = field(default_factory=list)

    def _issue(self, zone_id: str, holder: str, now: float, kind: str, detail: str = "") -> Lease:
        lease = Lease(zone_id, holder, self._next_token, now, now + self.ttl_s)
        self._next_token += 1
        self._leases[zone_id] = lease
        self.events.append(LeaseEvent(now, kind, zone_id, holder, lease.token, detail))
        return lease

    def _expire(self, zone_id: str, now: float) -> None:
        lease = self._leases.get(zone_id)
        if lease is not None and not lease.live(now):
            del self._leases[zone_id]
            self.events.append(LeaseEvent(now, "expired", zone_id, lease.holder, lease.token))

    def current(self, zone_id: str, now: float) -> Lease | None:
        self._expire(zone_id, now)
        return self._leases.get(zone_id)

    def acquire(
        self, zone_id: str, holder: str, now: float, *, can_play_audio: bool = True
    ) -> Lease:
        """Take a free zone. The same holder asking again just renews."""
        flags.require(FLAG)
        if not can_play_audio:
            raise NotASpeaker(holder)
        lease = self.current(zone_id, now)
        if lease is not None:
            if lease.holder != holder:
                raise LeaseHeld(zone_id, lease.holder)
            return self.renew(zone_id, lease.token, now)
        return self._issue(zone_id, holder, now, "granted")

    def renew(self, zone_id: str, token: int, now: float) -> Lease:
        """Extend a live lease. An expired or superseded token is refused, never revived."""
        lease = self.check(zone_id, token, now)
        renewed = Lease(zone_id, lease.holder, lease.token, lease.granted_at, now + self.ttl_s)
        self._leases[zone_id] = renewed
        self.events.append(LeaseEvent(now, "renewed", zone_id, lease.holder, lease.token))
        return renewed

    def takeover(
        self,
        zone_id: str,
        holder: str,
        now: float,
        *,
        reason: str = "moved",
        can_play_audio: bool = True,
    ) -> Lease:
        """Give the zone to `holder` now, fencing out whoever had it."""
        flags.require(FLAG)
        if not can_play_audio:
            raise NotASpeaker(holder)
        old = self.current(zone_id, now)
        detail = f"from {old.holder} ({reason})" if old is not None else reason
        return self._issue(zone_id, holder, now, "taken_over", detail)

    def release(self, zone_id: str, token: int, now: float) -> None:
        lease = self.check(zone_id, token, now)
        del self._leases[zone_id]
        self.events.append(LeaseEvent(now, "released", zone_id, lease.holder, token))

    def check(self, zone_id: str, token: int, now: float) -> Lease:
        """The fence: every audio command passes through here with its token."""
        lease = self.current(zone_id, now)
        if lease is None or lease.token != token:
            current = lease.token if lease is not None else None
            holder = lease.holder if lease is not None else ""
            self.events.append(LeaseEvent(now, "fenced", zone_id, holder, token))
            raise StaleLease(zone_id, token, current)
        return lease

    def allowed(self, zone_id: str, token: int, now: float) -> bool:
        try:
            self.check(zone_id, token, now)
        except StaleLease:
            return False
        return True

    def holders(self, now: float) -> dict[str, str]:
        for zone_id in list(self._leases):
            self._expire(zone_id, now)
        return {zone_id: lease.holder for zone_id, lease in self._leases.items()}

    def snapshot(self) -> dict:
        return {
            "next_token": self._next_token,
            "leases": [
                {"zone": lease.zone_id, "holder": lease.holder, "token": lease.token,
                 "expires_at": lease.expires_at}
                for lease in self._leases.values()
            ],
        }

    @classmethod
    def restore(cls, data: dict, *, ttl_s: float = DEFAULT_TTL_S) -> LeaseTable:
        """Rebuild after a restart. Tokens keep counting up from where they were."""
        table = cls(ttl_s=ttl_s, _next_token=int(data.get("next_token", 1)))
        for row in data.get("leases", []):
            lease = Lease(row["zone"], row["holder"], int(row["token"]), 0.0,
                          float(row["expires_at"]))
            table._leases[lease.zone_id] = lease
            table._next_token = max(table._next_token, lease.token + 1)
        return table


@dataclass
class FencedSpeaker:
    """A speaker as the lease table sees it: it plays only while its token passes the fence.

    The simulator and zone tests use this to prove no two speakers play a zone together.
    """

    speaker_id: str
    table: LeaseTable
    zone_id: str | None = None
    token: int | None = None
    playing: str | None = None
    refused: int = 0

    def hold(self, lease: Lease) -> None:
        self.zone_id, self.token = lease.zone_id, lease.token

    def play(self, song_id: str, now: float) -> bool:
        if self.zone_id is None or self.token is None:
            self.refused += 1
            return False
        if not self.table.allowed(self.zone_id, self.token, now):
            self.refused += 1
            self.playing = None
            return False
        self.playing = song_id
        return True

    def heartbeat(self, now: float) -> bool:
        if self.zone_id is None or self.token is None:
            return False
        try:
            self.table.renew(self.zone_id, self.token, now)
        except StaleLease:
            self.playing = None
            return False
        return True
