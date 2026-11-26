"""An accepted upload joins the account's catalogue at once (staging walkthrough, item 13).

The browser-first Cloud shell lists the catalogue (`local_songs`), not the hosted assets, so an
upload that only became an `assets` row was stored but appeared nowhere. When an upload is
accepted, its song is registered in the catalogue by its content hash, through the catalogue's own
`register_songs` (one row per hash: the same file already imported on a device is the same song,
and grouping copies stays that module's job). The shell then lists it, marks it as stored in Cloud
(its hosted-copy check matches the hash) and plays it from the stored copy. With
`storage.upload_identity` the song is also found by the song the upload named, its other known
hashes and its audio id (`storage.upload_identity`).

The title and artist come from the file name: "Artist - Title.mp3" is split at the first " - ";
anything else is the title with the artist unknown. Tags read later by analysis may replace them.
"""

from __future__ import annotations

import logging
import re

from sqlalchemy.engine import Connection

log = logging.getLogger(__name__)

UNKNOWN_ARTIST = "Unknown artist"
_EXTENSION = re.compile(r"\.[A-Za-z0-9]{2,5}$")


def title_and_artist(file_name: str) -> tuple[str, str]:
    """("Call on Me", "Adekunle Gold") from "Adekunle Gold - Call on Me.mp3"."""
    stem = _EXTENSION.sub("", file_name.strip()).strip() or "Untitled"
    artist, sep, title = stem.partition(" - ")
    if sep and artist.strip() and title.strip():
        return title.strip()[:512], artist.strip()[:512]
    return stem[:512], UNKNOWN_ARTIST


def register_upload(
    conn: Connection, workspace_id: str, *, sha256: str, file_name: str,
    duration_s: float | None, codec: str | None, sample_rate: int | None,
    song_id: int | None = None, audio_id: str | None = None,
) -> int | None:
    """Add the uploaded song to the catalogue, or find it there. Returns its catalogue id. A
    failure is logged and leaves the upload accepted: the file is safe either way.

    With `storage.upload_identity` the song the upload named (`song_id`, already checked), the
    song's other known hashes and the audio id the server read (`audio_id`) find it too
    (`upload_identity.register`)."""
    import sqlalchemy as sa

    from selecta.local_media import store
    from selecta.local_media.schema import local_songs
    from selecta.storage import upload_identity

    if upload_identity.on():
        title, artist = title_and_artist(file_name)
        new = {"content_sha256": sha256.lower(), "title": title, "artist": artist,
               "duration_s": duration_s, "codec": codec, "sample_rate": sample_rate}
        try:
            with conn.begin_nested():
                return upload_identity.register(conn, workspace_id, sha=sha256.lower(), new=new,
                                                song_id=song_id, audio_id=audio_id)
        except Exception:  # noqa: BLE001 - the stored file must not be lost over its listing
            log.exception("upload.catalogue_link failed for workspace %s", workspace_id)
            return None
    # already in the catalogue (imported on a device, or uploaded before): keep its own title and
    # artist, which came from the file's tags, rather than ones guessed from a file name
    known = conn.execute(
        sa.select(local_songs.c.id, local_songs.c.deleted_at)
        .where(local_songs.c.workspace_id == workspace_id,
               local_songs.c.content_sha256 == sha256.lower())
    ).first()
    if known is not None and known.deleted_at is None:
        return int(known.id)
    title, artist = title_and_artist(file_name)
    song = {"content_sha256": sha256.lower(), "title": title, "artist": artist,
            "duration_s": duration_s, "codec": codec, "sample_rate": sample_rate}
    try:
        with conn.begin_nested():
            answers = store.register_songs(conn, workspace_id, [song])
    except Exception:  # noqa: BLE001 - the stored file must not be lost over its listing
        log.exception("upload.catalogue_link failed for workspace %s", workspace_id)
        return None
    return int(answers[0]["song_id"]) if answers else None


__all__ = ["UNKNOWN_ARTIST", "register_upload", "title_and_artist"]
