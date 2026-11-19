"""Business workspace routes the pages call that no other package answers (ADR-0444/0449/0450).

- `POST /api/business/schedules/apply` (`business.schedules`): apply one day of dayparts to every
  zone of the chosen venues, as each zone's weekly programme (the same blocks every weekday).
  With `preview` it changes nothing and answers how many venues change, how many are open now,
  and any zone whose programme changed since the page read it (`versions`: zone id to the
  `created_at` of the programme version the page saw). A real apply refuses while there are
  conflicts the page has not resolved. A zone mid-song is never cut: the zone clock reads the
  new programme at its next block (ADR-0444).
- `GET /api/business/library/songs` and `POST /api/business/library/explicit`
  (`business.content_controls`): the organisation's songs with title, artist and explicit mark,
  and marking
  many at once in one transaction (each mark audited, as the one-song route does).
- `PUT /api/business/venues/{venue_id}/licence` (`business.licensing`): record the venue's music
  licence attestation through `licensing.record_licence` (dates in the venue's own day).

Every route resolves the caller with `guard.actor_for` and checks one business permission per
venue with `guard.require`, so a venue outside the caller's scope answers 404.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import date, datetime, time
from typing import Any, Literal
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta.business import venues as venue_store
from selecta.business import zone_clock
from selecta.business import zones as zone_store
from selecta.business.access import BusinessActor, BusinessError, BusinessInvalid
from selecta.business.access import guard as business_guard
from selecta.business.errors import BusinessError as DomainError
from selecta.business.errors import NotFound as DomainNotFound
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, new_id, transaction

NOT_FOUND = {"code": "not_found"}
ENERGY = {"calm": 25, "steady": 50, "lifted": 70, "peak": 90}
WORDS = sorted(ENERGY.items(), key=lambda item: item[1])
OPEN = frozenset({"opening", "open", "closing"})


class Part(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    start: int = Field(ge=0, lt=24 * 60)
    end: int | None = Field(default=None, ge=0, le=48 * 60)
    energy: Literal["calm", "steady", "lifted", "peak"] = "steady"
    crate_ids: list[str] = Field(default_factory=list, max_length=50)


class ApplyBody(BaseModel):
    venue_ids: list[str] = Field(min_length=1, max_length=1000)
    dayparts: list[Part] = Field(min_length=1, max_length=24)
    versions: dict[str, float] = Field(default_factory=dict)
    preview: bool = False


class ExplicitBody(BaseModel):
    song_ids: list[str] = Field(min_length=1, max_length=2000)
    explicit: Literal["explicit", "clean", "unknown"]


class LicenceBody(BaseModel):
    kind: Literal["themusiclicence", "other"]
    other_name: str | None = Field(default=None, max_length=128)
    number: str = Field(min_length=1, max_length=128)
    expires_on: date
    rights_confirmed: bool


def blocks_of(parts: list[Part]) -> list[dict[str, Any]]:
    """The client's dayparts as programme blocks (start as HH:MM, energy as a level)."""
    blocks = []
    for part in sorted(parts, key=lambda p: p.start):
        blocks.append({
            "start": f"{part.start // 60:02d}:{part.start % 60:02d}",
            "name": part.name.strip(),
            "crates": [c for c in part.crate_ids if c],
            "energy": ENERGY[part.energy],
        })
    return blocks


def parts_of(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Programme blocks back as the client's dayparts; each ends where the next starts."""
    out = []
    starts = []
    for block in blocks:
        hours, minutes = str(block.get("start", "00:00")).split(":")
        starts.append(int(hours) * 60 + int(minutes))
    for index, block in enumerate(blocks):
        level = block.get("energy") if isinstance(block.get("energy"), int) else 50
        word = min(WORDS, key=lambda item: abs(item[1] - level))[0]
        out.append({
            "id": f"{index}",
            "name": block.get("name") or "",
            "start": starts[index],
            "end": starts[index + 1] if index + 1 < len(starts) else 24 * 60,
            "energy": word,
            "crate_ids": list(block.get("crates") or []),
        })
    return out


def _current(conn: Connection, workspace_id: str, zone_id: str) -> dict[str, Any] | None:
    from selecta.routes.business_zones import current_programme

    return current_programme(conn, workspace_id, zone_id)


def _write(conn: Connection, workspace_id: str, venue_id: str, zone_id: str,
           programme: dict[str, Any], by: str, now: float) -> None:
    from selecta.business.hours_schema import zone_programme_versions, zone_programmes

    version_id = new_id()
    conn.execute(zone_programme_versions.insert().values(
        id=version_id, workspace_id=workspace_id, zone_id=zone_id, blocks_json=programme,
        created_by=by, created_at=now))
    updated = conn.execute(
        sa.update(zone_programmes)
        .where(zone_programmes.c.workspace_id == workspace_id, zone_programmes.c.zone_id == zone_id)
        .values(current_version_id=version_id, updated_at=now)
    ).rowcount
    if not updated:
        conn.execute(zone_programmes.insert().values(
            zone_id=zone_id, workspace_id=workspace_id, venue_id=venue_id,
            current_version_id=version_id, updated_at=now))


def _open_now(conn: Connection, workspace_id: str, venue: dict, zone_id: str, now: float) -> bool:
    ref = zone_clock.ZoneRef(workspace_id=workspace_id, venue_id=venue["id"], zone_id=zone_id,
                             tz=venue["timezone"])
    try:
        return zone_clock.compute(conn, ref, now).state in OPEN
    except Exception:  # noqa: BLE001 - no hours yet reads as closed
        return False


def apply_schedule(conn: Connection, actor: BusinessActor, body: ApplyBody, now: float) -> dict:
    from selecta.business.dayparts import Programme, ProgrammeError

    blocks = blocks_of(body.dayparts)
    try:
        programme = Programme.from_dict({"weekly": {str(d): blocks for d in range(7)}}).to_dict()
    except (ProgrammeError, ValueError) as error:
        raise BusinessInvalid(str(error), code="programme") from error
    ours = parts_of(blocks)
    venue_ids = list(dict.fromkeys(body.venue_ids))
    targets, open_now, conflicts = [], 0, []
    for venue_id in venue_ids:
        business_guard.require(conn, actor, "business.schedule.edit", venue_id=venue_id)
        venue = venue_store.get(conn, actor.workspace_id, venue_id)
        zones = zone_store.list_zones(conn, actor.workspace_id, venue_id)
        if zones and _open_now(conn, actor.workspace_id, venue, zones[0]["id"], now):
            open_now += 1
        for zone in zones:
            current = _current(conn, actor.workspace_id, zone["id"])
            seen = body.versions.get(zone["id"])
            if current is not None and seen is not None and float(current["created_at"]) != seen:
                weekly = (current["blocks_json"] or {}).get("weekly") or {}
                theirs = parts_of(weekly.get("0") or next(iter(weekly.values()), []))
                conflicts.append({
                    "venue_id": venue_id, "zone_id": zone["id"],
                    "updated_by": current["created_by"] or "",
                    "updated_at": float(current["created_at"]),
                    "theirs": theirs, "ours": ours,
                })
            targets.append((venue_id, zone["id"]))
    if body.preview:
        return {"venues": len(venue_ids), "open_now": open_now, "conflicts": conflicts}
    if conflicts:
        raise HTTPException(status_code=409, detail={
            "code": "schedule_conflict", "message": "Someone changed these schedules just now.",
            "conflicts": conflicts})
    for venue_id, zone_id in targets:
        _write(conn, actor.workspace_id, venue_id, zone_id, programme, actor.id, now)
    return {"applied": len(targets), "venues": len(venue_ids), "open_now": open_now}


def library_songs(conn: Connection, actor: BusinessActor) -> list[dict[str, Any]]:
    """Every live upload of the organisation with its title and artist from the song catalogue
    (`local_songs`, matched by content hash), else the upload's own name and no artist."""
    from selecta.business.content import store
    from selecta.local_media.schema import local_songs
    from selecta.storage.schema import assets, upload_sessions

    flags = store.flags_map(conn, actor.organisation_id)
    rows = conn.execute(
        sa.select(assets.c.id, assets.c.sha256, upload_sessions.c.display_name)
        .select_from(assets.outerjoin(upload_sessions, sa.and_(
            upload_sessions.c.id == assets.c.id,
            upload_sessions.c.workspace_id == assets.c.workspace_id)))
        .where(assets.c.workspace_id == actor.workspace_id, assets.c.deleted_at.is_(None))
        .limit(5000)
    ).all()
    catalogue: dict[str, tuple[str | None, str | None]] = {}
    hashes = sorted({row.sha256 for row in rows if row.sha256})
    for start in range(0, len(hashes), 500):
        for song in conn.execute(
            sa.select(local_songs.c.content_sha256, local_songs.c.title, local_songs.c.artist)
            .where(local_songs.c.workspace_id == actor.workspace_id,
                   local_songs.c.content_sha256.in_(hashes[start:start + 500]),
                   local_songs.c.deleted_at.is_(None))
        ):
            catalogue.setdefault(song.content_sha256, (song.title, song.artist))
    songs = []
    for row in rows:
        title, artist = catalogue.get(row.sha256, (None, None))
        songs.append({"id": row.id, "title": title or row.display_name or "Untitled",
                      "artist": artist or "", "explicit": flags.get(row.id, "unknown")})
    songs.sort(key=lambda song: (song["title"].casefold(), song["artist"].casefold(), song["id"]))
    return songs


def record_licence(conn: Connection, actor: BusinessActor, venue_id: str, body: LicenceBody,
                   now: float) -> dict[str, Any]:
    from selecta.business import licensing
    from selecta.business.commercial_facts import SqlFacts
    from selecta.business.workspace_view import _licence

    if body.rights_confirmed is not True:
        raise BusinessInvalid("Confirm the venue holds the rights to play its music.",
                              code="rights_attestation_required")
    venue = venue_store.get(conn, actor.workspace_id, venue_id)
    tz = ZoneInfo(venue["timezone"])
    expires_at = datetime.combine(body.expires_on, time(23, 59, 59), tz).timestamp()
    if expires_at <= now:
        raise BusinessInvalid("This date has passed. Enter your current licence.",
                              code="licence_expired")
    org = SqlFacts().organisation(conn, actor.organisation_id)
    if org is None:
        raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
    licensing.record_licence(
        conn, org, venue_id, territory=venue["country"],
        licence_type="themusiclicence" if body.kind == "themusiclicence" else licensing.OTHER,
        licence_number=body.number, holder_name=org.name, starts_at=now, expires_at=expires_at,
        rights_attested=True, actor=actor.id, now=now, society=body.other_name,
    )
    return {"venue_id": venue_id, "licence": _licence(conn, venue_id)}


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
) -> None:
    @contextmanager
    def acting(
        request: Request, claims: Claims
    ) -> Iterator[tuple[Connection, BusinessActor, float]]:
        found = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if found.workspace.kind != "business":
            raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
        workspace_id = found.workspace.id
        try:
            with transaction(engine, workspace_id) as conn:
                actor = business_guard.actor_for(
                    conn, user_id=found.user.id, organisation_id=workspace_id,
                    workspace_id=workspace_id)
                yield conn, actor, float(db_now(conn))
        except BusinessError as error:
            raise HTTPException(status_code=error.status,
                                detail={"code": error.code, "message": str(error)}) from error
        except DomainNotFound as error:
            raise HTTPException(status_code=404, detail=dict(NOT_FOUND)) from error
        except DomainError as error:  # licensing and the venue stores' refusals
            raise HTTPException(status_code=getattr(error, "status", 422),
                                detail={"code": error.code, "message": str(error)}) from error

    @app.post("/api/business/schedules/apply")
    def schedules_apply(body: ApplyBody, request: Request,
                        claims: Claims = Depends(current_claims)):  # noqa: B008
        with acting(request, claims) as (conn, actor, now):
            return apply_schedule(conn, actor, body, now)

    @app.get("/api/business/library/songs")
    def songs(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        with acting(request, claims) as (conn, actor, _now):
            business_guard.require(conn, actor, "business.rules.read")
            return {"songs": library_songs(conn, actor)}

    @app.post("/api/business/library/explicit")
    def mark_explicit(body: ExplicitBody, request: Request,
                      claims: Claims = Depends(current_claims)):  # noqa: B008
        from selecta.business.content import editing

        with acting(request, claims) as (conn, actor, now):
            business_guard.require(conn, actor, "business.songs.flag")
            known = {song["id"] for song in library_songs(conn, actor)}
            unknown = [song_id for song_id in body.song_ids if song_id not in known]
            if unknown:
                raise HTTPException(status_code=422, detail={
                    "code": "unknown_songs", "song_ids": unknown[:20]})
            for song_id in dict.fromkeys(body.song_ids):
                editing.set_song_flag(conn, actor, organisation_id=actor.organisation_id,
                                      workspace_id=actor.workspace_id, song_id=song_id,
                                      explicit=body.explicit, now=now)
        return {"updated": len(set(body.song_ids))}

    @app.put("/api/business/venues/{venue_id}/licence")
    def save_licence(venue_id: str, body: LicenceBody, request: Request,
                     claims: Claims = Depends(current_claims)):  # noqa: B008
        with acting(request, claims) as (conn, actor, now):
            business_guard.require(conn, actor, "business.licence.edit", venue_id=venue_id)
            return record_licence(conn, actor, venue_id, body, now)


__all__ = ["apply_schedule", "blocks_of", "install_routes", "parts_of"]
