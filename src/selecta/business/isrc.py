"""ISRC capture for business play logs (ADR-0449 BZ-0449-07).

An ISRC is 12 characters: country (2 letters), registrant (3 letters or digits), year (2 digits)
and designation (5 digits), often written CC-XXX-YY-NNNNN. It is read from tags on upload, can
be entered or corrected by hand (every change is kept in `biz_isrc_edits`, the original included),
and coverage per venue shows the share of played tracks that have one.

Tags: ID3 `TSRC` (MP3, AIFF, WAV), Vorbis comment `isrc` (FLAC, Ogg, Opus) and the MP4 freeform
atom `----:com.apple.iTunes:ISRC`. `read_from_tags` takes any mutagen-like mapping, so tests and
the upload path can hand it a plain dict or a real mutagen tag object.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.commercial_audit import audit
from selecta.business.commercial_schema import biz_isrc_edits, biz_play_log
from selecta.business.errors import BusinessError
from selecta.persistence import new_id

_ISRC = re.compile(r"^[A-Z]{2}[A-Z0-9]{3}[0-9]{2}[0-9]{5}$")
TAG_KEYS = ("TSRC", "isrc", "ISRC", "----:com.apple.iTunes:ISRC", "----:com.apple.iTunes:isrc")
EDIT_SOURCES = ("tag", "manual")


class InvalidIsrc(BusinessError):
    code = "invalid_isrc"


def normalise(raw: str | bytes | None) -> str | None:
    """The 12-character ISRC in `raw`, or None when it is not a valid ISRC."""
    if raw is None:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    text = re.sub(r"[\s\-_.]", "", str(raw)).upper()
    if text.startswith("ISRC"):
        text = text[4:].lstrip(":")
    return text if _ISRC.match(text) else None


def is_valid(raw: str | bytes | None) -> bool:
    return normalise(raw) is not None


def display(isrc: str) -> str:
    """CC-XXX-YY-NNNNN."""
    value = normalise(isrc)
    if value is None:
        raise InvalidIsrc("That is not a valid ISRC.")
    return f"{value[:2]}-{value[2:5]}-{value[5:7]}-{value[7:]}"


def _texts(value: Any) -> list[Any]:
    if value is None:
        return []
    text = getattr(value, "text", None)  # mutagen ID3 frame
    if text is not None:
        return _texts(text)
    if isinstance(value, str | bytes):
        return [value]
    if isinstance(value, list | tuple):
        out: list[Any] = []
        for item in value:
            out.extend(_texts(item))
        return out
    return [bytes(value) if isinstance(value, bytearray | memoryview) else str(value)]


def read_from_tags(tags: Mapping[str, Any] | Any | None) -> str | None:
    """The first valid ISRC in a mutagen-like tag mapping, or None."""
    if tags is None:
        return None
    for key in TAG_KEYS:
        try:
            value = tags[key]
        except (KeyError, ValueError, TypeError):
            continue
        for text in _texts(value):
            found = normalise(text)
            if found:
                return found
    return None


def read_from_file(path: str | Path) -> str | None:
    """ISRC from an audio file's tags with mutagen; None when unreadable or untagged."""
    try:
        import mutagen
    except ImportError:  # pragma: no cover - mutagen is a dependency
        return None
    try:
        audio = mutagen.File(str(path))
    except Exception:  # noqa: BLE001 - a broken tag must never block an upload
        return None
    if audio is None:
        return None
    return read_from_tags(audio.tags)


# ---------------------------------------------------------------------------------------------
# Edits (tag reads at upload and manual corrections)


def current_isrc(conn: Connection, workspace_id: str, track_id: str) -> str | None:
    """The track's ISRC from its latest edit, or None if it has never had one recorded."""
    row = conn.execute(
        sa.select(biz_isrc_edits.c.new_isrc)
        .where(biz_isrc_edits.c.workspace_id == workspace_id,
               biz_isrc_edits.c.track_id == track_id)
        .order_by(biz_isrc_edits.c.created_at.desc(), biz_isrc_edits.c.id.desc())
        .limit(1)
    ).first()
    return row[0] if row else None


def corrections(conn: Connection, workspace_id: str,
                track_ids: list[str] | None = None) -> dict[str, str | None]:
    """track_id -> latest edited ISRC, for every track with an edit (None means cleared)."""
    query = sa.select(biz_isrc_edits.c.track_id, biz_isrc_edits.c.new_isrc).where(
        biz_isrc_edits.c.workspace_id == workspace_id
    )
    if track_ids is not None:
        if not track_ids:
            return {}
        query = query.where(biz_isrc_edits.c.track_id.in_(track_ids))
    out: dict[str, str | None] = {}
    for track_id, value in conn.execute(
        query.order_by(biz_isrc_edits.c.created_at, biz_isrc_edits.c.id)
    ):
        out[track_id] = value
    return out


def edit_history(conn: Connection, workspace_id: str, track_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        sa.select(biz_isrc_edits)
        .where(biz_isrc_edits.c.workspace_id == workspace_id,
               biz_isrc_edits.c.track_id == track_id)
        .order_by(biz_isrc_edits.c.created_at, biz_isrc_edits.c.id)
    ).mappings()
    return [dict(r) for r in rows]


def _record(conn: Connection, workspace_id: str, track_id: str, new: str | None, source: str,
            actor: str, now: float, old: str | None) -> dict[str, Any]:
    values = {
        "id": new_id(),
        "workspace_id": workspace_id,
        "track_id": track_id,
        "old_isrc": old,
        "new_isrc": new,
        "source": source,
        "actor": actor,
        "created_at": now,
    }
    conn.execute(sa.insert(biz_isrc_edits).values(**values))
    return values


def record_tag_isrc(conn: Connection, workspace_id: str, track_id: str,
                    tags: Mapping[str, Any] | Any | None, *, actor: str,
                    now: float) -> str | None:
    """Upload path: keep the ISRC read from tags, if any. Returns it."""
    found = read_from_tags(tags)
    if found is not None:
        old = current_isrc(conn, workspace_id, track_id)
        if old != found:
            _record(conn, workspace_id, track_id, found, "tag", actor, now, old)
    return found


def set_manual(
    conn: Connection,
    *,
    workspace_id: str,
    organisation_id: str,
    track_id: str,
    isrc: str | None,
    actor: str,
    now: float,
    logged_isrc: str | None = None,
) -> dict[str, Any] | None:
    """Enter, correct or clear a track's ISRC by hand. The original stays in the edit history.

    `logged_isrc` is the value the play log copied, used as the "old" value when the track has
    no edit yet. Returns the edit, or None when nothing changed.
    """
    new: str | None = None
    if isrc is not None and str(isrc).strip():
        new = normalise(isrc)
        if new is None:
            raise InvalidIsrc("That is not a valid ISRC (for example GB-ABC-26-00001).")
    history = edit_history(conn, workspace_id, track_id)
    old = history[-1]["new_isrc"] if history else normalise(logged_isrc)
    if old == new:
        return None
    edit = _record(conn, workspace_id, track_id, new, "manual", actor, now, old)
    audit(
        conn,
        workspace_id=workspace_id,
        organisation_id=organisation_id,
        action="isrc.edited",
        actor=actor,
        now=now,
        detail={"track_id": track_id, "old_isrc": old, "new_isrc": new},
    )
    return edit


# ---------------------------------------------------------------------------------------------
# Coverage


@dataclass(frozen=True)
class Coverage:
    tracks: int
    with_isrc: int

    @property
    def share(self) -> float:
        return self.with_isrc / self.tracks if self.tracks else 0.0

    def to_dict(self) -> dict[str, Any]:
        return {"tracks": self.tracks, "with_isrc": self.with_isrc, "share": self.share}


def track_key(row: Mapping[str, Any]) -> str:
    """Distinct-track key for play-log rows: the track id, else title and artist."""
    if row.get("track_id"):
        return f"id:{row['track_id']}"
    return f"meta:{(row.get('title') or '').casefold()}\x1f{(row.get('artist') or '').casefold()}"


def coverage(
    conn: Connection,
    workspace_id: str,
    organisation_id: str,
    venue_id: str,
    *,
    start: float | None = None,
    end: float | None = None,
) -> Coverage:
    """Share of distinct tracks played at the venue that have an ISRC (corrections applied)."""
    query = sa.select(
        biz_play_log.c.track_id, biz_play_log.c.title, biz_play_log.c.artist,
        biz_play_log.c.isrc,
    ).where(biz_play_log.c.organisation_id == organisation_id,
            biz_play_log.c.venue_id == venue_id)
    if start is not None:
        query = query.where(biz_play_log.c.started_at >= start)
    if end is not None:
        query = query.where(biz_play_log.c.started_at < end)
    rows = [dict(r) for r in conn.execute(query).mappings()]
    fixes = corrections(conn, workspace_id, sorted({r["track_id"] for r in rows
                                                     if r["track_id"]}))
    has: dict[str, bool] = {}
    for r in rows:
        key = track_key(r)
        value = fixes[r["track_id"]] if r["track_id"] in fixes else r["isrc"]
        has[key] = has.get(key, False) or bool(value)
    return Coverage(tracks=len(has), with_isrc=sum(has.values()))
