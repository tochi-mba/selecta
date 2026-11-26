"""Which catalogue song an upload is for (`storage.upload_identity`).

A member uploads songs that are often already in their library, registered by a device. The
upload must land on that same `local_songs` row, so its measurements, corrections, seams, mixes,
drafts, requests and ratings stay with it. A song is known by its own file hash, the other file
hashes recorded for it (`local_song_hashes`) and its audio id (docs/engineering/audio-identity.md).

- **Named.** An upload may name its song (`upload_sessions.song_id`). The plan is refused
  (`song_mismatch`) unless the declared file hash is one of the song's hashes or the declared
  audio id is the song's; acceptance checks again with the hash the server computed and the
  audio id it read from the bytes. A file hash already known for a different song is never
  this one: a file hash names at most one song in a workspace.
- **Not named.** `store.register_songs(..., audio_ids=True)`: its own hash, another known hash,
  or an audio id exactly one live song has, is that song. Two or more songs with the audio id is
  unsure: the upload becomes a version of the first one's group (`duplicate_of`), never a song
  that looks separate.

A reused row keeps its own hash, title, artist and album. A new file hash is recorded against
it. Off, uploads find their song by the row's own hash only (`catalogue_link`), as before.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.local_media.hashes_schema import local_song_hashes
from selecta.local_media.schema import local_songs
from selecta.persistence import db_now
from selecta.storage.schema import assets

log = logging.getLogger(__name__)

FLAG = "storage.upload_identity"
AUDIO_FLAG = "library.audio_identity"
MISMATCH = "song_mismatch"
MISMATCH_WORDS = "This file isn't the song in your library it was meant for."

_ROW = (
    local_songs.c.id,
    local_songs.c.content_sha256,
    local_songs.c.audio_id,
    local_songs.c.duplicate_of,
    local_songs.c.title,
    local_songs.c.artist,
    local_songs.c.album,
    local_songs.c.duration_s,
    local_songs.c.codec,
    local_songs.c.sample_rate,
    local_songs.c.deleted_at,
)


def on() -> bool:
    from selecta import flags

    return flags.on(FLAG)


def _audio_on() -> bool:
    from selecta import flags

    return flags.on(AUDIO_FLAG)


def clean_audio_id(value: Any) -> str | None:
    """A declared audio id in its one accepted form, else None. Off with the audio flag."""
    from selecta.library.audio_identity import PATTERN

    if not isinstance(value, str) or not _audio_on() or not PATTERN.fullmatch(value):
        return None
    return value


def audio_id_of(path: Path) -> str | None:
    """The audio id of the staged file the server holds, or None (flags off, or no id)."""
    if not (on() and _audio_on()):
        return None
    from selecta.library.audio_identity import audio_id

    try:
        return audio_id(path)
    except Exception:  # noqa: BLE001 - an unreadable id only means the file hash decides
        log.warning("upload identity: the audio id could not be read")
        return None


def _song(conn: Connection, workspace_id: str, song_id: int) -> Any:
    return conn.execute(
        sa.select(*_ROW).where(local_songs.c.workspace_id == workspace_id,
                               local_songs.c.id == int(song_id))
    ).first()


def _owner(conn: Connection, workspace_id: str, sha: str) -> Any:
    """The song this file hash names in the workspace, as its own or another known hash (a
    deleted song included), or None."""
    own = conn.execute(
        sa.select(*_ROW).where(local_songs.c.workspace_id == workspace_id,
                               local_songs.c.content_sha256 == sha)
    ).first()
    if own is not None:
        return own
    return conn.execute(
        sa.select(*_ROW)
        .select_from(local_song_hashes.join(local_songs, sa.and_(
            local_songs.c.workspace_id == local_song_hashes.c.workspace_id,
            local_songs.c.id == local_song_hashes.c.song_id)))
        .where(local_song_hashes.c.workspace_id == workspace_id,
               local_song_hashes.c.content_sha256 == sha)
    ).first()


def _is(conn: Connection, workspace_id: str, song: Any, sha: str | None,
        audio_id: str | None) -> bool:
    if sha:
        owner = _owner(conn, workspace_id, sha.lower())
        if owner is not None:
            return int(owner.id) == int(song.id)
    return bool(audio_id and song.audio_id and audio_id == song.audio_id)


def plan_song(conn: Connection, workspace_id: str, song_id: Any, sha: str | None,
              audio_id: str | None) -> int | None:
    """The named song's id when this file is that live song of this workspace, else None."""
    if isinstance(song_id, bool) or not isinstance(song_id, int) or song_id < 1:
        return None
    song = _song(conn, workspace_id, song_id)
    if song is None or song.deleted_at is not None:
        return None
    return int(song.id) if _is(conn, workspace_id, song, sha, audio_id) else None


def accept_refusal(conn: Connection, workspace_id: str, song_id: int, sha: str,
                   audio_id: str | None) -> str | None:
    """`MISMATCH_WORDS` when the session names a live song and the received file isn't it. A
    song removed since the plan leaves a plain upload."""
    song = _song(conn, workspace_id, song_id)
    if song is None or song.deleted_at is not None:
        return None
    return None if _is(conn, workspace_id, song, sha, audio_id) else MISMATCH_WORDS


def song_hashes(conn: Connection, workspace_id: str, song_id: int) -> sa.Select:
    """Every file hash this song is known by: its own and the others recorded for it."""
    own = sa.select(local_songs.c.content_sha256.label("sha")).where(
        local_songs.c.workspace_id == workspace_id, local_songs.c.id == int(song_id))
    others = sa.select(local_song_hashes.c.content_sha256.label("sha")).where(
        local_song_hashes.c.workspace_id == workspace_id,
        local_song_hashes.c.song_id == int(song_id))
    return sa.union(own, others)


def cloud_copy(conn: Connection, workspace_id: str, song_id: int) -> str | None:
    """A live upload of this workspace whose file hash is one of the song's, or None. Venue
    uploads are a business's own and never count."""
    hashes = song_hashes(conn, workspace_id, song_id).subquery()
    return conn.execute(
        sa.select(assets.c.id)
        .where(assets.c.workspace_id == workspace_id,
               assets.c.deleted_at.is_(None),
               assets.c.venue_id.is_(None),
               assets.c.sha256.in_(sa.select(hashes.c.sha)))
        .order_by(assets.c.created_at, assets.c.id)
        .limit(1)
    ).scalar()


def song_of(conn: Connection, workspace_id: str, sha: str | None) -> int | None:
    """The live song this file hash names, or None."""
    if not sha:
        return None
    owner = _owner(conn, workspace_id, sha.lower())
    if owner is None or owner.deleted_at is not None:
        return None
    return int(owner.id)


def cloud_copy_of_hash(conn: Connection, workspace_id: str, sha: str) -> str | None:
    """A live upload of the song this file hash names, under any of its hashes, or None."""
    song_id = song_of(conn, workspace_id, sha)
    return None if song_id is None else cloud_copy(conn, workspace_id, song_id)


def _record_hash(conn: Connection, workspace_id: str, song_id: int, sha: str) -> None:
    try:
        with conn.begin_nested():
            conn.execute(local_song_hashes.insert().values(
                workspace_id=workspace_id, content_sha256=sha, song_id=int(song_id),
                created_at=db_now(conn)))
    except sa.exc.IntegrityError:
        pass  # another registration recorded it first


def _fill_audio(conn: Connection, workspace_id: str, song: Any, audio_id: str | None) -> None:
    """An older row learns its audio id from the bytes the server read; one it has stays."""
    if audio_id and song.audio_id is None:
        conn.execute(local_songs.update().where(
            local_songs.c.workspace_id == workspace_id, local_songs.c.id == song.id
        ).values(audio_id=audio_id))


def _same_audio(conn: Connection, workspace_id: str, audio_id: str | None) -> list[Any]:
    if not audio_id:
        return []
    return conn.execute(
        sa.select(*_ROW).where(local_songs.c.workspace_id == workspace_id,
                               local_songs.c.audio_id == audio_id)
        .order_by(local_songs.c.id)
    ).all()


def _kept(row: Any, sha: str, found: dict[str, Any]) -> dict[str, Any]:
    """A registration that leaves a reused row's own words as they are."""
    return {
        "content_sha256": sha, "title": row.title, "artist": row.artist, "album": row.album,
        "duration_s": row.duration_s if row.duration_s is not None else found["duration_s"],
        "codec": row.codec or found["codec"],
        "sample_rate": row.sample_rate or found["sample_rate"],
    }


def _version_of(conn: Connection, workspace_id: str, rows: list[Any]) -> Any:
    """The group an unsure audio match joins: the first live row's primary."""
    live = [row for row in rows if row.deleted_at is None]
    if not live:
        return None
    primary = live[0].duplicate_of
    if primary is None:
        return live[0]
    found = _song(conn, workspace_id, int(primary))
    return found if found is not None and found.deleted_at is None else live[0]


def register(conn: Connection, workspace_id: str, *, sha: str, new: dict[str, Any],
             song_id: int | None, audio_id: str | None) -> int | None:
    """The catalogue id of the accepted upload with file hash `sha`. `new` is the registration
    for a song the library doesn't have (title and artist from the file name)."""
    from selecta.local_media import store

    audio = audio_id if _audio_on() else None
    named = _song(conn, workspace_id, song_id) if song_id is not None else None
    if named is not None and named.deleted_at is None and _is(conn, workspace_id, named, sha,
                                                               audio):
        if sha != named.content_sha256 and _owner(conn, workspace_id, sha) is None:
            _record_hash(conn, workspace_id, int(named.id), sha)
        _fill_audio(conn, workspace_id, named, audio)
        return int(named.id)
    owner = _owner(conn, workspace_id, sha)
    if owner is not None and owner.deleted_at is None:
        _fill_audio(conn, workspace_id, owner, audio)
        return int(owner.id)
    song: dict[str, Any] = dict(new)
    if owner is not None:
        song = _kept(owner, sha, new)  # a removed song comes back with its own words
    else:
        matches = _same_audio(conn, workspace_id, audio)
        if len(matches) == 1 and matches[0].deleted_at is None:
            song = _kept(matches[0], sha, new)
        elif len(matches) > 1:
            group = _version_of(conn, workspace_id, matches)
            if group is not None:
                # the same audio twice over: a version of that song, named as it is
                song.update(title=group.title, artist=group.artist, album=group.album)
    if audio:
        song["audio_id"] = audio
    answers = store.register_songs(conn, workspace_id, [song], audio_ids=True)
    return int(answers[0]["song_id"]) if answers else None


__all__ = [
    "FLAG", "MISMATCH", "MISMATCH_WORDS", "accept_refusal", "audio_id_of", "clean_audio_id",
    "cloud_copy", "cloud_copy_of_hash", "on", "plan_song", "register", "song_hashes", "song_of",
]
