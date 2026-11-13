"""The bulk explicit-flag editor and CSV import (ADR-0450, BZ-0450-04).

`select_songs` picks songs by search and filters; `preview` says what would change ("Marking
214 songs as clean"); `apply` writes them as one batch that `undo` puts back exactly. A CSV
import matches each row by ISRC first, then by exact normalised artist and title, and reports
matched, ambiguous, unmatched and invalid rows; only the matched rows are ever saved.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.engine import Connection

from selecta.business.access import BusinessActor, BusinessInvalid, BusinessNotFound
from selecta.business.content import store
from selecta.business.content.editing import audit
from selecta.business.content.engine import EXPLICIT_VALUES, SongFacts
from selecta.business.content.names import credits, normalise
from selecta.persistence import new_id

MAX_BATCH = 50_000
_WORDS = {
    "explicit": "explicit", "e": "explicit", "yes": "explicit", "1": "explicit",
    "true": "explicit", "clean": "clean", "c": "clean", "no": "clean", "0": "clean",
    "false": "clean", "2": "clean", "unknown": "unknown", "": "unknown", "?": "unknown",
}


def select_songs(
    songs: Iterable[SongFacts], *, flags: Mapping[str, str] | None = None,
    query: str | None = None, unknown_only: bool = False, artist: str | None = None,
    crate_id: str | None = None, song_ids: Iterable[str] | None = None,
) -> list[SongFacts]:
    flags = flags or {}
    wanted_ids = set(song_ids) if song_ids is not None else None
    words = normalise(query).split() if query else []
    artist_key = normalise(artist) if artist else None
    chosen = []
    for song in songs:
        if wanted_ids is not None and song.song_id not in wanted_ids:
            continue
        if unknown_only and flags.get(song.song_id, song.explicit) != "unknown":
            continue
        if artist_key and artist_key not in credits(song.artist):
            continue
        if crate_id and crate_id not in song.crate_ids:
            continue
        if words:
            haystack = f"{normalise(song.title)} {normalise(song.artist)}"
            if not all(word in haystack for word in words):
                continue
        chosen.append(song)
    return chosen


def summary(count: int, explicit: str) -> str:
    noun = "song" if count == 1 else "songs"
    if explicit == "unknown":
        return f"Marking {count} {noun} as not checked"
    return f"Marking {count} {noun} as {explicit}"


def preview(songs: list[SongFacts], explicit: str, flags: Mapping[str, str]) -> dict[str, Any]:
    if explicit not in EXPLICIT_VALUES:
        raise BusinessInvalid("explicit is explicit, clean or unknown", code="invalid_flag")
    changing = [s.song_id for s in songs if flags.get(s.song_id, s.explicit) != explicit]
    return {
        "count": len(songs), "changing": len(changing), "explicit": explicit,
        "summary": summary(len(songs), explicit), "song_ids": [s.song_id for s in songs],
    }


def _now(now: float | None) -> float:
    return datetime.now(UTC).timestamp() if now is None else now


def apply(conn: Connection, actor: BusinessActor, *, organisation_id: str, workspace_id: str,
          song_ids: list[str], explicit: str, source: str = "bulk",
          now: float | None = None) -> dict[str, Any]:
    if explicit not in EXPLICIT_VALUES:
        raise BusinessInvalid("explicit is explicit, clean or unknown", code="invalid_flag")
    ids = list(dict.fromkeys(song_ids))
    if not ids:
        raise BusinessInvalid("no songs selected", code="nothing_selected")
    if len(ids) > MAX_BATCH:
        raise BusinessInvalid(f"at most {MAX_BATCH} songs at once", code="too_many")
    now, batch_id = _now(now), new_id()
    undo = []
    for song_id in ids:
        previous = store.set_flag(conn, organisation_id=organisation_id,
                                  workspace_id=workspace_id, song_id=song_id,
                                  explicit=explicit, source=source, set_by=actor.id, now=now)
        undo.append({
            "workspace_id": workspace_id, "organisation_id": organisation_id,
            "batch_id": batch_id, "song_id": song_id,
            "previous_explicit": previous and previous["explicit"],
            "previous_source": previous and previous["source"],
            "previous_set_by": previous and previous["set_by"], "new_explicit": explicit,
            "actor": actor.id, "created_at": now,
        })
    store.add_undo_rows(conn, undo)
    version = store.bump(conn, organisation_id, workspace_id, now)
    audit(conn, actor, f"songs.{source}", organisation_id=organisation_id,
          workspace_id=workspace_id, resource_type="flag_batch", resource_id=batch_id,
          metadata={"count": len(ids), "explicit": explicit})
    return {"batch_id": batch_id, "count": len(ids), "version": version,
            "summary": summary(len(ids), explicit)}


def undo(conn: Connection, actor: BusinessActor, *, organisation_id: str, workspace_id: str,
         batch_id: str, now: float | None = None) -> dict[str, Any]:
    rows = store.undo_rows(conn, organisation_id, batch_id)
    if not rows:
        raise BusinessNotFound()
    now = _now(now)
    for row in rows:
        if row["previous_explicit"] is None:
            store.delete_flag(conn, organisation_id, row["song_id"])
        else:
            store.set_flag(conn, organisation_id=organisation_id, workspace_id=workspace_id,
                           song_id=row["song_id"], explicit=row["previous_explicit"],
                           source=row["previous_source"] or "manual",
                           set_by=row["previous_set_by"], now=now)
    store.mark_undone(conn, organisation_id, batch_id, now)
    version = store.bump(conn, organisation_id, workspace_id, now)
    audit(conn, actor, "songs.undo", organisation_id=organisation_id,
          workspace_id=workspace_id, resource_type="flag_batch", resource_id=batch_id,
          metadata={"count": len(rows)})
    return {"batch_id": batch_id, "restored": len(rows), "version": version}


# ---- CSV import


def _isrc(text: str | None) -> str:
    return "".join(ch for ch in (text or "") if ch.isalnum()).upper()


def parse_csv(text: str) -> list[dict[str, str]]:
    """Rows with `isrc`, `artist`, `title` and `explicit`, whatever the header's case."""
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    if reader.fieldnames is None:
        return []
    aliases = {"isrc": "isrc", "artist": "artist", "title": "title", "explicit": "explicit",
               "advisory": "explicit", "rating": "explicit", "song": "title", "track": "title"}
    columns = {name: aliases.get(name.strip().casefold()) for name in reader.fieldnames}
    rows = []
    for number, raw in enumerate(reader, start=2):
        row = {"line": str(number)}
        for name, value in raw.items():
            if name in columns and columns[name]:
                row[columns[name]] = (value or "").strip()
        rows.append(row)
    return rows


def match_rows(rows: list[dict[str, str]], library: Iterable[SongFacts]) -> dict[str, list]:
    by_isrc: dict[str, list[str]] = {}
    by_name: dict[tuple[str, str], list[str]] = {}
    for song in library:
        if song.isrc:
            by_isrc.setdefault(_isrc(song.isrc), []).append(song.song_id)
        by_name.setdefault((normalise(song.artist), normalise(song.title)), []).append(
            song.song_id)
    found: dict[str, list] = {"matched": [], "ambiguous": [], "unmatched": [], "invalid": []}
    for row in rows:
        explicit = _WORDS.get((row.get("explicit") or "").strip().casefold())
        if explicit is None:
            found["invalid"].append({**row, "why": "explicit must be explicit, clean or unknown"})
            continue
        isrc = _isrc(row.get("isrc"))
        ids = by_isrc.get(isrc, []) if isrc else []
        how = "isrc"
        if not ids:
            how = "artist_title"
            ids = by_name.get((normalise(row.get("artist")), normalise(row.get("title"))), [])
        ids = list(dict.fromkeys(ids))
        if len(ids) == 1:
            found["matched"].append({**row, "song_id": ids[0], "explicit": explicit, "by": how})
        elif ids:
            found["ambiguous"].append({**row, "song_ids": ids, "explicit": explicit, "by": how})
        else:
            found["unmatched"].append(row)
    found["counts"] = {name: len(found[name]) for name in
                       ("matched", "ambiguous", "unmatched", "invalid")}
    return found


def import_apply(conn: Connection, actor: BusinessActor, *, organisation_id: str,
                 workspace_id: str, matched: list[dict], now: float | None = None) -> dict:
    """Save only matched rows, one batch per flag value, all undoable."""
    batches = []
    for explicit in EXPLICIT_VALUES:
        ids = [row["song_id"] for row in matched if row["explicit"] == explicit]
        if ids:
            batches.append(apply(conn, actor, organisation_id=organisation_id,
                                 workspace_id=workspace_id, song_ids=ids, explicit=explicit,
                                 source="import", now=now))
    return {"batches": batches, "count": sum(b["count"] for b in batches)}


__all__ = ["apply", "import_apply", "match_rows", "parse_csv", "preview", "select_songs", "undo"]
