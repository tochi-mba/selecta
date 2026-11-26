"""The seams slice: each rendered transition's record, who rendered it, its history and verdicts,
read and written only through an `EngineStore` (docs/engineering/engine-store-seams.md).

A seam's record is the JSON `seam.json` and `seam-history/{key}.json` hold on Desktop. `keep`
stores one exactly as it is (`seams.record`) with copies of its fields in named columns, adds it
to `seam_history` when this version isn't there yet, and adds its verdict to `seam_verdicts` when
that click isn't there yet. Writing the same record twice changes nothing, which is what makes
the file import (`engine_store.seam_import`) safe to run again.

A clip is never stored here. `attest` says a studio made one: which studio (`desktop`, a worker,
a member's device), its implementation, the clip's length and hash. A reader may play a seam only
from a studio it can reach: the Desktop from its own folder, a device only its own clips.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from collections.abc import Collection, Iterable, Mapping
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.engine_store import EngineStore, insert_returning_id, upsert
from selecta.engine_store.schema import (
    SEAM_KEY,
    seam_attestations,
    seam_history,
    seam_verdicts,
    seams,
)

DESKTOP, DEVICE, WORKER = "desktop", "device", "worker"
SOURCES = (DESKTOP, DEVICE, WORKER)
LOCAL_RATER = "local"
VERDICTS = ("good", "bad", "none")
KEPT = ("ready", "failed")
"""A record that is finished. A seam queued or rendering is in flight, owned by the worker (or the
durable job store), and never kept here."""


class SeamRefused(ValueError):
    """A record that can't be kept: no key, or not a JSON object."""


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")


def record_hash(state: Mapping[str, Any]) -> str:
    """One record's fingerprint: the same JSON gives the same hash, whatever its key order."""
    text = json.dumps(state, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value) if math.isfinite(value) else None


def _float(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def _bool(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _json(value: Any) -> str | None:
    return None if value is None else json.dumps(value, ensure_ascii=False)


def songs_of(state: Mapping[str, Any]) -> tuple[int, int]:
    """Song A and song B of a record. An older record with no request keeps 0 for an unknown
    song, so it is still kept (and still counted where a file reader counted it)."""
    request = state.get("request")
    request = request if isinstance(request, dict) else {}
    return _int(request.get("a")) or 0, _int(request.get("b")) or 0


def row_of(
    workspace_id: str,
    state: Mapping[str, Any],
    *,
    key: str | None = None,
    source: str = DESKTOP,
    fingerprint: str | None = None,
) -> dict[str, Any]:
    """The `seams` row for one record. `key` names it when the record itself doesn't."""
    if not isinstance(state, Mapping):
        raise SeamRefused("A seam record is a JSON object.")
    named = _text(state.get("key")) or key
    if not named or len(named) > SEAM_KEY:
        raise SeamRefused("A seam record needs its key.")
    if source not in SOURCES:
        raise SeamRefused(f"Unknown seam source {source!r}.")
    request = state.get("request")
    request = request if isinstance(request, dict) else {}
    a, b = songs_of(state)
    return {
        "workspace_id": workspace_id,
        "key": named,
        "song_a": a,
        "song_b": b,
        "asked": _text(request.get("move")),
        "status": _text(state.get("status")) or "unknown",
        "style": _text(state.get("style")),
        "bars": _int(state.get("bars")),
        "exit_bar": _int(state.get("exit_bar")),
        "entry_bar": _int(state.get("entry_bar")),
        "a_source_start": _float(state.get("a_source_start")),
        "b_source_end": _float(state.get("b_source_end")),
        "duration": _float(state.get("duration")),
        "rules": _int(state.get("rules")),
        "fingerprint": fingerprint or _text(state.get("fingerprint")),
        "passed": _bool(state.get("passed")),
        "near_miss": _bool(state.get("near_miss")),
        "fell_back": _bool(state.get("fell_back")),
        "pair": _json(state.get("pair")),
        "checks": _json(state.get("checks")),
        "error": _text(state.get("error")),
        "rating": _text(state.get("rating")),
        "rated_at": _float(state.get("rated_at")),
        "note": _text(state.get("note")),
        "source": source,
        "record": json.dumps(dict(state), ensure_ascii=False),
        "record_hash": record_hash(state),
        "updated_at": _now(),
    }


def keep_in(
    connection: Connection,
    store: EngineStore,
    state: Mapping[str, Any],
    *,
    key: str | None = None,
    source: str = DESKTOP,
    fingerprint: str | None = None,
    rated_by: str = LOCAL_RATER,
    as_current: bool = True,
) -> bool:
    """`keep` inside a caller's write. Returns True when anything changed."""
    row = row_of(store.workspace_id, state, key=key, source=source, fingerprint=fingerprint)
    named, changed = row["key"], False
    if as_current:
        held = connection.execute(
            sa.select(seams.c.record_hash).where(store.mine(seams), seams.c.key == named)
        ).scalar()
        if held != row["record_hash"]:
            upsert(connection, seams, row, ("workspace_id", "key"))
            changed = True
    seen = connection.execute(
        sa.select(seam_history.c.id).where(
            store.mine(seam_history),
            seam_history.c.key == named,
            seam_history.c.record_hash == row["record_hash"],
        )
    ).first()
    if seen is None:
        insert_returning_id(
            connection,
            seam_history,
            {
                "workspace_id": store.workspace_id,
                "key": named,
                "song_a": row["song_a"],
                "song_b": row["song_b"],
                "status": row["status"],
                "rating": row["rating"],
                "record": row["record"],
                "record_hash": row["record_hash"],
                "recorded_at": row["updated_at"],
            },
        )
        changed = True
    verdict, rated_at = row["rating"], row["rated_at"]
    if verdict in VERDICTS and rated_at is not None:
        clicked = connection.execute(
            sa.select(seam_verdicts.c.id).where(
                store.mine(seam_verdicts),
                seam_verdicts.c.key == named,
                seam_verdicts.c.verdict == verdict,
                seam_verdicts.c.rated_at == rated_at,
            )
        ).first()
        if clicked is None:
            insert_returning_id(
                connection,
                seam_verdicts,
                {
                    "workspace_id": store.workspace_id,
                    "key": named,
                    "song_a": row["song_a"],
                    "song_b": row["song_b"],
                    "verdict": verdict,
                    "note": row["note"] or "",
                    "rated_at": rated_at,
                    "rated_by": rated_by,
                },
            )
            changed = True
    return changed


def keep(store: EngineStore, state: Mapping[str, Any], **options: Any) -> bool:
    """Keep one finished record: the seam's current row, its history and its verdict. Writing
    the same record again changes nothing. Returns True when anything changed."""
    with store.write() as connection:
        return keep_in(connection, store, state, **options)


def attest(
    store: EngineStore,
    key: str,
    *,
    studio: str,
    studio_id: str,
    implementation: str,
    clip_sha256: str,
    clip_seconds: float,
    connection: Connection | None = None,
) -> None:
    """Say `studio_id` rendered this seam's clip; one per studio and seam, the latest kept."""
    if studio not in SOURCES:
        raise SeamRefused(f"Unknown studio {studio!r}.")
    values = {
        "workspace_id": store.workspace_id,
        "key": key,
        "studio": studio,
        "studio_id": studio_id,
        "implementation": implementation,
        "clip_sha256": clip_sha256,
        "clip_seconds": float(clip_seconds),
        "attested_at": _now(),
    }
    keys = ("workspace_id", "key", "studio_id")
    if connection is not None:
        upsert(connection, seam_attestations, values, keys)
        return
    with store.write() as writing:
        upsert(writing, seam_attestations, values, keys)


def attested(store: EngineStore, key: str, studio_id: str) -> dict | None:
    with store.read() as connection:
        row = (
            connection.execute(
                sa.select(seam_attestations).where(
                    store.mine(seam_attestations),
                    seam_attestations.c.key == key,
                    seam_attestations.c.studio_id == studio_id,
                )
            )
            .mappings()
            .first()
        )
        return None if row is None else dict(row)


def unattest(store: EngineStore, key: str, studio_id: str) -> None:
    with store.write() as connection:
        connection.execute(
            sa.delete(seam_attestations).where(
                store.mine(seam_attestations),
                seam_attestations.c.key == key,
                seam_attestations.c.studio_id == studio_id,
            )
        )


def record_of_in(connection: Connection, store: EngineStore, key: str) -> dict | None:
    """`record_of` inside a caller's transaction."""
    text = connection.execute(
        sa.select(seams.c.record).where(store.mine(seams), seams.c.key == key)
    ).scalar()
    return None if text is None else json.loads(text)


def record_of(store: EngineStore, key: str) -> dict | None:
    """A seam's current record, exactly as its file held it, or None."""
    with store.read() as connection:
        text = connection.execute(
            sa.select(seams.c.record).where(store.mine(seams), seams.c.key == key)
        ).scalar()
    return None if text is None else json.loads(text)


def records(store: EngineStore) -> list[dict]:
    """Every seam's current record, in key order: what the memory and calibration read."""
    with store.read() as connection:
        rows = connection.execute(
            sa.select(seams.c.record).where(store.mine(seams)).order_by(seams.c.key)
        ).scalars()
        return [json.loads(text) for text in rows]


def current(store: EngineStore) -> list[tuple[str, dict, str]]:
    """Every seam's current record as (key, record, when its row last changed), in key order."""
    with store.read() as connection:
        rows = connection.execute(
            sa.select(seams.c.key, seams.c.record, seams.c.updated_at)
            .where(store.mine(seams))
            .order_by(seams.c.key)
        )
        return [(row.key, json.loads(row.record), row.updated_at) for row in rows]


def keys(store: EngineStore) -> dict[str, tuple[str, str]]:
    """Every key with its record hash and source, for the import's comparison."""
    with store.read() as connection:
        return {
            row.key: (row.record_hash, row.source)
            for row in connection.execute(
                sa.select(seams.c.key, seams.c.record_hash, seams.c.source).where(store.mine(seams))
            )
        }


def ready_records(store: EngineStore, studio_ids: Collection[str]) -> list[tuple[dict, dict]]:
    """Each ready seam with an attestation from one of these studios: (record, attestation)."""
    return [(record, attestation) for record, attestation, _ in ready_rows(store, studio_ids)]


def ready_rows(store: EngineStore, studio_ids: Collection[str]) -> list[tuple[dict, dict, str]]:
    """`ready_records`, each with when its seam row last changed."""
    if not studio_ids:
        return []
    query = (
        sa.select(seams.c.record, seams.c.updated_at.label("row_updated_at"), seam_attestations)
        .select_from(
            seams.join(
                seam_attestations,
                sa.and_(
                    seam_attestations.c.workspace_id == seams.c.workspace_id,
                    seam_attestations.c.key == seams.c.key,
                ),
            )
        )
        .where(
            store.mine(seams),
            seams.c.status == "ready",
            seam_attestations.c.studio_id.in_(sorted(studio_ids)),
        )
        .order_by(seams.c.key, seam_attestations.c.studio_id)
    )
    with store.read() as connection:
        found = []
        for row in connection.execute(query).mappings():
            attestation = {name: row[name] for name in seam_attestations.c.keys()}
            found.append((json.loads(row["record"]), attestation, row["row_updated_at"]))
        return found


def known(
    store: EngineStore, *, pair: tuple[int, int] | None = None, wanted: Iterable[str] = ()
) -> list[dict]:
    """The seams known for one pair, or for these keys, each with who rendered it."""
    wanted = sorted(set(wanted))
    if pair is None and not wanted:
        return []
    where = [store.mine(seams)]
    if pair is not None:
        where += [seams.c.song_a == pair[0], seams.c.song_b == pair[1]]
    if wanted:
        where.append(seams.c.key.in_(wanted))
    with store.read() as connection:
        rows = [
            dict(row)
            for row in connection.execute(
                sa.select(seams).where(*where).order_by(seams.c.key).limit(200)
            ).mappings()
        ]
        names = [row["key"] for row in rows]
        by_key: dict[str, list[dict]] = {}
        if names:
            for row in connection.execute(
                sa.select(seam_attestations)
                .where(store.mine(seam_attestations), seam_attestations.c.key.in_(names))
                .order_by(seam_attestations.c.id)
            ).mappings():
                by_key.setdefault(row["key"], []).append(dict(row))
    for row in rows:
        row["attestations"] = by_key.get(row["key"], [])
    return rows


def rate(
    store: EngineStore,
    key: str,
    verdict: str,
    note: str = "",
    *,
    rated_by: str,
    now: float | None = None,
) -> dict:
    """A listener's Good, Bad or cleared verdict on a ready seam, as Desktop's `SeamStore.rate`
    writes it into the record: `rating`, `rated_at`, `note`. Raises LookupError for no seam and
    SeamRefused for one that isn't ready."""
    if verdict not in VERDICTS:
        raise SeamRefused("A verdict is good, bad or none.")
    with store.write() as connection:
        row = connection.execute(
            sa.select(seams.c.record, seams.c.source).where(store.mine(seams), seams.c.key == key)
        ).first()
        if row is None:
            raise LookupError(key)
        state = json.loads(row.record)
        if state.get("status") != "ready":
            raise SeamRefused("That seam hasn't finished rendering.")
        state.update(rating=verdict, rated_at=time.time() if now is None else now, note=note)
        keep_in(connection, store, state, source=row.source, rated_by=rated_by)
        return state


def verdicts(store: EngineStore, limit: int = 5000) -> list[dict]:
    """Every verdict given in this workspace, oldest first."""
    with store.read() as connection:
        return [
            dict(row)
            for row in connection.execute(
                sa.select(seam_verdicts)
                .where(store.mine(seam_verdicts))
                .order_by(seam_verdicts.c.id)
                .limit(limit)
            ).mappings()
        ]


def forget_song(store: EngineStore, song_id: int) -> int:
    """A song's analysis was corrected: its seams and their history go, as their files do on
    Desktop. The verdict log is kept: a listener's opinion is never thrown away here."""
    touching = sa.or_(seams.c.song_a == song_id, seams.c.song_b == song_id)
    with store.write() as connection:
        names = list(
            connection.execute(sa.select(seams.c.key).where(store.mine(seams), touching)).scalars()
        )
        if names:
            connection.execute(
                sa.delete(seam_attestations).where(
                    store.mine(seam_attestations), seam_attestations.c.key.in_(names)
                )
            )
        connection.execute(sa.delete(seams).where(store.mine(seams), touching))
        connection.execute(
            sa.delete(seam_history).where(
                store.mine(seam_history),
                sa.or_(seam_history.c.song_a == song_id, seam_history.c.song_b == song_id),
            )
        )
        return len(names)


def drop(store: EngineStore, names: Collection[str], *, older_than: str) -> int:
    """Remove these seams' current rows (and attestations) last written before `older_than`;
    their history and verdicts stay. The import uses it for records whose files are gone."""
    if not names:
        return 0
    chosen = sorted(names)
    with store.write() as connection:
        gone = list(
            connection.execute(
                sa.select(seams.c.key).where(
                    store.mine(seams), seams.c.key.in_(chosen), seams.c.updated_at < older_than
                )
            ).scalars()
        )
        if gone:
            connection.execute(
                sa.delete(seam_attestations).where(
                    store.mine(seam_attestations), seam_attestations.c.key.in_(gone)
                )
            )
            connection.execute(sa.delete(seams).where(store.mine(seams), seams.c.key.in_(gone)))
        return len(gone)


__all__ = [
    "DESKTOP",
    "DEVICE",
    "KEPT",
    "LOCAL_RATER",
    "SOURCES",
    "VERDICTS",
    "WORKER",
    "SeamRefused",
    "attest",
    "attested",
    "drop",
    "forget_song",
    "keep",
    "keep_in",
    "keys",
    "known",
    "rate",
    "ready_records",
    "record_hash",
    "record_of",
    "record_of_in",
    "records",
    "row_of",
    "songs_of",
    "unattest",
    "verdicts",
]
