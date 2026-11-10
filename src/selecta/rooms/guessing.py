"""Room-code guessing: lock out an address that keeps missing, and tell staff about a swarm.

A room code is about 39 bits, so guessing one is only a threat at scale (docs/saas/15 Rooms: a
million attempts). Three layers, inside the Cloudflare rule on `/r/*`:

1. **Every join** from an address counts against `JOIN_PER_IP` (10 a minute), right or wrong.
2. **Every miss** (a wrong, unknown or ended code) counts against `GUESSES_PER_IP`. The tenth
   in ten minutes locks the address out of joining for 15 minutes, even with a right code, and
   writes a `rooms.join.code_guessing_locked_out` audit row naming only the address's keyed
   hash. One address gets at most about 10 guesses per 25 minutes this way.
3. **Misses from everywhere** count against `GUESSES_EVERYWHERE`. Past 300 a minute, someone
   is guessing from many addresses: a `security.room_code_guessing` platform alert is raised,
   at most once per window, with an audit row beside it. Joins aren't refused for it, so an
   attack can't lock a real party out; staff tighten the edge rule.

Room codes never reach an audit row, alert or log; addresses only as their keyed hash.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable

from sqlalchemy.engine import Engine

from selecta.admin import alerts
from selecta.authz import audit
from selecta.persistence import transaction
from selecta.rooms import limits
from selecta.rooms.errors import Refusal

log = logging.getLogger(__name__)

ALERT_KIND = "security.room_code_guessing"
LOCKOUT_ACTION = "rooms.join.code_guessing_locked_out"
SWARM_ACTION = "rooms.join.code_guessing_swarm"
LOCK = "join-locked"
# Refusals that mean the code was wrong: what a guesser sees.
MISSES = frozenset({Refusal.INVALID_CODE, Refusal.NO_SUCH_ROOM, Refusal.ROOM_ENDED})
EVERYWHERE = "*"


class JoinGuard:
    """Keeps the guessing rules for one API instance, on the instance's `Limiter`."""

    def __init__(self, limiter: limits.Limiter, engine: Callable[[], Engine]) -> None:
        self.limiter = limiter
        self._engine = engine
        self._alerted_until = float("-inf")
        self._alert_lock = threading.Lock()

    def admit(self, ip_hash: str) -> None:
        """Raise `limits.Limited` while this address is locked out, else count the join."""
        self.limiter.check_lock(LOCK, ip_hash)
        self.limiter.hit("join", ip_hash, limits.JOIN_PER_IP)

    def missed(self, ip_hash: str) -> None:
        """A join from `ip_hash` named no room it could enter. Never raises."""
        try:
            self._count(ip_hash)
        except Exception:  # pragma: no cover - the refusal itself must still reach the guest
            log.exception("Couldn't record a missed room code")

    def _count(self, ip_hash: str) -> None:
        mine = self.limiter.count("join-miss", ip_hash, limits.GUESSES_PER_IP)
        if mine >= limits.GUESSES_PER_IP.limit:
            self.limiter.lock(LOCK, ip_hash, limits.GUESS_LOCKOUT_S)
            self._lockout_audit(ip_hash, mine)
        everyone = self.limiter.count("join-miss", EVERYWHERE, limits.GUESSES_EVERYWHERE)
        if everyone < limits.GUESSES_EVERYWHERE.limit:
            return
        with self._alert_lock:
            now = self.limiter.clock()
            if now < self._alerted_until:
                return
            self._alerted_until = now + limits.GUESSES_EVERYWHERE.seconds
        self._swarm_alert(everyone)

    def _lockout_audit(self, ip_hash: str, misses: int) -> None:
        with transaction(self._engine()) as conn:
            audit.record(
                conn,
                action=LOCKOUT_ACTION,
                result=audit.AuditResult.DENY,
                resource_type="room_join",
                resource_id=ip_hash[:128],
                reason="Too many wrong room codes from one address; joins locked out.",
                metadata={
                    "ip_hash": ip_hash,
                    "misses": misses,
                    "window_s": limits.GUESSES_PER_IP.seconds,
                    "lockout_s": limits.GUESS_LOCKOUT_S,
                },
            )

    def _swarm_alert(self, misses: int) -> None:
        details = {"misses": misses, "window_s": limits.GUESSES_EVERYWHERE.seconds}
        summary = (
            f"{misses} wrong room codes in {round(limits.GUESSES_EVERYWHERE.seconds)} s "
            "across many addresses: someone may be guessing room codes."
        )
        with transaction(self._engine()) as conn:
            alerts.raise_alert(conn, ALERT_KIND, summary, metadata=details)
            audit.record(
                conn,
                action=SWARM_ACTION,
                result=audit.AuditResult.DENY,
                resource_type="room_join",
                reason=summary,
                metadata=details,
            )


__all__ = ["ALERT_KIND", "LOCKOUT_ACTION", "MISSES", "SWARM_ACTION", "JoinGuard"]
