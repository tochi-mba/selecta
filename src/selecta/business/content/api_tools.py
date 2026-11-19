"""More cloud routes for venue content controls (ADR-0450): the zone pool, the kiosk snapshot,
artist variants, clean edits, the bulk editor with undo, CSV import and "Worth checking".

Installed by `selecta.business.controls_wiring.install` next to `content.api`. Same rules: the
caller acts in the `X-Workspace-ID` organisation (a kiosk may instead send its `X-Device-Token`
for the snapshot), one permission is checked with `guard.require`, a venue or zone of another
organisation answers 404, and each route answers 404 `flag_off` while its flag is off:

- `business.content_controls`: pool, snapshot, artist variants, clean links;
- `business.content_controls.bulk`: bulk preview, apply, undo and the CSV import;
- `business.content_controls.lyrics_hint`: the "Worth checking" list.

Song facts come from the organisation library (`content.library.SqlSongFacts`). Lyrics for the
hint list come from LRCLIB through `lyrics_source` (only while `lyrics.lookup` is on), at most
`HINT_BATCH` songs per call, cached in this process; a hint never changes a flag.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from threading import Lock
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta.business.access import BusinessActor, BusinessError, BusinessNotFound
from selecta.business.access.directory import Directory
from selecta.business.content import bulk, editing, gate, lyrics_hint, service, snapshot_io, store
from selecta.business.content.engine import EXPLICIT_VALUES, SongFacts
from selecta.business.content.library import SqlSongFacts
from selecta.business.content.names import artist_variants
from selecta.business.content.pool import effective_pool
from selecta.persistence import transaction

DEVICE_HEADER = "x-device-token"
HINT_BATCH = 10
LyricsSource = Callable[[SongFacts], "tuple[str | None, str | None]"]
"""song -> (lyrics or None, language code or None)."""


class Selection(BaseModel):
    explicit: str = Field(default="clean", max_length=16)
    query: str | None = Field(default=None, max_length=200)
    unknown_only: bool = False
    artist: str | None = Field(default=None, max_length=400)
    crate_id: str | None = Field(default=None, max_length=64)
    song_ids: list[str] | None = Field(default=None, max_length=bulk.MAX_BATCH)


class CleanLink(BaseModel):
    clean_song_id: str | None = Field(default=None, max_length=64)


class CsvBody(BaseModel):
    csv: str = Field(max_length=5_000_000)


_lyrics_cache: dict[str, tuple[str | None, str | None]] = {}
_lyrics_lock = Lock()


def lrclib_lyrics(song: SongFacts) -> tuple[str | None, str | None]:
    """LRCLIB's lyrics for the song, while `lyrics.lookup` is on; (None, None) otherwise."""
    from selecta import flags

    try:
        if not flags.on("lyrics.lookup"):
            return None, None
    except KeyError:
        return None, None
    import httpx

    from selecta.lyrics.lrclib import LrcLib, clean_artist, clean_title

    try:
        found = LrcLib().lookup(clean_artist(song.artist), clean_title(song.title), song.album,
                                song.length_s or 0.0)
    except (httpx.HTTPError, ValueError):
        return None, None
    if not found or found.get("instrumental"):
        return None, None
    return found.get("plainLyrics") or found.get("syncedLyrics"), None


def _error(error: BusinessError) -> HTTPException:
    detail: dict[str, Any] = {"code": error.code, "message": str(error)}
    return HTTPException(status_code=error.status, detail=detail)


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Any],
    principal_for: Callable[..., Any] | None = None,
    directory: Directory,
    songs: SqlSongFacts | None = None,
    lyrics_source: LyricsSource = lrclib_lyrics,
    authorize: Callable[..., None] | None = None,
    actor_resolver: Callable[..., BusinessActor] | None = None,
    flag_on: Callable[[str], bool] = gate.on,
) -> None:
    library = songs or SqlSongFacts()

    def workspace_of(request: Request) -> str:
        chosen = request.headers.get("x-workspace-id")
        if principal_for is None or actor_resolver is not None:
            if not chosen:
                raise HTTPException(status_code=404, detail={"code": "not_found"})
            return chosen
        found = principal_for(engine, current_claims(request), chosen)
        if found.workspace.kind != "business":
            raise HTTPException(status_code=404, detail={"code": "not_found"})
        return found.workspace.id

    def resolve(request: Request, conn: Connection, workspace_id: str) -> BusinessActor:
        if actor_resolver is not None:
            return actor_resolver(request, conn, organisation_id=workspace_id,
                                  workspace_id=workspace_id)
        from selecta.business.access import guard

        claims = current_claims(request)
        return guard.actor_for(conn, user_id=claims.subject, organisation_id=workspace_id,
                               workspace_id=workspace_id)

    def check(conn, actor, permissions: tuple[str, ...], zone_id: str | None) -> None:
        last: BusinessError | None = None
        for permission in permissions:
            try:
                if authorize is not None:
                    authorize(conn, actor, permission, venue_id=None, zone_id=zone_id,
                              directory=directory)
                else:
                    from selecta.business.access import guard

                    guard.require(conn, actor, permission, zone_id=zone_id, directory=directory)
                return
            except BusinessError as error:
                last = error
        if last is not None:
            raise last

    def run(request: Request, flags: tuple[str, ...], permissions: tuple[str, ...],
            work: Callable[[Connection, BusinessActor], Any], *, zone_id: str | None = None,
            device_ok: bool = False) -> Any:
        for flag in flags:
            if not flag_on(flag):
                raise HTTPException(status_code=404, detail={
                    "code": "flag_off", "flag": flag, "message": "That isn't available here."})
        token = request.headers.get(DEVICE_HEADER) if device_ok else None
        try:
            if token and actor_resolver is None:
                from selecta.business.access import guard

                with transaction(engine) as conn:
                    actor = guard.device_actor(conn, token=token)
                    check(conn, actor, permissions, zone_id)
                    return work(conn, actor)
            workspace_id = workspace_of(request)
            with transaction(engine, workspace_id) as conn:
                actor = resolve(request, conn, workspace_id)
                check(conn, actor, permissions, zone_id)
                return work(conn, actor)
        except BusinessError as error:
            raise _error(error) from error

    def zone_in_org(conn: Connection, actor: BusinessActor, zone_id: str):
        zone = directory.zone(conn, zone_id)
        if zone is None or zone.organisation_id != actor.organisation_id:
            raise BusinessNotFound()
        return zone

    def all_songs(conn: Connection, actor: BusinessActor) -> list[SongFacts]:
        return library.all(conn, actor.workspace_id)

    engine_flag = (gate.ENGINE,)
    bulk_flags = (gate.ENGINE, gate.BULK)

    # -- the zone pool and its relaxations ---------------------------------------------------

    @app.get("/api/business/zones/{zone_id}/content/pool")
    def zone_pool(zone_id: str, request: Request) -> dict[str, Any]:
        def work(conn, actor):
            zone = zone_in_org(conn, actor, zone_id)
            now = datetime.now(UTC)
            snapshot = service.zone_snapshot(conn, zone.id, directory=directory, at=now)
            songs = all_songs(conn, actor)
            blocks = [(None, "All day")] + [(part, rules.label or part)
                                            for part, rules in snapshot.dayparts.items()]
            found = []
            for part, label in blocks:
                pool = effective_pool(songs, snapshot, now, daypart_id=part, minimum=1)
                seconds = sum(s.length_s or 210.0 for s in pool.songs)
                found.append({"daypart_id": part, "label": label, "songs": len(pool.songs),
                              "hours": round(seconds / 3600, 2), "unknown": pool.unknown_count,
                              "relaxed": list(pool.relaxed), "messages": list(pool.messages)})
            overrides = [{"id": o.id, "kind": o.kind, "value": o.value, "reason": o.reason,
                          "ends_at": o.ends_at} for o in snapshot.overrides
                         if o.ends_at > now.timestamp()]
            return {"zone_id": zone.id, "version": snapshot.version, "library": len(songs),
                    "unanalysed": sum(1 for s in songs if not s.analysed),
                    "blocks": found, "overrides": overrides}
        return run(request, engine_flag, ("business.rules.read",), work, zone_id=zone_id)

    @app.get("/api/business/zones/{zone_id}/content/snapshot")
    def zone_snapshot(zone_id: str, request: Request) -> dict[str, Any]:
        """The zone's compiled rules for a kiosk to hold, so it refuses songs even offline."""
        def work(conn, actor):
            zone = zone_in_org(conn, actor, zone_id)
            return snapshot_io.to_json(service.zone_snapshot(conn, zone.id, directory=directory))
        return run(request, engine_flag, ("business.kiosk.snapshot", "business.rules.read"),
                   work, zone_id=zone_id, device_ok=True)

    @app.get("/api/business/content/artist-variants")
    def variants(request: Request, name: str = "") -> dict[str, Any]:
        def work(conn, actor):
            names = [s.artist for s in all_songs(conn, actor) if s.artist]
            return {"name": name, "variants": artist_variants(name[:400], names)}
        return run(request, engine_flag, ("business.rules.read",), work)

    @app.put("/api/business/content/songs/{song_id}/clean-link")
    def clean_link(song_id: str, body: CleanLink, request: Request) -> dict[str, Any]:
        def work(conn, actor):
            known = {s.song_id for s in all_songs(conn, actor)}
            if song_id not in known or (body.clean_song_id and body.clean_song_id not in known):
                raise BusinessNotFound()
            version = editing.set_clean_link(
                conn, actor, organisation_id=actor.organisation_id,
                workspace_id=actor.workspace_id, song_id=song_id,
                clean_song_id=body.clean_song_id)
            return {"song_id": song_id, "clean_song_id": body.clean_song_id, "version": version}
        return run(request, engine_flag, ("business.songs.flag",), work)

    # -- the bulk editor and CSV import ------------------------------------------------------

    def selected(conn, actor, body: Selection) -> list[SongFacts]:
        return bulk.select_songs(
            all_songs(conn, actor), flags=store.flags_map(conn, actor.organisation_id),
            query=body.query, unknown_only=body.unknown_only, artist=body.artist,
            crate_id=body.crate_id, song_ids=body.song_ids)

    @app.post("/api/business/content/bulk/preview")
    def bulk_preview(body: Selection, request: Request) -> dict[str, Any]:
        def work(conn, actor):
            songs = selected(conn, actor, body)
            found = bulk.preview(songs, body.explicit, store.flags_map(conn, actor.organisation_id))
            found["songs"] = [{"id": s.song_id, "title": s.title, "artist": s.artist}
                              for s in songs[:50]]
            del found["song_ids"]
            return found
        return run(request, bulk_flags, ("business.songs.flag",), work)

    @app.post("/api/business/content/bulk/apply")
    def bulk_apply(body: Selection, request: Request) -> dict[str, Any]:
        def work(conn, actor):
            ids = [s.song_id for s in selected(conn, actor, body)]
            return bulk.apply(conn, actor, organisation_id=actor.organisation_id,
                              workspace_id=actor.workspace_id, song_ids=ids,
                              explicit=body.explicit)
        return run(request, bulk_flags, ("business.songs.flag",), work)

    @app.post("/api/business/content/bulk/{batch_id}/undo")
    def bulk_undo(batch_id: str, request: Request) -> dict[str, Any]:
        return run(request, bulk_flags, ("business.songs.flag",),
                   lambda conn, actor: bulk.undo(conn, actor, organisation_id=actor.organisation_id,
                                                 workspace_id=actor.workspace_id,
                                                 batch_id=batch_id))

    @app.post("/api/business/content/import/preview")
    def import_preview(body: CsvBody, request: Request) -> dict[str, Any]:
        return run(request, bulk_flags, ("business.songs.flag",),
                   lambda conn, actor: bulk.match_rows(bulk.parse_csv(body.csv),
                                                       all_songs(conn, actor)))

    @app.post("/api/business/content/import/apply")
    def import_apply(body: CsvBody, request: Request) -> dict[str, Any]:
        def work(conn, actor):
            found = bulk.match_rows(bulk.parse_csv(body.csv), all_songs(conn, actor))
            saved = bulk.import_apply(conn, actor, organisation_id=actor.organisation_id,
                                      workspace_id=actor.workspace_id, matched=found["matched"])
            return {**saved, "counts": found["counts"]}
        return run(request, bulk_flags, ("business.songs.flag",), work)

    # -- "Worth checking" --------------------------------------------------------------------

    @app.get("/api/business/content/worth-checking")
    def worth_checking(request: Request, limit: int = HINT_BATCH) -> dict[str, Any]:
        def work(conn, actor):
            flags = store.flags_map(conn, actor.organisation_id)
            songs = sorted(all_songs(conn, actor),
                           key=lambda s: (flags.get(s.song_id, s.explicit) != "unknown",
                                          s.title.casefold()))
            budget = max(1, min(limit, HINT_BATCH))
            items = []
            for song in songs:
                with _lyrics_lock:
                    cached = _lyrics_cache.get(song.song_id)
                if cached is None:
                    if budget <= 0:
                        continue
                    budget -= 1
                    cached = lyrics_source(song)
                    with _lyrics_lock:
                        _lyrics_cache[song.song_id] = cached
                items.append((song, cached[0], cached[1]))
            found = lyrics_hint.worth_checking(items, flags=flags)
            found["checked"] = len(items)
            found["library"] = len(songs)
            return found
        return run(request, (gate.ENGINE, gate.LYRICS_HINT), ("business.rules.read",), work)


def clear_lyrics_cache() -> None:
    with _lyrics_lock:
        _lyrics_cache.clear()


__all__ = ["EXPLICIT_VALUES", "clear_lyrics_cache", "install_routes", "lrclib_lyrics"]
