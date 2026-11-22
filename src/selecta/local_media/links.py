"""Word connections between a member's catalogue songs (browser-first Cloud, `discover.word_links`).

Local mode finds word links in the line-synced lyrics it fetched from LRCLIB (`routes/discover.py`
`/api/links`, `discovery/search.lyric_links`). Browser-first Cloud has no audio and no analysis on
the server, only the metadata-only catalogue (ADR-0458), so this route does the part that needs
neither:

- It looks up synced lyrics for a few catalogue songs per call, through the same LRCLIB client
  local mode uses. In cloud mode every request takes a token from the platform-wide `lrclib`
  bucket (`lyrics/lrclib.py`), so all accounts together stay under the agreed rate. Only artist,
  title, album and duration are sent, as in local mode. Nothing about audio, paths or devices.
- It keeps each answer per song in `local_song_lyrics`, so a song is asked about once (a failed
  request is asked again after `RETRY_ERROR_AFTER_S`).
- It runs local mode's own matcher (`lyrics.match.discover`) over the cached lyrics and answers
  the links, best first.

There is no key, tempo or beat grid here, so the only move a link names is `word_cut`, the one
word move that needs none of them. Rendering a preview is not offered in Cloud; the browser joins
the two songs with its own live transition when they play.

The route belongs to `discover.word_links`, which requires `lyrics.display`; that flag is off by
default in Cloud until the lyric licence is cleared (SC-0406-03), so the route stays dark until
then. LRCLIB is only asked while `lyrics.lookup` is on.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from sqlalchemy.engine import Connection, Engine

from selecta.ai.schema import insert_ignore
from selecta.authz.roles import WorkspaceAction
from selecta.identity.tokens import Claims
from selecta.local_media.lyrics_schema import local_song_lyrics
from selecta.local_media.schema import local_songs
from selecta.persistence import db_now, transaction

LOOKUPS_PER_CALL = 4
"""Songs looked up per call at most. The page asks again every few seconds while it is open."""
LOOKUP_BUDGET_S = 6.0
"""No new lookup starts after this long, so one call never holds the page for long."""
RETRY_ERROR_AFTER_S = 3600.0
"""A song whose lookup failed (an outage, a timeout) is asked about again after an hour."""
MAX_LINKS = 200
WORD_MOVES = ["word_cut"]
"""The one word move that needs no key, tempo or beat grid: a cut on the shared word."""
_CACHED_WORKSPACES = 128

LyricsLookup = Callable[[str, str, "str | None", float], "dict[str, Any] | None"]
"""(artist, title, album, duration) -> LRCLIB's record, or None when it has none."""


def lrclib_lookup(artist: str, title: str, album: str | None, duration: float) -> dict | None:
    """LRCLIB's record for the song, through the shared, globally rate-limited client."""
    from selecta.lyrics.lrclib import LrcLib, clean_artist, clean_title

    return LrcLib().lookup(clean_artist(artist), clean_title(title), album, duration)


def lookup_allowed() -> bool:
    from selecta import flags

    try:
        return flags.on("lyrics.lookup")
    except KeyError:
        return False


def answer_of(found: dict | None) -> tuple[str, str | None]:
    """LRCLIB's record as (status, synced text), the same reading local mode's `fetch_all` makes.
    Plain lyrics are not kept: no link can be found in them."""
    if found is None:
        return "missing", None
    if found.get("instrumental"):
        return "instrumental", None
    if found.get("syncedLyrics"):
        return "synced", str(found["syncedLyrics"])
    if found.get("plainLyrics"):
        return "plain", None
    return "missing", None


def _catalogue(workspace_id: str) -> sa.Select:
    return (
        sa.select(
            local_songs.c.id,
            local_songs.c.artist,
            local_songs.c.title,
            local_songs.c.album,
            local_songs.c.duration_s,
        )
        .where(local_songs.c.workspace_id == workspace_id)
        .where(local_songs.c.deleted_at.is_(None))
        # a likely duplicate would only link to its own twin's lyrics again
        .where(local_songs.c.duplicate_of.is_(None))
    )


def _joined(workspace_id: str) -> sa.sql.expression.Join:
    return local_songs.outerjoin(
        local_song_lyrics,
        sa.and_(
            local_song_lyrics.c.workspace_id == local_songs.c.workspace_id,
            local_song_lyrics.c.song_id == local_songs.c.id,
            local_song_lyrics.c.workspace_id == workspace_id,
        ),
    )


def waiting_songs(conn: Connection, workspace_id: str, limit: int) -> list[Any]:
    """Catalogue songs never looked up, or whose last lookup failed long enough ago."""
    retry_before = db_now(conn) - RETRY_ERROR_AFTER_S
    return list(
        conn.execute(
            _catalogue(workspace_id)
            .select_from(_joined(workspace_id))
            .where(
                sa.or_(
                    local_song_lyrics.c.song_id.is_(None),
                    sa.and_(
                        local_song_lyrics.c.status == "error",
                        local_song_lyrics.c.fetched_at < retry_before,
                    ),
                )
            )
            .order_by(local_songs.c.id)
            .limit(limit)
        ).all()
    )


def save_answer(
    conn: Connection, workspace_id: str, song_id: int, status: str, synced: str | None
) -> None:
    """Keep one song's answer. A failed earlier answer is replaced; any other is kept as it was
    (another call may have looked the same song up a moment ago)."""
    conn.execute(
        local_song_lyrics.delete()
        .where(local_song_lyrics.c.workspace_id == workspace_id)
        .where(local_song_lyrics.c.song_id == song_id)
        .where(local_song_lyrics.c.status == "error")
    )
    insert_ignore(
        conn,
        local_song_lyrics,
        {
            "workspace_id": workspace_id,
            "song_id": song_id,
            "status": status,
            "synced": synced if status == "synced" else None,
            "fetched_at": db_now(conn),
        },
        ("workspace_id", "song_id"),
    )


def look_up_some(
    engine: Engine,
    workspace_id: str,
    lookup: LyricsLookup,
    *,
    limit: int = LOOKUPS_PER_CALL,
    budget_s: float = LOOKUP_BUDGET_S,
    clock: Callable[[], float] = time.monotonic,
) -> int:
    """Look up a few waiting songs. The network calls happen outside any transaction; each
    answer is saved in its own short one. Returns how many songs were looked up."""
    import httpx

    with transaction(engine, workspace_id) as conn:
        songs = waiting_songs(conn, workspace_id, limit)
    started = clock()
    done = 0
    for song in songs:
        if clock() - started > budget_s:
            break
        if not song.duration_s:
            # LRCLIB matches a recording by its length; without one no answer can be trusted
            status, synced = "missing", None
        else:
            try:
                status, synced = answer_of(
                    lookup(song.artist, song.title, song.album, float(song.duration_s))
                )
            except (httpx.HTTPError, ValueError):
                # an outage answering with a non-JSON page fails this song for now, not the call
                status, synced = "error", None
        with transaction(engine, workspace_id) as conn:
            save_answer(conn, workspace_id, int(song.id), status, synced)
        done += 1
    return done


def lyric_counts(conn: Connection, workspace_id: str) -> dict[str, int]:
    """How far the lookups have got: catalogue songs, songs answered, songs with synced lyrics."""
    rows = conn.execute(
        sa.select(local_song_lyrics.c.status, sa.func.count())
        .select_from(_joined(workspace_id))
        .where(local_songs.c.workspace_id == workspace_id)
        .where(local_songs.c.deleted_at.is_(None))
        .where(local_songs.c.duplicate_of.is_(None))
        .group_by(local_song_lyrics.c.status)
    ).all()
    by_status = {status: int(count) for status, count in rows}
    total = sum(by_status.values())
    waiting = by_status.get(None, 0) + by_status.get("error", 0)
    return {
        "songs": total,
        "checked": total - waiting,
        "synced": by_status.get("synced", 0),
        "waiting": waiting,
    }


class _LinkCache:
    """The links found per workspace, found again only when its synced lyrics change (as local
    mode's `all_links` does: matching parses every song's lyrics)."""

    def __init__(self, size: int = _CACHED_WORKSPACES) -> None:
        self._size = size
        self._lock = threading.Lock()
        self._entries: OrderedDict[str, tuple[tuple, list]] = OrderedDict()

    def get(self, workspace_id: str, stamp: tuple) -> list | None:
        with self._lock:
            entry = self._entries.get(workspace_id)
            if entry is None or entry[0] != stamp:
                return None
            self._entries.move_to_end(workspace_id)
            return entry[1]

    def put(self, workspace_id: str, stamp: tuple, links: list) -> None:
        with self._lock:
            self._entries[workspace_id] = (stamp, links)
            self._entries.move_to_end(workspace_id)
            while len(self._entries) > self._size:
                self._entries.popitem(last=False)


_links_cache = _LinkCache()
_lookup_locks: dict[str, threading.Lock] = {}
_lookup_locks_guard = threading.Lock()


def _lookup_lock(workspace_id: str) -> threading.Lock:
    with _lookup_locks_guard:
        if len(_lookup_locks) > 4 * _CACHED_WORKSPACES:
            _lookup_locks.clear()
        return _lookup_locks.setdefault(workspace_id, threading.Lock())


def workspace_links(conn: Connection, workspace_id: str) -> tuple[list, dict[int, Any]]:
    """Every word link between the workspace's songs with synced lyrics, best first, and the
    songs by id. Local mode's own matcher: one link per ordered pair, never the same artist."""
    from selecta.lyrics.lrclib import parse_lrc
    from selecta.lyrics.match import SongFacts, discover

    rows = conn.execute(
        _catalogue(workspace_id)
        .add_columns(local_song_lyrics.c.synced, local_song_lyrics.c.fetched_at)
        .select_from(
            local_songs.join(
                local_song_lyrics,
                sa.and_(
                    local_song_lyrics.c.workspace_id == local_songs.c.workspace_id,
                    local_song_lyrics.c.song_id == local_songs.c.id,
                ),
            )
        )
        .where(local_song_lyrics.c.workspace_id == workspace_id)
        .where(local_song_lyrics.c.status == "synced")
        .where(local_song_lyrics.c.synced.is_not(None))
    ).all()
    songs = {int(row.id): row for row in rows}
    stamp = (
        len(rows),
        max((float(row.fetched_at) for row in rows), default=0.0),
        sum(songs),
        max(songs, default=0),
    )
    links = _links_cache.get(workspace_id, stamp)
    if links is None:
        links = discover(
            {int(row.id): parse_lrc(row.synced, row.duration_s) for row in rows},
            5000,
            {
                int(row.id): SongFacts(row.artist or "", row.title or "", row.duration_s or 0.0)
                for row in rows
            },
        )
        _links_cache.put(workspace_id, stamp, links)
    return links, songs


def link_rows(
    links: list, songs: dict[int, Any], *, text: str = "", song: int | None = None, limit: int = 60
) -> list[dict[str, Any]]:
    wanted = text.casefold()
    shown: list[dict[str, Any]] = []
    for link in links:
        if wanted and wanted not in link.phrase:
            continue
        if song is not None and song not in (link.song_a, link.song_b):
            continue
        a, b = songs[link.song_a], songs[link.song_b]
        shown.append(
            {
                "phrase": link.phrase,
                "kind": link.kind,
                "a": link.song_a,
                "b": link.song_b,
                "artist_a": a.artist,
                "title_a": a.title,
                "artist_b": b.artist,
                "title_b": b.title,
                "line_a": link.line_a.text,
                "line_b": link.line_b.text,
                "score": link.score,
                "moves": list(WORD_MOVES),
            }
        )
        if len(shown) >= limit:
            break
    return shown


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    lookup: LyricsLookup = lrclib_lookup,
    may_look_up: Callable[[], bool] = lookup_allowed,
) -> None:
    """Install `GET /api/local-media/links`. Reads need `library.read`; the lyric lookups it
    makes on the way are a cache of LRCLIB's public answers, so they need nothing more."""

    @app.get("/api/local-media/links")
    def word_links(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        q: str = Query(default="", max_length=200),
        limit: int = Query(default=60, ge=1, le=MAX_LINKS),
        song: int | None = Query(default=None, ge=1),
    ) -> dict[str, Any]:
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(WorkspaceAction.LIBRARY_READ):
            raise HTTPException(status_code=403, detail={"code": "not_allowed"})
        workspace_id = principal.workspace.id
        looked_up = 0
        if may_look_up():
            # one call per workspace looks up at a time; a poll that overlaps it only reads
            gate = _lookup_lock(workspace_id)
            if gate.acquire(blocking=False):
                try:
                    looked_up = look_up_some(engine, workspace_id, lookup)
                finally:
                    gate.release()
        with transaction(engine, workspace_id) as conn:
            links, songs = workspace_links(conn, workspace_id)
            counts = lyric_counts(conn, workspace_id)
        return {
            "links": link_rows(links, songs, text=q, song=song, limit=limit),
            "found": len(links),
            "lyrics": {**counts, "looked_up": looked_up, "looking_up": may_look_up()},
        }


__all__ = [
    "LOOKUPS_PER_CALL",
    "WORD_MOVES",
    "answer_of",
    "install_routes",
    "link_rows",
    "look_up_some",
    "lrclib_lookup",
    "lyric_counts",
    "workspace_links",
]
