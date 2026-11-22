"""Lucy's venue tools (ADR-0450 "Who must respect the rules", BZ-0450-10).

When Lucy programmes a business zone, her song tools see only the zone's effective pool at the
time in question, never the whole organisation library; a proposal is checked again against the
rules before it can apply; and Lucy may only *suggest* a rule change, which lands in the venue's
activity log for a manager to approve on the rules page. No tool here can write a rule, a flag,
a blocklist entry or an override, whatever a prompt asks (the tiers are read and propose only,
and `selecta.lucy.policy.audit` enforces that).

The host functions take an open connection and a `VenueScope`; the operations wrap them for the
Lucy runtime, reading the scope from `run.ctx.venue`. With `business.content_controls` off
there are no venue tools at all.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.engine import Connection

from selecta.business.content import gate

DOESNT_FIT = "That one doesn't fit this zone's music rules right now."
LIMIT = 200


@dataclass(frozen=True)
class VenueScope:
    workspace_id: str
    zone_id: str
    at: float
    directory: Any = None
    library: Any = None


def _parts(conn: Connection, scope: VenueScope):
    from selecta.business.access.directory import SqlDirectory
    from selecta.business.content import service
    from selecta.business.content.library import SqlSongFacts

    directory = scope.directory or SqlDirectory()
    library = scope.library or SqlSongFacts()
    at = datetime.fromtimestamp(scope.at, UTC)
    snapshot = service.zone_snapshot(conn, scope.zone_id, directory=directory, at=at)
    return directory, library, snapshot, at


def venue_tracks(conn: Connection, scope: VenueScope, text: str = "") -> list[dict]:
    """Songs Lucy may use in the zone now: the effective pool only, filtered by `text`."""
    if not gate.on(gate.ENGINE):
        return []
    from selecta.business.content.engine import allowed

    _directory, library, snapshot, at = _parts(conn, scope)
    found = library.search(conn, scope.workspace_id, text or "", LIMIT * 5)
    return [{"song_id": s.song_id, "title": s.title, "artist": s.artist, "bpm": s.bpm,
             "energy": s.energy} for s in found if allowed(s, snapshot, at).allowed][:LIMIT]


def check_proposal(conn: Connection, scope: VenueScope, song_ids: list[str]) -> dict:
    """Re-check a proposal before it applies: allowed songs stay, refused ones are named only
    as not fitting (the rule itself is the manager's business)."""
    if not gate.on(gate.ENGINE):
        return {"allowed": [], "refused": list(song_ids), "message": DOESNT_FIT}
    from selecta.business.content.engine import allowed

    _directory, library, snapshot, at = _parts(conn, scope)
    facts = library.facts(conn, scope.workspace_id, list(song_ids))
    ok = [i for i in song_ids if i in facts and allowed(facts[i], snapshot, at).allowed]
    refused = [i for i in song_ids if i not in ok]
    return {"allowed": ok, "refused": refused, "message": DOESNT_FIT if refused else None}


def suggest_rule_change(conn: Connection, scope: VenueScope, suggestion: str) -> dict:
    """Put Lucy's suggestion in the activity log for a manager. Nothing changes until they do."""
    if not gate.on(gate.ENGINE):
        return {"status": "unavailable"}
    from selecta.business.content import service

    directory, _library, _snapshot, _at = _parts(conn, scope)
    zone = service.zone_ref(conn, scope.zone_id, directory)
    words = " ".join(str(suggestion).split())[:400]
    service.log_activity(conn, zone, "content.lucy_suggestion",
                         [f"Lucy suggests a music rule change for {zone.name}: {words}. "
                          "A manager can make it on the Music rules page."],
                         {"suggestion": words})
    return {"status": "needs_manager_approval"}


def venue_operations() -> list[Any]:
    """The Lucy operations for a business zone (read and propose tiers only)."""
    from weftai.schema.spec import array_schema, object_schema, string_schema

    from selecta.lucy.tools import define

    def scope_of(run) -> tuple[Connection, VenueScope]:
        venue = run.ctx.venue
        return venue.conn, venue.scope

    def tracks(run):
        conn, scope = scope_of(run)
        return venue_tracks(conn, scope, str(run.input.get("text") or ""))

    def check(run):
        conn, scope = scope_of(run)
        return check_proposal(conn, scope, [str(i) for i in run.input.get("song_ids") or []])

    def suggest(run):
        conn, scope = scope_of(run)
        return suggest_rule_change(conn, scope, str(run.input.get("suggestion") or ""))

    text_in = object_schema({"text": string_schema()})
    ids_in = object_schema({"song_ids": array_schema(string_schema())})
    note_in = object_schema({"suggestion": string_schema()})
    out = object_schema({})
    return [
        define("venue.tracks.search", "Songs allowed in this zone now (the zone's music rules "
               "already applied).", text_in, out, tracks),
        define("venue.proposal.check", "Check a proposal against this zone's music rules "
               "before it applies.", ids_in, out, check),
        define("venue.rules.suggest", "Suggest a music rule change for a manager to approve. "
               "It never changes a rule.", note_in, out, suggest, tier="propose"),
    ]


__all__ = ["VenueScope", "check_proposal", "suggest_rule_change", "venue_operations",
           "venue_tracks"]
