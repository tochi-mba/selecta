"""The organisation library as song facts for the content engine (ADR-0450, BZ-0450-07).

`SqlSongFacts` is the production `SongFactsSource`: every live upload in the organisation
workspace (`assets`, whose id is the song id the library page, crates, flags and blocklists use),
with what SelectaDJ really knows about it:

- title, artist and album from the song catalogue (`local_songs`, matched by content hash), else
  the upload's own name and no artist;
- the explicit flag (`business_song_flags`; `unknown` when nobody and no tag has said);
- the crates it is in (`crate_songs`, tombstoned rows left out);
- the ISRC from its latest recorded edit (`biz_isrc_edits`);
- `analysed`: an `analysis` artifact of the file exists (the `analyse.song` worker's output for
  this analysis version) or a `song_facts` artifact does. A song nobody has analysed yet is not
  in any pool, as the ADR says;
- BPM from a `song_facts` artifact, else from the finished `analyse.song` job's result; energy
  only from a `song_facts` artifact. A song without a measured BPM or energy is refused by a
  BPM or energy range, never guessed into one.

There is no set-aside or never-play mark on organisation uploads yet, so both read False.
`songs_for` is the venue rules save check's source (`content.api.install_routes(songs_for=)`):
None for an empty library, so a manager can set rules before uploading anything.
Results are cached for a few seconds per workspace, because guest search reads on each keystroke.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Iterable
from threading import Lock

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.content import store
from selecta.business.content.engine import SongFacts
from selecta.business.content.names import normalise

LIMIT = 20_000
CACHE_S = 10.0
_cache: dict[str, tuple[float, dict[str, SongFacts], dict[str, int]]] = {}
_lock = Lock()


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def analysis_hash(sha256: str) -> str:
    """The `analyse.song` worker's input hash for a file (its own rule, see engine_handlers)."""
    from selecta.config import ANALYSIS_VERSION

    payload = {"source_sha256": sha256, "analysis": ANALYSIS_VERSION}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def _number(value) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def _chunks(items: list[str], size: int = 500) -> Iterable[list[str]]:
    for start in range(0, len(items), size):
        yield items[start:start + size]


def _catalogue(conn: Connection, workspace_id: str, hashes: list[str]) -> dict[str, dict]:
    from selecta.local_media.schema import local_songs as t

    found: dict[str, dict] = {}
    for chunk in _chunks(hashes):
        rows = conn.execute(
            sa.select(t.c.id, t.c.content_sha256, t.c.title, t.c.artist, t.c.album,
                      t.c.duration_s)
            .where(t.c.workspace_id == workspace_id, t.c.content_sha256.in_(chunk),
                   t.c.deleted_at.is_(None))
            .order_by(t.c.id)
        ).mappings()
        for row in rows:
            found.setdefault(row["content_sha256"], dict(row))
    return found


def _crates(conn: Connection, workspace_id: str) -> dict[str, set[str]]:
    from selecta.business.schema import crate_songs as t

    found: dict[str, set[str]] = {}
    try:
        with conn.begin_nested():
            for song_id, crate_id in conn.execute(
                sa.select(t.c.song_id, t.c.crate_id)
                .where(t.c.workspace_id == workspace_id, t.c.removed_at.is_(None))
            ):
                found.setdefault(song_id, set()).add(crate_id)
    except sa.exc.SQLAlchemyError:
        return {}
    return found


def _isrcs(conn: Connection, workspace_id: str) -> dict[str, str]:
    from selecta.business.commercial_schema import biz_isrc_edits as t

    found: dict[str, str] = {}
    try:
        with conn.begin_nested():
            for track_id, isrc in conn.execute(
                sa.select(t.c.track_id, t.c.new_isrc).where(t.c.workspace_id == workspace_id)
                .order_by(t.c.created_at, t.c.id)
            ):
                if isrc:
                    found[track_id] = isrc
                else:
                    found.pop(track_id, None)
    except sa.exc.SQLAlchemyError:
        return {}
    return found


def _analysis(conn: Connection, workspace_id: str, hashes: list[str]):
    """(file hashes with an analysis, song_facts by file hash, worker BPM by file hash)."""
    from selecta.work.schema import artifacts, jobs

    by_input = {analysis_hash(sha): sha for sha in hashes}
    analysed: set[str] = set()
    facts: dict[str, dict] = {}
    for chunk in _chunks(list(by_input)):
        analysed.update(by_input[h] for h in conn.execute(
            sa.select(artifacts.c.input_hash).where(
                artifacts.c.workspace_id == workspace_id, artifacts.c.kind == "analysis",
                artifacts.c.input_hash.in_(chunk))).scalars())
    for chunk in _chunks(hashes):
        for input_hash, record in conn.execute(
            sa.select(artifacts.c.input_hash, artifacts.c.provenance).where(
                artifacts.c.workspace_id == workspace_id, artifacts.c.kind == "song_facts",
                artifacts.c.input_hash.in_(chunk))):
            facts[input_hash] = (record or {}).get("facts") or {}
            analysed.add(input_hash)
    bpm: dict[str, float] = {}
    for result in conn.execute(
        sa.select(jobs.c.result).where(
            jobs.c.workspace_id == workspace_id, jobs.c.type == "analyse.song",
            jobs.c.state == "succeeded").limit(LIMIT)
    ).scalars():
        sha = by_input.get((result or {}).get("input_hash") or "")
        value = _number((result or {}).get("bpm"))
        if sha and value:
            bpm[sha] = value
    return analysed, facts, bpm


def load(conn: Connection, workspace_id: str) -> tuple[dict[str, SongFacts], dict[str, int]]:
    """Every live song of the workspace as facts, and each song's catalogue id (for zones)."""
    from selecta.storage.schema import assets, upload_sessions

    rows = conn.execute(
        sa.select(assets.c.id, assets.c.sha256, assets.c.duration_s,
                  upload_sessions.c.display_name)
        .select_from(assets.outerjoin(upload_sessions, sa.and_(
            upload_sessions.c.id == assets.c.id,
            upload_sessions.c.workspace_id == assets.c.workspace_id)))
        .where(assets.c.workspace_id == workspace_id, assets.c.deleted_at.is_(None))
        .order_by(assets.c.created_at, assets.c.id).limit(LIMIT)
    ).mappings().all()
    hashes = sorted({row["sha256"] for row in rows if row["sha256"]})
    catalogue = _catalogue(conn, workspace_id, hashes)
    flags = store.flags_map(conn, workspace_id)
    crates = _crates(conn, workspace_id)
    isrcs = _isrcs(conn, workspace_id)
    analysed, facts, worker_bpm = _analysis(conn, workspace_id, hashes)
    songs: dict[str, SongFacts] = {}
    local_ids: dict[str, int] = {}
    for row in rows:
        sha = row["sha256"]
        song = catalogue.get(sha) or {}
        known = facts.get(sha, {})
        songs[row["id"]] = SongFacts(
            song_id=row["id"],
            title=song.get("title") or row["display_name"] or "Untitled",
            artist=song.get("artist") or "",
            album=song.get("album") or None,
            isrc=isrcs.get(row["id"]),
            bpm=_number(known.get("bpm")) or worker_bpm.get(sha),
            energy=_number(known.get("energy")),
            explicit=flags.get(row["id"], "unknown"),
            crate_ids=frozenset(crates.get(row["id"], ())),
            analysed=sha in analysed,
            length_s=_number(row["duration_s"]) or _number(song.get("duration_s")),
        )
        if song.get("id") is not None:
            local_ids[row["id"]] = int(song["id"])
    return songs, local_ids


def _cached(conn: Connection, workspace_id: str) -> tuple[dict[str, SongFacts], dict[str, int]]:
    now = time.monotonic()
    with _lock:
        hit = _cache.get(workspace_id)
        if hit is not None and now - hit[0] < CACHE_S:
            return hit[1], hit[2]
    songs, local_ids = load(conn, workspace_id)
    with _lock:
        _cache[workspace_id] = (now, songs, local_ids)
    return songs, local_ids


class SqlSongFacts:
    """The production `SongFactsSource` (see the module notes)."""

    def __init__(self, *, cached: bool = True) -> None:
        self.cached = cached

    def _all(self, conn: Connection, workspace_id: str):
        return _cached(conn, workspace_id) if self.cached else load(conn, workspace_id)

    def all(self, conn: Connection, workspace_id: str) -> list[SongFacts]:
        return list(self._all(conn, workspace_id)[0].values())

    def facts(self, conn: Connection, workspace_id: str, song_ids: list[str]) -> dict:
        songs = self._all(conn, workspace_id)[0]
        return {song_id: songs[song_id] for song_id in song_ids if song_id in songs}

    def search(self, conn: Connection, workspace_id: str, query: str, limit: int) -> list:
        words = normalise(query).split()
        found = []
        for song in self._all(conn, workspace_id)[0].values():
            text = f"{normalise(song.title)} {normalise(song.artist)}"
            if all(word in text for word in words):
                found.append(song)
        found.sort(key=lambda s: (s.title.casefold(), s.artist.casefold(), s.song_id))
        return found[:limit]

    def local_id(self, conn: Connection, workspace_id: str, song_id: str) -> int | None:
        """The catalogue id a zone programme plays this song by, if the catalogue knows it."""
        return self._all(conn, workspace_id)[1].get(song_id)

    def song_for_local(self, conn: Connection, workspace_id: str, local_id: int) -> str | None:
        for song_id, found in self._all(conn, workspace_id)[1].items():
            if found == local_id:
                return song_id
        return None


def songs_for(conn: Connection, organisation_id: str) -> list[SongFacts] | None:
    """The library for the venue rules save check; None when the library is empty."""
    songs = list(load(conn, organisation_id)[0].values())
    return songs or None


__all__ = ["SqlSongFacts", "analysis_hash", "clear_cache", "load", "songs_for"]
