"""Business uploads: the rights attestation per upload batch and ISRC from tags (ADR-0449
BZ-0449-04, -07), hooked into the hosted upload path (`storage.api`) while `business.licensing`
is on.

**Batches.** Before files go into an organisation library, the uploader confirms the upload
rights statement for a batch of N files (`POST /api/business/uploads/attestation`, in
`licensing_routes`), which answers a batch id. The upload plan then names that batch in the
`X-Upload-Batch` header; `require_batch` refuses a plan with no batch, someone else's batch, a
batch from another organisation (a transferred venue's new organisation attests again), more
files than were attested, or an organisation whose uploads are suspended after repeated
copyright notices. Personal workspaces are never asked.

**ISRC.** The upload sandbox reads the file's ISRC tag (`storage.audio_check`), so the server
never parses an uploaded file's tags itself; `record_isrc` keeps it against the new asset, and
the play log finds it by the song's content hash (`isrc_for_song`).
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta import flags
from selecta.business import isrc, terms

FLAG = "business.licensing"
HEADER = "x-upload-batch"


class AttestationRequired(Exception):
    """The plan names no valid attested batch. `code` and the statement go to the uploader."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _on() -> bool:
    try:
        return flags.on(FLAG)
    except KeyError:
        return False


def is_business(conn: Connection, workspace_id: str) -> bool:
    from selecta.identity.schema import workspaces

    kind = conn.execute(sa.select(workspaces.c.kind).where(workspaces.c.id == workspace_id)
                        ).scalar()
    return kind == "business"


def require_batch(conn: Connection, workspace_id: str, batch_id: str | None,
                  file_count: int) -> None:
    """Refuse an organisation upload plan without a matching attested batch."""
    if not _on() or not is_business(conn, workspace_id):
        return
    try:
        terms.require_upload_attestation(conn, workspace_id, batch_id,
                                         files_so_far=file_count)
    except terms.UploadRefused as error:
        code = getattr(error, "code", "") or "upload_attestation_required"
        if code == terms.UploadRefused.code:
            code = "upload_attestation_required"
        raise AttestationRequired(code, str(error)) from error


def record_isrc(conn: Connection, workspace_id: str, asset_id: str, code: str | None, *,
                actor: str, now: float) -> str | None:
    """Keep the ISRC the sandbox read from an organisation upload's tags."""
    if not code or not _on() or not is_business(conn, workspace_id):
        return None
    return isrc.record_tag_isrc(conn, workspace_id, asset_id, {"ISRC": code}, actor=actor,
                                now=now)


def isrc_for_song(conn: Connection, workspace_id: str, song_id: int | str) -> str | None:
    """A catalogue song's ISRC: its own record, else the uploaded file with the same content."""
    from selecta.local_media.schema import local_songs
    from selecta.storage.schema import assets

    found = isrc.current_isrc(conn, workspace_id, str(song_id))
    if found:
        return found
    sha = conn.execute(sa.select(local_songs.c.content_sha256).where(
        local_songs.c.id == int(song_id), local_songs.c.workspace_id == workspace_id)).scalar()
    if not sha:
        return None
    for (asset_id,) in conn.execute(sa.select(assets.c.id).where(
            assets.c.workspace_id == workspace_id, assets.c.sha256 == sha)):
        found = isrc.current_isrc(conn, workspace_id, str(asset_id))
        if found:
            return found
    return None


__all__ = ["HEADER", "AttestationRequired", "is_business", "isrc_for_song", "record_isrc",
           "require_batch"]
