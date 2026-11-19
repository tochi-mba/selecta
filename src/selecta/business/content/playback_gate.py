"""Staff "play next" and steering respect the content rules (ADR-0450, BZ-0450-10).

A business zone's programme is set by a controller's `set_programme` (staff play-next, the
kiosk's own planner). `playback.zone_session.zone_submit_command` calls `refused_in_programme`
before the command applies: every song in the new programme must be in the organisation library
and allowed in the zone now, else the whole command is refused with the first refused song
named. With `business.content_controls` off an organisation zone refuses every new programme
rather than play unfiltered (ADR-0450 "Feature flags"). Songs the library can't place (a catalogue
entry with no upload behind it) are refused too: the rules can't vouch for them.

Personal sessions and zones outside an organisation are never touched.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy.engine import Connection

from selecta.business.content import gate

DOESNT_FIT = "{title} doesn't fit this zone's music rules right now."
ENGINE_OFF = ("Venue content controls are off, so this zone won't start new music. An owner can "
              "turn them on in the organisation's settings.")
UNKNOWN = "A song in that list isn't in the organisation library, so the rules can't check it."


def refused_in_programme(conn: Connection, workspace_id: str, zone_id: str,
                         song_ids: Sequence[int], now: float) -> str | None:
    """Why the programme can't play in the zone now, or None when every song is allowed."""
    if not song_ids or not gate.on("business.orgs"):
        return None
    from selecta.business.access.directory import SqlDirectory
    from selecta.business.content import service
    from selecta.business.content.engine import allowed
    from selecta.business.content.library import SqlSongFacts

    directory = SqlDirectory()
    try:
        with conn.begin_nested():
            zone = directory.zone(conn, zone_id)
    except Exception:  # noqa: BLE001 - no organisation tables in this database
        return None
    if zone is None or zone.workspace_id != workspace_id:
        return None  # not an organisation zone: personal rules apply
    if not gate.on(gate.ENGINE):
        return ENGINE_OFF  # never unfiltered (ADR-0450): the zone refuses instead
    library = SqlSongFacts()
    at = datetime.fromtimestamp(now, UTC)
    snapshot = service.zone_snapshot(conn, zone_id, directory=directory, at=at)
    for local_id in dict.fromkeys(song_ids):
        song_id = library.song_for_local(conn, workspace_id, int(local_id))
        song = library.facts(conn, workspace_id, [song_id]).get(song_id) if song_id else None
        if song is None:
            return UNKNOWN
        if not allowed(song, snapshot, at).allowed:
            return DOESNT_FIT.format(title=song.title)
    return None


__all__ = ["refused_in_programme"]
