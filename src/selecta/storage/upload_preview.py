"""`POST /api/uploads/preview`: what a batch of uploads would do, before anything is sent.

A dry run (`storage.upload_identity`): it creates no upload session, reserves no storage and
writes nothing. For each file, in the order given:

- `in_cloud_library`: the song already has a live upload under one of its file hashes (or this
  very file is one), so nothing needs sending;
- `refused`, with a `reason`: `song_mismatch` (the named song isn't this file, or isn't this
  workspace's), `format` (a kind of file uploads don't take, such as WMA), `too_large` or
  `too_long` (over the plan's per-file limits), or `quota` (no storage left for it, counting
  the files before it);
- `ok`: it would upload. A song over the server-mix length (`hosted_limits.MAX_SONG_S`) is
  still `ok`, with the note `long_for_server_mixes`.

The totals say how many bytes the files need and how many are left, how many fit, and, when the
plan's daily analysis cap applies (`hosted_caps`), how many days measuring them takes.

The route answers only the caller's own workspace, behind the same account gate as uploads.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta import hosted_caps, hosted_limits
from selecta.identity.tokens import Claims
from selecta.local_media import store
from selecta.persistence import transaction
from selecta.storage import upload_identity
from selecta.storage.names import display_name, sha256_hex
from selecta.storage.parts import MAX_FILE_BYTES
from selecta.storage.ports import PlanLimits, PlanLimitsPort
from selecta.storage.schema import assets
from selecta.storage.uploads import MAX_BATCH
from selecta.usage import quota

OK, IN_CLOUD, REFUSED = "ok", "in_cloud_library", "refused"
LONG_FOR_SERVER_MIXES = "long_for_server_mixes"
# The file kinds the upload check takes (`audio_check.KINDS`), by name; WMA is not one.
TAKEN = frozenset({"mp3", "flac", "wav", "wave", "aif", "aiff", "aifc", "m4a", "mp4", "aac",
                   "ogg", "oga", "opus"})


class PreviewFile(BaseModel):
    name: str = Field(min_length=1, max_length=512)
    size: int = Field(gt=0)
    sha256: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-fA-F]{64}$")
    song_id: int | None = Field(default=None, gt=0)
    duration: float | None = Field(default=None, gt=0)
    audio_id: str | None = Field(default=None, max_length=67)


class PreviewRequest(BaseModel):
    files: list[PreviewFile] = Field(max_length=MAX_BATCH)


def _extension(name: str) -> str:
    stem, dot, extension = name.rpartition(".")
    return extension.lower() if dot and stem else ""


def _uploaded_files(conn: Connection, workspace_id: str, hashes: list[str]) -> set[str]:
    """Which of these file hashes this workspace already holds as a live upload of its own."""
    import sqlalchemy as sa

    if not hashes:
        return set()
    return set(conn.execute(sa.select(assets.c.sha256).where(
        assets.c.workspace_id == workspace_id, assets.c.sha256.in_(sorted(set(hashes))),
        assets.c.deleted_at.is_(None), assets.c.venue_id.is_(None))).scalars())


def _refusal(item: PreviewFile, limits: PlanLimits) -> str | None:
    if _extension(item.name) not in TAKEN:
        return "format"
    if item.size > min(limits.max_file_bytes, MAX_FILE_BYTES):
        return "too_large"
    if (item.duration is not None and limits.max_duration_s is not None
            and item.duration > limits.max_duration_s):
        return "too_long"
    return None


def measure_days(conn: Connection, workspace_id: str, songs: int) -> int | None:
    """Days, today included, to measure `songs` new uploads under the plan's daily analysis cap,
    or None when no cap applies."""
    if not hosted_caps.enabled():
        return None
    allowance = hosted_caps.left(conn, workspace_id, hosted_caps.ANALYSIS)
    if allowance.limit is None or allowance.limit <= 0:
        return None
    if songs <= 0:
        return 0
    today = allowance.remaining or 0.0
    if songs <= today:
        return 1
    return 1 + math.ceil((songs - today) / allowance.limit)


def preview(conn: Connection, workspace_id: str, files: list[PreviewFile],
            limits: PlanLimits) -> dict[str, Any]:
    """The answer for these files in this workspace. Reads only."""
    usage = quota.usage(conn, workspace_id)
    left = 0 if usage.read_only else usage.available_bytes
    room = left
    answers: list[dict[str, Any]] = []
    needed = fit = 0
    full = False  # like the upload queue, the first file that won't fit stops the rest
    found: list[tuple[str, int | None, str | None]] = []
    for item in files:
        sha = sha256_hex(item.sha256)
        if item.song_id is None:
            found.append((sha, upload_identity.song_of(conn, workspace_id, sha), None))
            continue
        song_id = upload_identity.plan_song(conn, workspace_id, item.song_id, sha,
                                            upload_identity.clean_audio_id(item.audio_id))
        found.append((sha, song_id, None if song_id is not None else upload_identity.MISMATCH))
    # one read for every song's cloud copy, under any of its hashes (`store.cloud_copies`)
    copies = store.cloud_copies(conn, workspace_id, [song for _sha, song, _r in found if song])
    uploaded = _uploaded_files(conn, workspace_id, [sha for sha, song, _r in found if not song])
    for index, (item, (sha, song_id, reason)) in enumerate(zip(files, found, strict=True)):
        answer: dict[str, Any] = {"index": index, "name": display_name(item.name),
                                  "song_id": song_id, "status": OK, "reason": None, "notes": []}
        answers.append(answer)
        if reason is None and (song_id in copies if song_id else sha in uploaded):
            answer["status"] = IN_CLOUD
            continue
        reason = reason or _refusal(item, limits)
        if reason is None:
            needed += item.size
            if full or item.size > room:
                reason, full = "quota", True
            else:
                room -= item.size
                fit += 1
        if reason is not None:
            answer.update(status=REFUSED, reason=reason)
        elif hosted_limits.too_long(item.duration):
            answer["notes"].append(LONG_FOR_SERVER_MIXES)
    statuses = [answer["status"] for answer in answers]
    return {
        "files": answers,
        "totals": {
            "files": len(answers),
            "ok": statuses.count(OK),
            "in_cloud_library": statuses.count(IN_CLOUD),
            "refused": statuses.count(REFUSED),
            "bytes_needed": needed,
            "bytes_left": left,
            "fit": fit,
            "measure_days": measure_days(conn, workspace_id, fit),
        },
    }


def install(app: FastAPI, *, engine: Engine, current_claims: Callable[..., Claims],
            workspace: Callable[[Request, Claims], str],
            refuse_if_restricted: Callable[[str], None], limits: PlanLimitsPort) -> None:
    """Add the preview route beside the upload routes (`storage.api.install_routes`)."""

    @app.post("/api/uploads/preview")
    def preview_uploads(
        body: PreviewRequest,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        """A dry run of an upload batch: each file would upload, is already in the cloud
        library, or is refused and why, with the bytes needed and left and the days measuring
        takes. Creates and reserves nothing."""
        if not upload_identity.on():
            raise HTTPException(status_code=403, detail={
                "code": "flag_off", "flag": upload_identity.FLAG,
                "message": "This isn't available on this account right now."})
        workspace_id = workspace(request, claims)
        refuse_if_restricted(workspace_id)
        with transaction(engine, workspace_id) as conn:
            return preview(conn, workspace_id, body.files, limits.limits(conn, workspace_id))


__all__ = ["IN_CLOUD", "LONG_FOR_SERVER_MIXES", "OK", "REFUSED", "install", "measure_days",
           "preview"]
