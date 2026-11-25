"""Asking for a catalogue lookup, the job that does it, and reading what it found (ADR-0478).

**Asking.** `enqueue_for_song` (and `enqueue_for_songs`) runs when a signed-in person's page asks
for covers. Nothing happens unless the flag `library.art_lookup` is on and the person turned on
"Look up covers and details on the web" (`allowed`). The song's normalised query gives one
`catalog_lookups` key, shared by every workspace: the workspace's `song_catalog_links` row points
at it, and a `catalog.lookup` job is queued only when the key has never run, or its retry time has
come. A finished lookup is copied to the new link at once, with no job.

**The job.** `run_lookup` claims the key (so two workers never ask twice), asks MusicBrainz (ISRC
first, then the search), matches (`match`), fetches the front cover of the best release from the
Cover Art Archive at 500 px, stores it in our own object storage under `catalog/v1/art/`, computes
a palette hue when Pillow is installed, stores the text, and fills every link waiting on the key
in every workspace. Network calls happen outside any database transaction. A miss or an error is
remembered with a retry time (`RETRY_*`), so it is not asked again at once. Running it twice is
harmless: a key that is not due is skipped, and a cover already stored is reused.

**Retries happen on view, by decision (T-20261125-238e).** Nothing sweeps due retries in the
background. A due key is queued again the next time a page shows that song, which is when a cover
is wanted. A sweep would spend the shared MusicBrainz allowance on songs nobody is looking at, and
would ask on behalf of people who may have turned lookups off since (`allowed` is checked at each
ask, with the person present).

**Reading.** `art_for_songs` answers the page: per song, the cover's URLs on our own origin, its
sizes, hue and confidence, and the details as suggestions. A person's choice ("Wrong cover?":
another release, or the generated tile) always wins over the lookup. A hidden image is never
offered and its bytes answer 404.
"""

from __future__ import annotations

import colorsys
import hashlib
import io
import os
import tempfile
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.engine import Connection, Engine

from selecta import flags, persistence
from selecta.catalog import match
from selecta.catalog.client import CatalogUnavailable, MusicBrainz, use_global_limit
from selecta.catalog.schema import (
    catalog_art,
    catalog_lookups,
    catalog_recordings,
    catalog_releases,
    song_catalog_links,
)
from selecta.flags.rules import user_flag_preferences
from selecta.local_media.schema import local_songs
from selecta.persistence import db_now, new_id, transaction
from selecta.usage.schema import insert_ignore, upsert

FLAG = "library.art_lookup"
JOB_TYPE = "catalog.lookup"
SETTING_ID = "catalog:lookups"
"""Stored in `user_flag_preferences` beside the Lucy choices; no flag id has a colon."""
ART_PREFIX = "catalog/v1/art/"
DAY = 86_400.0
RETRY_NO_MATCH_S = 30 * DAY
RETRY_AMBIGUOUS_S = 30 * DAY
REFRESH_MATCHED_S = 180 * DAY
RETRY_ERROR_BASE_S = 3_600.0
RETRY_ERROR_MAX_S = 7 * DAY
STALE_RUN_S = 3_600.0
COVER_ABSENT_RECHECK_S = 30 * DAY
COVER_TRIES = 3
MAX_SONGS_PER_ASK = 200
EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


# --- the person's setting ---------------------------------------------------------------------


def allowed(conn: Connection, user_id: str) -> bool:
    """Whether this person allows web lookups. Off unless they turned it on."""
    value = conn.execute(
        sa.select(user_flag_preferences.c.enabled).where(
            user_flag_preferences.c.user_id == user_id,
            user_flag_preferences.c.flag_id == SETTING_ID,
        )
    ).scalar()
    return bool(value)


def set_allowed(conn: Connection, user_id: str, on: bool) -> bool:
    insert = postgresql.insert if persistence.is_postgres(conn) else sqlite.insert
    now = db_now(conn)
    conn.execute(
        insert(user_flag_preferences)
        .values(user_id=user_id, flag_id=SETTING_ID, enabled=on, updated_at=now)
        .on_conflict_do_update(
            index_elements=[user_flag_preferences.c.user_id, user_flag_preferences.c.flag_id],
            set_={"enabled": on, "updated_at": now},
        )
    )
    return on


# --- asking -----------------------------------------------------------------------------------


def _due(row: Any, now: float) -> bool:
    if row is None:
        return True
    if row.outcome in ("pending", "running"):
        return now - float(row.updated_at) > STALE_RUN_S
    return row.next_retry_at is not None and float(row.next_retry_at) <= now


def _copy_result(conn: Connection, key: str, now: float, *, workspace_id: str | None = None):
    """Fill the links waiting on `key` (one workspace's, or every workspace's) from the lookup."""
    row = conn.execute(sa.select(catalog_lookups).where(catalog_lookups.c.key == key)).first()
    if row is None or row.outcome in ("pending", "running"):
        return
    matched = row.outcome == "matched"
    statement = song_catalog_links.update().where(song_catalog_links.c.lookup_key == key)
    if workspace_id is not None:
        statement = statement.where(song_catalog_links.c.workspace_id == workspace_id)
    conn.execute(
        statement.values(
            recording_id=row.recording_id if matched else None,
            release_id=row.release_id if matched else None,
            method=row.method if matched else None,
            confidence=row.confidence if matched else None,
            updated_at=now,
        )
    )


def prepare_link(
    conn: Connection, workspace_id: str, song_id: int, *, isrc: str | None = None
) -> str | None:
    """Point the song at its lookup key. Returns the key when a job should run for it, else
    None (no such song, nothing to search with, or the key already has a fresh answer)."""
    from selecta.business.isrc import normalise as normalise_isrc

    song = conn.execute(
        sa.select(local_songs.c.title, local_songs.c.artist, local_songs.c.album,
                  local_songs.c.duration_s)
        .where(local_songs.c.workspace_id == workspace_id, local_songs.c.id == song_id,
               local_songs.c.deleted_at.is_(None))
    ).first()
    if song is None:
        return None
    query = match.Query(song.artist, song.title, song.album, song.duration_s,
                        normalise_isrc(isrc))
    if not query.isrc and not (match.normalise_artist(query.artist)
                               and match.normalise_title(query.title) and query.duration_s):
        return None
    key = match.lookup_key(query)
    now = db_now(conn)
    insert_ignore(conn, catalog_lookups, {
        "key": key, "query": query.sent(), "outcome": "pending", "candidates": [],
        "attempts": 0, "created_at": now, "updated_at": now, "next_retry_at": None,
    }, ("key",))
    insert_ignore(conn, song_catalog_links, {
        "workspace_id": workspace_id, "song_id": song_id, "lookup_key": key, "choice": "auto",
        "created_at": now, "updated_at": now,
    }, ("workspace_id", "song_id"))
    conn.execute(
        song_catalog_links.update()
        .where(song_catalog_links.c.workspace_id == workspace_id,
               song_catalog_links.c.song_id == song_id,
               song_catalog_links.c.lookup_key != key)
        .values(lookup_key=key, recording_id=None, release_id=None, method=None,
                confidence=None, updated_at=now)
    )
    _copy_result(conn, key, now, workspace_id=workspace_id)
    row = conn.execute(sa.select(catalog_lookups).where(catalog_lookups.c.key == key)).first()
    if row.outcome == "pending" and row.attempts == 0:
        return key
    return key if _due(row, now) else None


def _queue_jobs(engine: Engine, workspace_id: str, keys: Iterable[str], user_id: str) -> int:
    from selecta.work.enqueue import JobSpec
    from selecta.work.store import JobStore

    store = JobStore(engine)
    made = 0
    for key in dict.fromkeys(keys):
        store.enqueue(JobSpec(workspace_id=workspace_id, type=JOB_TYPE, idempotency_key=key,
                              input_ref={"key": key}, created_by=user_id))
        made += 1
    return made


def enqueue_for_songs(
    engine: Engine, workspace_id: str, user_id: str, songs: Iterable[tuple[int, str | None]]
) -> int:
    """Ask for lookups for `(song_id, isrc)` pairs. Returns how many jobs were queued (an
    existing unfinished job for the same key is reused, so this is safe to repeat)."""
    if not flags.on(FLAG):
        return 0
    with transaction(engine, workspace_id) as conn:
        if not allowed(conn, user_id):
            return 0
        keys = [
            key
            for song_id, isrc in list(songs)[:MAX_SONGS_PER_ASK]
            if (key := prepare_link(conn, workspace_id, int(song_id), isrc=isrc))
        ]
    return _queue_jobs(engine, workspace_id, keys, user_id) if keys else 0


def enqueue_for_song(
    engine: Engine, workspace_id: str, user_id: str, song_id: int, *, isrc: str | None = None
) -> bool:
    return enqueue_for_songs(engine, workspace_id, user_id, [(song_id, isrc)]) > 0


# --- the job ----------------------------------------------------------------------------------


def palette_hue(data: bytes) -> int | None:
    """The dominant hue (0 to 359) of the saturated pixels, or None. Needs Pillow, which is not
    a dependency today, so this answers None until it is."""
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError:
        return None
    try:
        with Image.open(io.BytesIO(data)) as image:
            pixels = list(image.convert("RGB").resize((24, 24)).getdata())
    except Exception:  # noqa: BLE001 - an odd image only loses its hue
        return None
    weights = [0.0] * 36
    for red, green, blue in pixels:
        hue, light, sat = colorsys.rgb_to_hls(red / 255, green / 255, blue / 255)
        if sat >= 0.25 and 0.12 <= light <= 0.9:
            weights[int(hue * 36) % 36] += sat
    best = max(range(36), key=weights.__getitem__)
    return best * 10 + 5 if weights[best] > 0 else None


def _claim(engine: Engine, key: str) -> dict | None:
    with transaction(engine) as conn:
        row = conn.execute(
            persistence.lock_rows(sa.select(catalog_lookups).where(catalog_lookups.c.key == key))
        ).first()
        now = db_now(conn)
        fresh = row is not None and row.outcome == "pending" and row.attempts == 0
        if row is None or not (fresh or _due(row, now)):
            if row is not None:
                _copy_result(conn, key, now)
            return None
        conn.execute(catalog_lookups.update().where(catalog_lookups.c.key == key).values(
            outcome="running", attempts=row.attempts + 1, updated_at=now))
        return {"query": dict(row.query), "attempts": row.attempts + 1}


def _search(mb: MusicBrainz, query: match.Query) -> match.Outcome:
    outcome = match.Outcome("no_match")
    if query.isrc:
        outcome = match.by_isrc(query, mb.recordings_by_isrc(query.isrc))
    if not outcome.matched and query.artist and query.title and query.duration_s:
        outcome = match.choose(query, mb.search_recordings(query.artist, query.title))
    return outcome


def _store_cover(objects, bucket: str, data: bytes, content_type: str) -> dict[str, Any]:
    art_id = new_id()
    key = f"{ART_PREFIX}{art_id}/500.{EXTENSIONS.get(content_type, 'img')}"
    objects.put_object(bucket, key, data, content_type=content_type,
                       metadata={"sha256": hashlib.sha256(data).hexdigest()})
    return {"id": art_id, "sizes": {"500": key}, "content_type": content_type,
            "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
            "palette_hue": palette_hue(data)}


def _known_covers(engine: Engine, release_ids: list[str]) -> tuple[set[str], set[str]]:
    """Releases that already have stored art, and those recently found to have none."""
    if not release_ids:
        return set(), set()
    with transaction(engine) as conn:
        now = db_now(conn)
        have = set(conn.execute(sa.select(catalog_art.c.release_id)
                                .where(catalog_art.c.release_id.in_(release_ids))).scalars())
        absent = set(conn.execute(
            sa.select(catalog_releases.c.id).where(
                catalog_releases.c.id.in_(release_ids), catalog_releases.c.cover == "absent",
                catalog_releases.c.cover_checked_at > now - COVER_ABSENT_RECHECK_S)
        ).scalars())
    return have, absent


def _fetch_cover(engine, mb, objects, bucket, ranked: list[dict]) -> tuple[str | None, dict, dict]:
    """Try the best releases' front covers, then the first one's release group. Returns the
    release the cover is filed under (None when there is none), new art, and cover states."""
    ids = [str(r["id"]) for r in ranked[:COVER_TRIES]]
    have, absent = _known_covers(engine, ids)
    states: dict[str, str] = {}
    for release_id in ids:
        if release_id in have:
            return release_id, {}, states
        if release_id in absent:
            continue
        found = mb.front_cover(release_id)
        states[release_id] = "present" if found else "absent"
        if found:
            return release_id, {**_store_cover(objects, bucket, *found),
                                "source": "caa-release", "release_id": release_id}, states
    group = (ranked[0].get("release-group") or {}).get("id") if ranked else None
    if group:
        found = mb.front_cover(str(group), release_group=True)
        if found:
            release_id = ids[0]
            return release_id, {**_store_cover(objects, bucket, *found),
                                "source": "caa-release-group", "release_id": release_id}, states
    return None, {}, states


def _save(engine: Engine, key: str, outcome: match.Outcome, releases: list[dict],
          recording: dict | None, cover_release: str | None, art: dict, states: dict) -> None:
    with transaction(engine) as conn:
        now = db_now(conn)
        if releases:
            rows = [{**match.release_facts(r), "fetched_at": now} for r in releases]
            upsert(conn, catalog_releases, rows, ("id",),
                   [c for c in rows[0] if c != "id"])
        for release_id, state in states.items():
            conn.execute(catalog_releases.update().where(catalog_releases.c.id == release_id)
                         .values(cover=state, cover_checked_at=now))
        if recording is not None:
            facts = match.recording_facts(recording, [str(r["id"]) for r in releases])
            upsert(conn, catalog_recordings, [{**facts, "fetched_at": now}], ("id",),
                   [c for c in facts if c != "id"] + ["fetched_at"])
        if art:
            insert_ignore(conn, catalog_art, {**art, "fetched_at": now, "hidden": False},
                          ("release_id",))
        retry = {"matched": REFRESH_MATCHED_S, "ambiguous": RETRY_AMBIGUOUS_S}
        conn.execute(catalog_lookups.update().where(catalog_lookups.c.key == key).values(
            outcome=outcome.status, method=outcome.method, confidence=outcome.confidence,
            recording_id=outcome.recording_id,
            release_id=cover_release or (outcome.release_ids[0] if outcome.release_ids else None),
            candidates=match.candidates_json(outcome), last_error=None, updated_at=now,
            next_retry_at=now + retry.get(outcome.status, RETRY_NO_MATCH_S)))
        _copy_result(conn, key, now)


def _failed(engine: Engine, key: str, attempts: int, error: Exception) -> None:
    with transaction(engine) as conn:
        now = db_now(conn)
        wait = min(RETRY_ERROR_BASE_S * 2 ** max(attempts - 1, 0), RETRY_ERROR_MAX_S)
        conn.execute(catalog_lookups.update().where(catalog_lookups.c.key == key).values(
            outcome="error", last_error=str(error)[:200], updated_at=now,
            next_retry_at=now + wait))


def _default_objects():
    from selecta.storage import api as storage_api

    return storage_api.r2_client(), storage_api.buckets().derived


def run_lookup(
    engine: Engine,
    key: str,
    *,
    musicbrainz: MusicBrainz | None = None,
    objects=None,
    bucket: str | None = None,
) -> dict[str, Any]:
    """The `catalog.lookup` job for one key (module notes). Returns a small summary."""
    if not flags.on(FLAG):
        return {"skipped": "flag_off"}
    claimed = _claim(engine, key)
    if claimed is None:
        return {"skipped": "not_due"}
    sent = claimed["query"]
    query = match.Query(sent.get("artist") or "", sent.get("title") or "", sent.get("album"),
                        sent.get("duration_s"), sent.get("isrc"))
    if objects is None or bucket is None:
        objects, bucket = _default_objects()
    use_global_limit(engine)
    mb = musicbrainz or MusicBrainz()
    try:
        outcome = _search(mb, query)
        releases: list[dict] = []
        recording = None
        cover_release, art, states = None, {}, {}
        if outcome.matched:
            recording = mb.recording(outcome.recording_id) or {"id": outcome.recording_id}
            pool = {str(r["id"]): r for c in outcome.candidates for r in c.releases if r.get("id")}
            for release in recording.get("releases") or []:
                if isinstance(release, dict) and release.get("id"):
                    pool[str(release["id"])] = release
            wanted = set(outcome.release_ids) | {
                str(r["id"]) for r in recording.get("releases") or [] if isinstance(r, dict)
            }
            releases = match.rank_releases([pool[i] for i in wanted if i in pool])
            cover_release, art, states = _fetch_cover(engine, mb, objects, bucket, releases)
        _save(engine, key, outcome, releases, recording, cover_release, art, states)
    except (CatalogUnavailable, OSError) as error:
        _failed(engine, key, claimed["attempts"], error)
        return {"outcome": "error"}
    finally:
        if musicbrainz is None:
            mb.close()
    return {"outcome": outcome.status, "method": outcome.method, "cover": bool(cover_release)}


_engines: dict[str, Engine] = {}


def handle_job(job, _context) -> dict[str, Any]:
    """The worker handler for `catalog.lookup`. It needs the database, so it runs only where
    `SELECTA_DATABASE_URL` is set (the dev stack's worker; see the report on deployment)."""
    url = os.environ.get("SELECTA_DATABASE_URL", "").strip()
    ref = job.input_ref if isinstance(job.input_ref, dict) else {}
    key, release_id = ref.get("key"), ref.get("release_id")
    if not url:
        return {"skipped": "no_database"}
    if url not in _engines:
        _engines[url] = persistence.make_engine(url)
    if isinstance(release_id, str) and len(release_id) == 36:
        if not flags.on(FLAG):
            return {"skipped": "flag_off"}
        use_global_limit(_engines[url])
        return {"cover": fetch_release_cover(_engines[url], release_id)}
    if not isinstance(key, str) or len(key) != 64:
        return {"skipped": "no_key"}
    return run_lookup(_engines[url], key)


def queue_cover_fetch(engine: Engine, workspace_id: str, user_id: str, release_id: str) -> None:
    """Queue the cover of a release the person picked, when it isn't stored yet."""
    from selecta.work.enqueue import JobSpec
    from selecta.work.store import JobStore

    JobStore(engine).enqueue(JobSpec(
        workspace_id=workspace_id, type=JOB_TYPE, idempotency_key=f"cover:{release_id}",
        input_ref={"release_id": release_id}, created_by=user_id))


def handlers() -> dict[str, Callable[..., Any]]:
    return {JOB_TYPE: handle_job}


# --- reading ----------------------------------------------------------------------------------


def art_url(art_id: str, size: str = "500") -> str:
    return f"/api/catalog/art/{art_id}/{size}"


def _art_answer(row: Any) -> dict[str, Any]:
    sizes = {size: art_url(row.id, size) for size in sorted(row.sizes or {})}
    return {"id": row.id, "url": sizes.get("500") or next(iter(sizes.values()), None),
            "sizes": sizes, "hue": row.palette_hue, "source": row.source}


def art_for_songs(conn: Connection, workspace_id: str, song_ids: list[int]) -> list[dict]:
    """Per song: state (none, pending, matched, generated), the art, details and confidence."""
    if not song_ids:
        return []
    links = {
        row.song_id: row
        for row in conn.execute(sa.select(song_catalog_links).where(
            song_catalog_links.c.workspace_id == workspace_id,
            song_catalog_links.c.song_id.in_(song_ids)))
    }
    release_ids = {
        (r.chosen_release_id if r.choice == "release" else r.release_id)
        for r in links.values()
    } - {None}
    arts = {row.release_id: row for row in conn.execute(sa.select(catalog_art).where(
        catalog_art.c.release_id.in_(release_ids), catalog_art.c.hidden.is_(False)))}
    releases = {row.id: row for row in conn.execute(
        sa.select(catalog_releases).where(catalog_releases.c.id.in_(release_ids)))}
    recording_ids = {r.recording_id for r in links.values()} - {None}
    recordings = {row.id: row for row in conn.execute(
        sa.select(catalog_recordings).where(catalog_recordings.c.id.in_(recording_ids)))}
    pending = {
        row.key for row in conn.execute(sa.select(catalog_lookups.c.key).where(
            catalog_lookups.c.key.in_({r.lookup_key for r in links.values()}),
            catalog_lookups.c.outcome.in_(("pending", "running"))))
    }
    out = []
    for song_id in song_ids:
        link = links.get(song_id)
        answer: dict[str, Any] = {"song_id": song_id, "state": "none", "art": None,
                                  "confidence": None, "method": None, "details": None}
        if link is None:
            out.append(answer)
            continue
        if link.choice == "generated":
            out.append({**answer, "state": "generated"})
            continue
        release_id = link.chosen_release_id if link.choice == "release" else link.release_id
        if link.choice == "auto" and link.lookup_key in pending and release_id is None:
            out.append({**answer, "state": "pending"})
            continue
        if release_id is None:
            out.append(answer)
            continue
        release, recording, art = (releases.get(release_id), recordings.get(link.recording_id),
                                   arts.get(release_id))
        out.append({
            **answer,
            "state": "matched",
            "chosen": link.choice == "release",
            "art": _art_answer(art) if art is not None else None,
            "confidence": link.confidence,
            "method": link.method,
            "details": {
                "recording_id": link.recording_id, "release_id": release_id,
                "title": recording.title if recording else None,
                "artist": recording.artist if recording else None,
                "album": release.title if release else None,
                "year": release.year if release else None,
                "isrc": (recording.isrcs or [None])[0] if recording else None,
            },
        })
    return out


def candidates_for_song(conn: Connection, workspace_id: str, song_id: int) -> dict[str, Any]:
    """The releases a person may pick in "Wrong cover?", plus the generated tile."""
    link = conn.execute(sa.select(song_catalog_links).where(
        song_catalog_links.c.workspace_id == workspace_id,
        song_catalog_links.c.song_id == song_id)).first()
    if link is None:
        raise LookupError("There is no lookup for that song yet.")
    lookup = conn.execute(sa.select(catalog_lookups).where(
        catalog_lookups.c.key == link.lookup_key)).first()
    ids: list[str] = []
    if link.recording_id:
        recording = conn.execute(sa.select(catalog_recordings.c.release_ids).where(
            catalog_recordings.c.id == link.recording_id)).scalar()
        ids.extend(recording or [])
    ids.extend(c.get("release_id") for c in (lookup.candidates if lookup else []) or [])
    ids = [i for i in dict.fromkeys(ids) if i]
    rows = {r.id: r for r in conn.execute(
        sa.select(catalog_releases).where(catalog_releases.c.id.in_(ids)))}
    arts = {r.release_id: r for r in conn.execute(sa.select(catalog_art).where(
        catalog_art.c.release_id.in_(ids), catalog_art.c.hidden.is_(False)))}
    current = link.chosen_release_id if link.choice == "release" else link.release_id
    return {
        "song_id": song_id,
        "choice": link.choice,
        "outcome": lookup.outcome if lookup else None,
        "releases": [
            {"release_id": i, "title": rows[i].title, "artist": rows[i].artist,
             "date": rows[i].date, "year": rows[i].year, "status": rows[i].status,
             "type": rows[i].primary_type, "cover": rows[i].cover,
             "art": _art_answer(arts[i]) if i in arts else None,
             "current": link.choice != "generated" and i == current}
            for i in ids if i in rows
        ],
    }


def set_choice(conn: Connection, workspace_id: str, song_id: int, user_id: str, *,
               choice: str, release_id: str | None = None) -> str | None:
    """Keep the person's choice. Returns a release id whose cover still needs fetching."""
    if choice not in ("auto", "release", "generated"):
        raise ValueError("Choose a release, the generated tile, or automatic.")
    offered = {r["release_id"]: r for r in candidates_for_song(
        conn, workspace_id, song_id)["releases"]}
    if choice == "release" and release_id not in offered:
        raise ValueError("That release isn't one of this song's candidates.")
    conn.execute(song_catalog_links.update().where(
        song_catalog_links.c.workspace_id == workspace_id,
        song_catalog_links.c.song_id == song_id).values(
        choice=choice, chosen_release_id=release_id if choice == "release" else None,
        chosen_by=user_id, updated_at=db_now(conn)))
    if choice == "release" and offered[release_id]["art"] is None \
            and offered[release_id]["cover"] != "absent":
        return release_id
    return None


def fetch_release_cover(engine: Engine, release_id: str, *, musicbrainz=None, objects=None,
                        bucket: str | None = None) -> bool:
    """Fetch one release's cover (a person picked it in "Wrong cover?"). Idempotent."""
    with transaction(engine) as conn:
        release = conn.execute(sa.select(catalog_releases).where(
            catalog_releases.c.id == release_id)).first()
    if release is None:
        return False
    if objects is None or bucket is None:
        objects, bucket = _default_objects()
    mb = musicbrainz or MusicBrainz()
    try:
        _, art, states = _fetch_cover(engine, mb, objects, bucket, [{"id": release_id}])
    finally:
        if musicbrainz is None:
            mb.close()
    _save_cover_only(engine, art, states)
    return bool(art)


def _save_cover_only(engine: Engine, art: dict, states: dict) -> None:
    with transaction(engine) as conn:
        now = db_now(conn)
        for release_id, state in states.items():
            conn.execute(catalog_releases.update().where(catalog_releases.c.id == release_id)
                         .values(cover=state, cover_checked_at=now))
        if art:
            insert_ignore(conn, catalog_art, {**art, "fetched_at": now, "hidden": False},
                          ("release_id",))


def read_art(conn: Connection, art_id: str, size: str) -> tuple[str, str] | None:
    """The object key and content type of a visible image, or None (missing or hidden)."""
    row = conn.execute(sa.select(catalog_art).where(catalog_art.c.id == art_id)).first()
    if row is None or row.hidden:
        return None
    key = (row.sizes or {}).get(size)
    return (key, row.content_type) if key and key.startswith(ART_PREFIX) else None


def art_bytes(objects, bucket: str, key: str) -> bytes:
    with tempfile.TemporaryDirectory(prefix="selecta-art-") as folder:
        target = Path(folder) / "art"
        objects.get_object(bucket, key, target)
        return target.read_bytes()


__all__ = [
    "FLAG",
    "JOB_TYPE",
    "allowed",
    "art_bytes",
    "art_for_songs",
    "candidates_for_song",
    "enqueue_for_song",
    "enqueue_for_songs",
    "fetch_release_cover",
    "handle_job",
    "handlers",
    "palette_hue",
    "read_art",
    "run_lookup",
    "set_allowed",
    "set_choice",
]
