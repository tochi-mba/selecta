"""Song facts written in Cloud: a catalogue song's measurements and its corrections, by workspace.

Every read and write goes through an `EngineStore` for the caller's workspace, and every query
names it (`store.mine`). A song is the catalogue's `local_songs` row; facts are attached only
after the file hash or audio id the caller names matches the one the catalogue holds for that
song, so facts can't land on another song by mistake. The arrays go to the song's features
artifact under the key `engine_store.songs` reads (`features_key` of the row's own hash), so
`songs.load_song` reads exactly what was saved.

A device's facts are that member's own claim. They are written here, in the account's own
workspace, and never to the cross-account `shared_derivations` store.
"""

from __future__ import annotations

import json
import math
import tempfile
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import sqlalchemy as sa

from selecta.engine_store import EngineStore, upsert
from selecta.engine_store.facts import (
    CAMELOT,
    WORKER,
    FactsRefused,
    Provenance,
    SongFacts,
    analysis_row,
    check,
    features_bytes,
    implementation_of,
    python_implementation,
    version_of,
    wins,
)
from selecta.engine_store.schema import analysis, song_overrides
from selecta.engine_store.songs import features_key
from selecta.local_media.hashes_schema import local_song_hashes
from selecta.local_media.schema import local_songs
from selecta.persistence import db_now
from selecta.storage.artifacts import ArtifactStore

MAX_FACTS_PER_WORKSPACE = 20_000
"""One facts row per catalogue song, and a device reports at most this many songs at once
(`local_media.api._MAX_AVAILABILITY_SNAPSHOT_IDS`)."""

MAX_PAGE = 1000
LOWEST_TEMPO, HIGHEST_TEMPO = 40.0, 240.0  # the Desktop correction route's range (api_common)


def _stamp(epoch: float) -> str:
    # sorts with the `YYYY-MM-DD HH:MM:SS` text older rows have
    return datetime.fromtimestamp(epoch, UTC).strftime("%Y-%m-%d %H:%M:%S.%f")


def _song(store: EngineStore, connection: sa.Connection, song_id: int):
    return (
        connection.execute(
            sa.select(
                local_songs.c.id,
                local_songs.c.content_sha256,
                local_songs.c.audio_id,
                local_songs.c.duration_s,
            ).where(
                store.mine(local_songs),
                local_songs.c.id == song_id,
                local_songs.c.deleted_at.is_(None),
            )
        )
        .mappings()
        .first()
    )


def _same_song(
    store: EngineStore,
    connection: sa.Connection,
    song: Any,
    content_sha256: str | None,
    audio_id: str | None,
) -> bool:
    """Whether the file hash or audio id the caller names is this song's."""
    if audio_id and song["audio_id"] and audio_id == song["audio_id"]:
        return True
    if not content_sha256:
        return False
    sha = content_sha256.lower()
    if sha == song["content_sha256"]:
        return True
    known = connection.execute(
        sa.select(local_song_hashes.c.song_id).where(
            store.mine(local_song_hashes),
            local_song_hashes.c.content_sha256 == sha,
            local_song_hashes.c.song_id == song["id"],
        )
    ).first()
    return known is not None


def _current(store: EngineStore, connection: sa.Connection, song_id: int):
    return (
        connection.execute(
            sa.select(
                analysis.c.version,
                analysis.c.implementation,
                analysis.c.source,
                analysis.c.analysed_at,
            ).where(store.mine(analysis), analysis.c.song_id == song_id)
        )
        .mappings()
        .first()
    )


def _count(store: EngineStore, connection: sa.Connection) -> int:
    return int(
        connection.execute(
            sa.select(sa.func.count()).select_from(analysis).where(store.mine(analysis))
        ).scalar_one()
    )


def _admit(
    store: EngineStore, connection: sa.Connection, song_id: int, facts: SongFacts, now: str
):
    """The stored row these facts would replace (None for a first measurement), or
    `FactsRefused` when it wins over them or the workspace is full."""
    old = _current(store, connection, song_id)
    if old is not None:
        before = implementation_of(old)
        if not wins(Provenance(facts.implementation, facts.source, now), before):
            raise FactsRefused(
                "outranked",
                "implementation",
                f"This song keeps its {before.source} measurement by {before.implementation}.",
            )
    elif _count(store, connection) >= MAX_FACTS_PER_WORKSPACE:
        raise FactsRefused(
            "too_many", "song_id", "This library already has facts for as many songs as it can."
        )
    return old


def _publish(artifacts: ArtifactStore, key: str, facts: SongFacts) -> None:
    with tempfile.TemporaryDirectory(prefix="selecta-facts-") as folder:
        path = Path(folder) / "features.npz"
        path.write_bytes(features_bytes(facts.arrays))
        artifacts.publish(key, path)


def save(
    store: EngineStore,
    artifacts: ArtifactStore,
    song_id: int,
    facts: SongFacts,
    *,
    content_sha256: str | None = None,
    audio_id: str | None = None,
    duration: float | None = None,
) -> dict[str, Any]:
    """Store one catalogue song's facts. `LookupError` when the song isn't this workspace's;
    `FactsRefused` when the hash doesn't name it, the facts don't pass `facts.check`, a
    measurement that `wins` over these is already stored, or the workspace is full. `duration`
    is the decoded length a worker measured, used only when the catalogue has none."""
    with store.read() as connection:
        song = _song(store, connection, song_id)
        if song is None:
            raise LookupError(f"song {song_id} isn't in this library")
        if not _same_song(store, connection, song, content_sha256, audio_id):
            raise FactsRefused(
                "song_mismatch", "content_sha256", "That file isn't this song in your library."
            )
        check(facts, song["duration_s"] if song["duration_s"] is not None else duration)
        version = version_of(facts.implementation, facts.source)
        key = features_key(store.workspace_id, song["content_sha256"], version)
        # refused before anything is uploaded, and again below in case another write came first
        _admit(store, connection, song_id, facts, _stamp(db_now(connection)))
    _publish(artifacts, key, facts)
    with store.write() as connection:
        measured_at = _stamp(db_now(connection))
        old = _admit(store, connection, song_id, facts, measured_at)
        upsert(
            connection,
            analysis,
            {
                "song_id": song_id,
                "workspace_id": store.workspace_id,
                **analysis_row(facts, version, measured_at),
            },
            keys=["song_id"],
        )
    replaced = old is not None
    if replaced and old["version"] is not None and int(old["version"]) != version:
        # the older measurement's arrays sit under another key; nothing reads them any more
        stale = features_key(store.workspace_id, song["content_sha256"], int(old["version"]))
        try:
            artifacts.delete(stale)
        except Exception:  # noqa: BLE001  (account deletion removes the whole prefix anyway)
            pass
    return {
        "song_id": song_id,
        "implementation": facts.implementation,
        "source": facts.source,
        "measured_at": measured_at,
        "replaced": replaced,
    }


def measured(store: EngineStore, after: int = 0, limit: int = 500) -> dict[str, Any]:
    """Which of this workspace's songs have facts, by song id, a page at a time."""
    limit = max(1, min(int(limit), MAX_PAGE))
    with store.read() as connection:
        rows = (
            connection.execute(
                sa.select(
                    analysis.c.song_id,
                    analysis.c.version,
                    analysis.c.implementation,
                    analysis.c.source,
                    analysis.c.analysed_at,
                )
                .where(store.mine(analysis), analysis.c.song_id > after)
                .order_by(analysis.c.song_id)
                .limit(limit + 1)
            )
            .mappings()
            .all()
        )
    page = rows[:limit]
    answer: dict[str, Any] = {
        "songs": [
            {
                "song_id": int(row["song_id"]),
                "implementation": implementation_of(row).implementation,
                "source": implementation_of(row).source,
                "measured_at": row["analysed_at"],
            }
            for row in page
        ]
    }
    if len(rows) > limit:
        answer["next"] = int(page[-1]["song_id"])
    return answer


def set_correction(
    store: EngineStore, song_id: int, bpm: float | None, camelot: str | None
) -> dict[str, Any]:
    """The member's tempo and key for a song, which win over what was measured. Both None
    clears it. `LookupError` when the song isn't this workspace's; `FactsRefused` outside the
    Desktop correction route's ranges."""
    if bpm is not None and (not math.isfinite(bpm) or not LOWEST_TEMPO <= bpm <= HIGHEST_TEMPO):
        raise FactsRefused("out_of_range", "bpm", "Tempo has to be between 40 and 240.")
    if camelot is not None and not CAMELOT.fullmatch(camelot):
        raise FactsRefused("bad_key", "camelot", "Key has to be like 8A or 11B.")
    with store.write() as connection:
        if _song(store, connection, song_id) is None:
            raise LookupError(f"song {song_id} isn't in this library")
        if bpm is None and camelot is None:
            connection.execute(
                sa.delete(song_overrides).where(
                    store.mine(song_overrides), song_overrides.c.song_id == song_id
                )
            )
        else:
            upsert(
                connection,
                song_overrides,
                {
                    "song_id": song_id,
                    "workspace_id": store.workspace_id,
                    "bpm": bpm,
                    "camelot": camelot,
                    "updated_at": _stamp(db_now(connection)),
                },
                keys=["song_id"],
            )
    return {"song_id": song_id, "bpm": bpm, "camelot": camelot}


# --- a SelectaDJ worker's analysis --------------------------------------------------------------


def facts_from_hosted_analysis(path: Path) -> tuple[SongFacts, float]:
    """The facts in a hosted analysis file (`workers.engine_handlers.analyse`: the planner's
    arrays and a JSON summary), and the decoded duration. The peaks and raw beats it also holds
    are left unread. `FactsRefused` when the file can't be read as one."""
    try:
        return _hosted(path)
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise FactsRefused("unreadable", "analysis", "The analysis file is unreadable.") from error


def _hosted(path: Path) -> tuple[SongFacts, float]:
    with np.load(path) as data:
        summary = json.loads(str(data["summary"]))
        arrays = {
            "beats": data["beats"].astype(np.float64),
            "bar_starts": data["bar_starts"].astype(np.int32),
            **{
                name: data[name].astype(np.float32)
                for name in (
                    "energy_bars",
                    "low_share_bars",
                    "rms_db_bars",
                    "chroma_bars",
                    "mfcc_bars",
                )
            },
        }
    facts = SongFacts(
        bpm=summary["bpm"],
        constant_tempo=bool(summary["constant_tempo"]),
        grid_confidence=summary["grid_confidence"],
        beats_per_bar=summary["beats_per_bar"],
        key=summary["key"],
        camelot=summary["camelot"],
        key_confidence=summary["key_confidence"],
        lufs=summary["lufs"],
        peak_db=summary["peak_db"],
        energy=summary["energy"],
        sections=summary["sections"],
        arrays=arrays,
        implementation=python_implementation(),
        source=WORKER,
    )
    return facts, float(summary["duration"])


def song_with_hash(store: EngineStore, content_sha256: str) -> int | None:
    """The live catalogue song this file is, by its own hash or one it is also known by."""
    sha = content_sha256.lower()
    with store.read() as connection:
        found = connection.execute(
            sa.select(local_songs.c.id).where(
                store.mine(local_songs),
                local_songs.c.content_sha256 == sha,
                local_songs.c.deleted_at.is_(None),
            )
        ).scalar()
        if found is None:
            found = connection.execute(
                sa.select(local_song_hashes.c.song_id)
                .join(
                    local_songs,
                    sa.and_(
                        local_songs.c.id == local_song_hashes.c.song_id,
                        local_songs.c.workspace_id == local_song_hashes.c.workspace_id,
                    ),
                )
                .where(
                    store.mine(local_song_hashes),
                    local_song_hashes.c.content_sha256 == sha,
                    local_songs.c.deleted_at.is_(None),
                )
            ).scalar()
    return None if found is None else int(found)


def record_worker_analysis(
    store: EngineStore,
    artifacts: ArtifactStore,
    content_sha256: str,
    path: Path,
    implementation: str | None = None,
) -> int | None:
    """Also keep a worker's finished analysis of an uploaded file as the facts of the catalogue
    song with the same bytes, if this workspace has one; returns its id, else None. A device
    measurement of that song gives way to it (`facts.wins`); a refusal is the same as None."""
    song_id = song_with_hash(store, content_sha256)
    if song_id is None:
        return None
    facts, duration = facts_from_hosted_analysis(path)
    if implementation is not None:
        facts = replace(facts, implementation=implementation)
    try:
        save(store, artifacts, song_id, facts, content_sha256=content_sha256, duration=duration)
    except FactsRefused:
        return None
    return song_id


__all__ = [
    "HIGHEST_TEMPO",
    "LOWEST_TEMPO",
    "MAX_FACTS_PER_WORKSPACE",
    "facts_from_hosted_analysis",
    "measured",
    "record_worker_analysis",
    "save",
    "set_correction",
    "song_with_hash",
]
