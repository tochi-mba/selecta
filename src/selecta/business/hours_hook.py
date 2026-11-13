"""Where "archive at closing time" finds the venue's next closing instant (ADR-0442, ADR-0444).

Archiving a venue or zone asks "now or at closing time". The closing time comes from the venue's
opening hours, which ADR-0444 (BZ-3) owns. Until it installs a provider with
`set_next_closing_at`, there is no known closing instant and the routes fall back to "now".
"""

from __future__ import annotations

from collections.abc import Callable

from sqlalchemy.engine import Connection

NextClosingAt = Callable[[Connection, str, str, int], "int | None"]


def _unknown(_conn: Connection, _workspace_id: str, _venue_id: str, _now: int) -> int | None:
    return None


_provider: NextClosingAt = _unknown


def set_next_closing_at(provider: NextClosingAt | None) -> None:
    """Install the opening-hours source (ADR-0444); None goes back to "unknown"."""
    global _provider
    _provider = provider or _unknown


def next_closing_at(conn: Connection, workspace_id: str, venue_id: str, now: int) -> int | None:
    """The venue's next closing instant (epoch seconds) after `now`, or None when unknown."""
    return _provider(conn, workspace_id, venue_id, now)


__all__ = ["NextClosingAt", "next_closing_at", "set_next_closing_at"]
