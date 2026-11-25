"""The song read side: what the planner and renderer know about a song, through an `EngineStore`.

`load_song` gives the same `SongInfo` the library's own read always has (`analysis.song`), and
`load_features` the same arrays, for one workspace on either database:

- On a Desktop library (`store.library`), a song is a `songs` row with its device path, and its
  lyrics are the `lyrics` table.
- In Cloud, a song is the catalogue's `local_songs` row, keyed by (workspace, content hash), with
  lyrics in `local_song_lyrics`. It has no path: the audio stays on the member's device, so a
  Cloud `SongInfo.path` is empty and audio is reached by other means.
- Both read `analysis` and `song_overrides`, and every query names the workspace.

The arrays are the features artifact, reached through the `ArtifactStore` port by a key built
from the song's content hash and the analysis version that made them (`features_key`). A Desktop
song analysed before the hash existed still has only `features/{song_id}.npz`, which a caller
passes as `legacy` and which is read when the artifact isn't there. It is never deleted.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import sqlalchemy as sa

from selecta.analysis.pipeline import read_features
from selecta.analysis.song import SONG_ARRAYS, SongInfo, build_song
from selecta.engine_store import EngineStore
from selecta.engine_store.schema import analysis, lyrics, song_overrides, songs
from selecta.local_media.lyrics_schema import local_song_lyrics
from selecta.local_media.schema import local_songs
from selecta.storage.artifacts import ArtifactMissing, ArtifactStore
from selecta.storage.keys import derived_key, input_hash

FEATURES_KIND = "features"
# Features are replaced whole, by the same bytes and version, so one slot per key is enough.
FEATURES_ATTEMPT = "current"
FEATURES_NAME = "features.npz"


def features_key(workspace_id: str, content_hash: str, version: int) -> str:
    """Where a song's arrays live: the same file bytes and analysis version, the same key, within
    one workspace (keys are never shared across workspaces)."""
    inputs = {"content_sha256": content_hash.lower(), "analysis_version": int(version)}
    digest = input_hash(workspace_id, FEATURES_KIND, inputs)
    return derived_key(workspace_id, FEATURES_KIND, digest, FEATURES_ATTEMPT, FEATURES_NAME)


def audio_features_key(workspace_id: str, audio_id: str, version: int) -> str:
    """Where a song with an audio id keeps its arrays (`library.audio_identity`): the same audio
    and analysis version, the same key, so a tag edit that changes the file's hash still finds
    them. Read first; `features_key` and the old file stay as fallbacks and are never deleted."""
    inputs = {"audio_id": audio_id, "analysis_version": int(version)}
    digest = input_hash(workspace_id, FEATURES_KIND, inputs)
    return derived_key(workspace_id, FEATURES_KIND, digest, FEATURES_ATTEMPT, FEATURES_NAME)


def _audio_ids_on() -> bool:
    from selecta import flags

    return flags.on("library.audio_identity")


@dataclass(frozen=True)
class _Songs:
    """Where a workspace's songs and lyrics are, and what each identity column is called."""

    table: sa.Table
    id: Any
    content_hash: Any
    audio_id: Any
    artist: Any
    title: Any
    genre: Any
    duration: Any
    path: Any
    live: Any
    lyrics: sa.Table


_LIBRARY = _Songs(
    table=songs,
    id=songs.c.id,
    content_hash=songs.c.content_hash,
    audio_id=songs.c.audio_id,
    artist=songs.c.artist,
    title=songs.c.title,
    genre=songs.c.genre,
    duration=songs.c.duration,
    path=songs.c.path,
    live=sa.true(),
    lyrics=lyrics,
)

_CATALOGUE = _Songs(
    table=local_songs,
    id=local_songs.c.id,
    content_hash=local_songs.c.content_sha256,
    audio_id=local_songs.c.audio_id,
    artist=local_songs.c.artist,
    title=local_songs.c.title,
    # the catalogue keeps no genre, and no path: nothing about the device leaves it
    genre=sa.null(),
    duration=local_songs.c.duration_s,
    path=sa.literal(""),
    live=local_songs.c.deleted_at.is_(None),
    lyrics=local_song_lyrics,
)


def _songs(store: EngineStore) -> _Songs:
    return _LIBRARY if store.library else _CATALOGUE


def _audio_column(where: _Songs) -> Any:
    # with the flag off the column is never read, so a store behaves exactly as before it
    return where.audio_id if _audio_ids_on() else sa.null()


def _facts(store: EngineStore, connection: sa.Connection, song_id: int):
    where = _songs(store)
    joined = where.table.join(
        analysis,
        sa.and_(
            analysis.c.song_id == where.id,
            analysis.c.workspace_id == where.table.c.workspace_id,
        ),
    )
    return (
        connection.execute(
            sa.select(
                where.id.label("id"),
                where.path.label("path"),
                where.artist.label("artist"),
                where.title.label("title"),
                where.genre.label("genre"),
                where.duration.label("duration"),
                where.content_hash.label("content_hash"),
                _audio_column(where).label("audio_id"),
                analysis.c.version,
                analysis.c.bpm,
                analysis.c.constant_tempo,
                analysis.c.grid_confidence,
                analysis.c.beats_per_bar,
                analysis.c.camelot,
                analysis.c.key_confidence,
                analysis.c.lufs,
                analysis.c.peak_db,
                analysis.c.energy,
                analysis.c.sections,
            )
            .select_from(joined)
            .where(store.mine(where.table), where.id == song_id, where.live)
        )
        .mappings()
        .first()
    )


def _lyric(store: EngineStore, connection: sa.Connection, song_id: int):
    table = _songs(store).lyrics
    return (
        connection.execute(
            sa.select(table.c.status, table.c.synced).where(
                store.mine(table), table.c.song_id == song_id
            )
        )
        .mappings()
        .first()
    )


def _correction(store: EngineStore, connection: sa.Connection, song_id: int):
    return (
        connection.execute(
            sa.select(song_overrides.c.bpm, song_overrides.c.camelot).where(
                store.mine(song_overrides), song_overrides.c.song_id == song_id
            )
        )
        .mappings()
        .first()
    )


def _newer(old: Path, stored: Path) -> bool:
    """Whether the old features file was written after the stored copy."""
    try:
        return old.stat().st_mtime > Path(stored).stat().st_mtime
    except OSError:
        return False


def _arrays(
    store: EngineStore,
    artifacts: ArtifactStore,
    song_id: int,
    content_hash: str | None,
    version: int | None,
    names: tuple[str, ...] | None,
    legacy: Path | None,
    audio_id: str | None = None,
) -> dict[str, np.ndarray]:
    old = None if legacy is None else Path(legacy) / f"{song_id}.npz"
    keys: list[str] = []
    if version is not None:
        # by audio first (library.audio_identity), then by the file's bytes, then the old file
        if audio_id:
            keys.append(audio_features_key(store.workspace_id, audio_id, version))
        if content_hash:
            keys.append(features_key(store.workspace_id, content_hash, version))
    for key in keys:
        try:
            with artifacts.open_input(key) as path:
                # A song analysed again while core.engine_store was off rewrote only the old
                # file, under the same hash and version. The newer file is the one the analysis
                # row describes, so it wins.
                if old is None or not _newer(old, path):
                    return read_features(path, names)
        except ArtifactMissing:
            pass
    if old is not None:
        return read_features(old, names)
    raise ArtifactMissing(f"song {song_id} has no stored features")


def load_song(
    store: EngineStore, artifacts: ArtifactStore, song_id: int, *, legacy: Path | None = None
) -> SongInfo:
    """Everything known about one analysed song in this workspace. `KeyError` when it has no
    analysis (or, in Cloud, isn't in the catalogue or has no known duration yet)."""
    with store.read() as connection:
        row = _facts(store, connection, song_id)
        if row is None:
            raise KeyError(f"song {song_id} hasn't been analysed")
        lyric = _lyric(store, connection, song_id)
        corrected = _correction(store, connection, song_id)
    if row["duration"] is None:
        raise KeyError(f"song {song_id} has no known duration yet")
    features = _arrays(
        store,
        artifacts,
        song_id,
        row["content_hash"],
        row["version"],
        SONG_ARRAYS,
        legacy,
        row["audio_id"],
    )
    return build_song(row, features, lyric, corrected)


def load_features(
    store: EngineStore,
    artifacts: ArtifactStore,
    song_id: int,
    names: tuple[str, ...] | None = None,
    *,
    legacy: Path | None = None,
) -> dict[str, np.ndarray]:
    """One song's arrays, or only `names` of them, from its features artifact, else `legacy`."""
    where = _songs(store)
    with store.read() as connection:
        found = connection.execute(
            sa.select(where.content_hash, analysis.c.version, _audio_column(where))
            .select_from(
                where.table.outerjoin(
                    analysis,
                    sa.and_(
                        analysis.c.song_id == where.id,
                        analysis.c.workspace_id == where.table.c.workspace_id,
                    ),
                )
            )
            .where(store.mine(where.table), where.id == song_id, where.live)
        ).first()
    content_hash, version, audio_id = found if found is not None else (None, None, None)
    return _arrays(store, artifacts, song_id, content_hash, version, names, legacy, audio_id)


__all__ = ["FEATURES_KIND", "audio_features_key", "features_key", "load_features", "load_song"]
