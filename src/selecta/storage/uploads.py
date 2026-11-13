"""Uploads: always multipart, finished by the server, paid for with a quota reservation (§5.2).

R2 can't enforce a size when it signs an upload URL, so the server owns the one step that
matters, completion. The steps, each keyed by the upload session's id so repeating one gives the
same outcome:

1. **Plan** (`plan_batch`): up to 500 files. For each, check the plan's per-file size, reserve
   its bytes, flag duplicates, make an upload session, and start an R2 multipart upload in the
   staging bucket.
2. **Transfer**: the browser asks for presigned part URLs (`presign_parts`) and uploads 8 MiB
   parts straight to R2. After a refresh it lists what already arrived (`uploaded_parts`).
3. **Finish** (`complete`): the server lists every part, checks the total is exactly the
   declared, reserved size and the parts are split as planned, then completes the upload itself.
   Anything else is aborted and its reservation released.
4. **Accept or reject** (`accept`, `reject`): after `ingest.validate` has probed the file, a
   good one is copied into the originals bucket, becomes an asset and its reservation becomes
   committed usage; a bad one is deleted, its reservation released, and the reason kept.

`expire_sessions` cleans up sessions nobody finished within two days, matching the staging
bucket's lifecycle. Session statuses: planned (no multipart upload yet: R2 was unreachable while
planning; `start` retries), uploading, completing, completed, then accepted, rejected, aborted or
expired.

Every method takes the caller's connection and runs inside the caller's transaction. Calls to R2
happen inside it too, so a failure leaves the database as it was; any R2 object left behind by a
rolled-back transaction is cleared by the staging bucket's lifecycle rules.
"""

from __future__ import annotations

import logging
import math
import re
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.persistence import db_now, lock_rows, new_id
from selecta.lf_egress import require_upload_action
from selecta.storage.artifacts import DEFAULT_BUCKETS, MAX_URL_TTL, Buckets
from selecta.storage.keys import original_key, staging_key
from selecta.storage.names import DEFAULT_CONTENT_TYPE, content_type, display_name, sha256_hex
from selecta.storage.objects import ObjectClient, Part, R2Error, R2NotFound
from selecta.storage.parts import MAX_FILE_BYTES, PART_SIZE, check_parts, plan_parts
from selecta.storage.ports import (
    DuplicatePort,
    PlanLimits,
    PlanLimitsPort,
    QuotaExceeded,
    QuotaPort,
)
from selecta.storage.schema import assets, upload_sessions

log = logging.getLogger(__name__)

SESSION_TTL = 2 * 24 * 3600
PART_URL_TTL = MAX_URL_TTL
MAX_BATCH = 500
MAX_PRESIGN_BATCH = 100
MAX_ERROR_LENGTH = 500
EXPIRED_REASON = "This upload took too long and expired; please upload the file again."
# R2 errors at completion that mean the parts themselves are wrong, not that R2 is unwell.
BAD_PARTS = frozenset({"InvalidPart", "InvalidPartOrder", "EntityTooSmall", "EntityTooLarge"})
FORMAT_TYPES = {
    "mp3": "audio/mpeg",
    "flac": "audio/flac",
    "wav": "audio/wav",
    "aiff": "audio/aiff",
    "m4a": "audio/mp4",
    "mp4": "audio/mp4",
    "aac": "audio/aac",
    "ogg": "audio/ogg",
    "opus": "audio/ogg",
}


class Status(StrEnum):
    PLANNED = "planned"
    UPLOADING = "uploading"
    COMPLETING = "completing"
    COMPLETED = "completed"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    ABORTED = "aborted"
    EXPIRED = "expired"


ACTIVE = frozenset({Status.PLANNED, Status.UPLOADING, Status.COMPLETING, Status.COMPLETED})
ENDED = frozenset({Status.ACCEPTED, Status.REJECTED, Status.ABORTED, Status.EXPIRED})


class UploadError(Exception):
    """Something about an upload that the caller should show or handle."""


class SessionNotFound(UploadError, LookupError):
    """No upload session with that id (in that workspace)."""


class InvalidState(UploadError):
    """The session isn't at a step where that can happen."""


class BatchTooLarge(UploadError, ValueError):
    """More files than one batch may plan."""


@dataclass(frozen=True)
class FileSpec:
    """One file as the browser describes it, before anything is trusted."""

    name: str
    size: int
    content_type: str | None = None
    sha256: str | None = None


@dataclass(frozen=True)
class UploadSession:
    id: str
    workspace_id: str
    display_name: str
    declared_size: int
    content_type: str
    sha256: str | None
    part_size: int
    upload_id: str | None
    staging_key: str
    status: Status
    reservation_id: str | None
    duplicate_of: str | None
    error: str | None
    created_at: float
    updated_at: float
    expires_at: float

    @property
    def part_count(self) -> int:
        return plan_parts(self.declared_size, self.part_size).part_count

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> UploadSession:
        values = {name: row[name] for name in cls.__dataclass_fields__}
        values["status"] = Status(values["status"])
        return cls(**values)


@dataclass(frozen=True)
class PlannedFile:
    """What planning made of one file: a session, or the reason there isn't one.

    `duplicate_of` is something the workspace already has with the same SHA-256 (ask: skip or
    keep both; skipping is `cancel`). `same_as` is another live upload session sending the same
    file, from this batch or another tab.
    """

    index: int
    name: str
    session: UploadSession | None = None
    refused: str | None = None
    duplicate_of: str | None = None
    same_as: str | None = None


@dataclass(frozen=True)
class Probe:
    """What `ingest.validate` found by reading the staged file itself."""

    format: str
    duration_s: float
    sample_rate: int
    channels: int
    sha256: str
    size: int | None = None

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[a-z0-9]{1,16}", self.format or ""):
            raise ValueError("A probe's format is a short lower-case name such as 'mp3'.")
        if not re.fullmatch(r"[0-9a-f]{64}", self.sha256 or ""):
            raise ValueError("A probe's sha256 is 64 lower-case hex digits.")
        if not (math.isfinite(self.duration_s) and self.duration_s > 0):
            raise ValueError("A probe's duration must be a positive number of seconds.")
        if self.sample_rate <= 0 or self.channels <= 0:
            raise ValueError("A probe's sample rate and channel count must be positive.")


@dataclass(frozen=True)
class Outcome:
    session: UploadSession
    asset_id: str | None = None

    @property
    def status(self) -> Status:
        return self.session.status

    @property
    def error(self) -> str | None:
        return self.session.error


def _size_text(size: int) -> str:
    if size >= 1_000_000_000:
        return f"{size / 1_000_000_000:.1f}".rstrip("0").rstrip(".") + " GB"
    return f"{max(1, round(size / 1_000_000))} MB"


def _minutes_text(seconds: float) -> str:
    minutes = max(1, round(seconds / 60))
    return f"{minutes} minute" + ("" if minutes == 1 else "s")


class Uploads:
    """The upload protocol for one R2 account. Share one per process."""

    def __init__(
        self,
        client: ObjectClient,
        *,
        quota: QuotaPort,
        limits: PlanLimitsPort,
        duplicates: DuplicatePort | None = None,
        buckets: Buckets = DEFAULT_BUCKETS,
        max_workers: int = 8,
    ) -> None:
        self.client = client
        self.quota = quota
        self.limits = limits
        self.duplicates = duplicates
        self.buckets = buckets
        self.max_workers = max(1, max_workers)

    # -- reading sessions -------------------------------------------------------------------

    def get(
        self, conn: Connection, session_id: str, *, workspace_id: str | None = None
    ) -> UploadSession:
        return self._load(conn, session_id, workspace_id, lock=False)

    def active_sessions(self, conn: Connection, workspace_id: str) -> list[UploadSession]:
        """Sessions still in flight, oldest first, so a refreshed page can pick them up again."""
        query = (
            sa.select(upload_sessions)
            .where(upload_sessions.c.workspace_id == workspace_id)
            .where(upload_sessions.c.status.in_([status.value for status in ACTIVE]))
            .order_by(upload_sessions.c.created_at)
        )
        return [UploadSession.from_row(row) for row in conn.execute(query).mappings()]

    # -- 1. plan ----------------------------------------------------------------------------

    def plan_batch(
        self, conn: Connection, workspace_id: str, files: Sequence[FileSpec]
    ) -> list[PlannedFile]:
        """Plan up to 500 files, one result per file in the order given."""
        require_upload_action("plan")
        files = list(files)
        if len(files) > MAX_BATCH:
            raise BatchTooLarge(
                f"Upload at most {MAX_BATCH} files at a time; this was {len(files)}."
            )
        if not files:
            return []
        limits = self.limits.limits(conn, workspace_id)
        now = db_now(conn)
        results: list[PlannedFile] = []
        in_batch: dict[str, str] = {}
        for index, spec in enumerate(files):
            name = display_name(spec.name)
            refusal = self._refusal(spec.size, limits)
            if refusal:
                results.append(PlannedFile(index, name, refused=refusal))
                continue
            sha = sha256_hex(spec.sha256)
            duplicate_of = same_as = None
            if sha:
                if self.duplicates is not None:
                    duplicate_of = self.duplicates.find_by_sha256(conn, workspace_id, sha)
                same_as = in_batch.get(sha) or self._live_session_with(conn, workspace_id, sha)
            session_id = new_id()
            session = UploadSession(
                id=session_id,
                workspace_id=workspace_id,
                display_name=name,
                declared_size=spec.size,
                content_type=content_type(spec.content_type),
                sha256=sha,
                part_size=PART_SIZE,
                upload_id=None,
                staging_key=staging_key(session_id),
                status=Status.PLANNED,
                reservation_id=None,
                duplicate_of=duplicate_of,
                error=None,
                created_at=now,
                updated_at=now,
                expires_at=now + SESSION_TTL,
            )
            try:
                # A savepoint per file: a refused reservation undoes just this file's session.
                with conn.begin_nested():
                    row = {f: getattr(session, f) for f in UploadSession.__dataclass_fields__}
                    conn.execute(sa.insert(upload_sessions).values(**row))
                    reservation = self.quota.reserve(conn, workspace_id, spec.size, session_id)
                    conn.execute(
                        sa.update(upload_sessions)
                        .where(upload_sessions.c.id == session_id)
                        .values(reservation_id=reservation)
                    )
            except QuotaExceeded as exc:
                results.append(PlannedFile(index, name, refused=str(exc)))
                continue
            if sha:
                in_batch.setdefault(sha, session_id)
            session = replace(session, reservation_id=reservation)
            results.append(PlannedFile(index, name, session, None, duplicate_of, same_as))
        started = self._start_all(conn, [r.session for r in results if r.session is not None])
        return [
            replace(r, session=started.get(r.session.id, r.session)) if r.session else r
            for r in results
        ]

    def start(
        self, conn: Connection, session_id: str, *, workspace_id: str | None = None
    ) -> UploadSession:
        """Create the multipart upload for a session planning couldn't start. Repeatable."""
        session = self._load(conn, session_id, workspace_id, lock=True)
        if session.status is not Status.PLANNED:
            return session
        require_upload_action("start")
        if session.expires_at <= db_now(conn):
            raise InvalidState("This upload has expired; please upload the file again.")
        upload_id = self.client.create_multipart_upload(
            self.buckets.staging, session.staging_key, content_type=session.content_type
        )
        return self._update(conn, session, status=Status.UPLOADING, upload_id=upload_id)

    # -- 2. transfer ------------------------------------------------------------------------

    def presign_parts(
        self, session: UploadSession, part_numbers: Sequence[int], *, ttl: int = PART_URL_TTL
    ) -> dict[int, str]:
        """Presigned `PUT` URLs for up to 100 parts at a time, by part number. The URLs are
        secrets until they expire: hand them to the browser, never log them."""
        require_upload_action("parts")
        if session.status is not Status.UPLOADING or not session.upload_id:
            raise InvalidState(f"Parts can't be sent to an upload that is {session.status}.")
        numbers = sorted(set(part_numbers))
        if not numbers or len(numbers) > MAX_PRESIGN_BATCH:
            raise ValueError(f"Ask for 1 to {MAX_PRESIGN_BATCH} parts at a time.")
        count = session.part_count
        if numbers[0] < 1 or numbers[-1] > count:
            raise ValueError(f"This file has parts 1 to {count}.")
        if not 1 <= ttl <= MAX_URL_TTL:
            raise ValueError(f"Part URLs last 1 to {MAX_URL_TTL} seconds.")
        bucket = self.buckets.staging
        plan = plan_parts(session.declared_size, session.part_size)
        # Each URL signs its part's exact length: R2 can't cap a part's size any other way, and
        # an unsigned length would let the holder park up to 5 GiB per part in staging.
        return {
            number: self.client.presign_upload_part(
                bucket,
                session.staging_key,
                session.upload_id,
                number,
                ttl,
                content_length=plan.last_part_size if number == count else plan.part_size,
            )
            for number in numbers
        }

    def uploaded_parts(self, session: UploadSession) -> list[Part]:
        """The parts R2 already has, so a refreshed page sends only the rest."""
        if session.status not in {Status.UPLOADING, Status.COMPLETING} or not session.upload_id:
            return []
        try:
            return self.client.list_parts(
                self.buckets.staging, session.staging_key, session.upload_id
            )
        except R2NotFound:
            return []

    # -- 3. finish --------------------------------------------------------------------------

    def complete(
        self, conn: Connection, session_id: str, *, workspace_id: str | None = None
    ) -> Outcome:
        """Check what arrived and complete the upload on the server. Calling it again returns the
        same outcome; R2 errors worth retrying are raised, leaving the session as it was."""
        require_upload_action("complete")
        session = self._load(conn, session_id, workspace_id, lock=True)
        if session.status is Status.ACCEPTED:
            return Outcome(session, asset_id=session.id)
        if session.status is Status.COMPLETED or session.status in ENDED:
            return Outcome(session)
        if session.expires_at <= db_now(conn):
            # Its reservation has run out with it (spec 5.3), so it can't become an asset now.
            return self._finish(conn, session, Status.EXPIRED, EXPIRED_REASON)
        if session.status is Status.PLANNED or not session.upload_id:
            return self._finish(conn, session, Status.ABORTED, "No data arrived for this file.")
        bucket, key = self.buckets.staging, session.staging_key
        session = self._update(conn, session, status=Status.COMPLETING)
        try:
            parts = self.client.list_parts(bucket, key, session.upload_id)
        except R2NotFound:
            # Already completed by an earlier call whose transaction was lost, or aborted.
            return self._settle(conn, session)
        problem = check_parts(parts, session.declared_size, session.part_size)
        if problem:
            return self._finish(conn, session, Status.ABORTED, problem)
        try:
            self.client.complete_multipart_upload(bucket, key, session.upload_id, parts)
        except R2NotFound:
            return self._settle(conn, session)
        except R2Error as exc:
            if exc.code not in BAD_PARTS:
                raise
            return self._finish(
                conn, session, Status.ABORTED, "The file's parts didn't fit together."
            )
        return self._settle(conn, session)

    def _settle(self, conn: Connection, session: UploadSession) -> Outcome:
        """The multipart upload is over: completed if the staged object is exactly the declared
        size (checked with a HEAD, so a part replaced after listing can't slip through)."""
        try:
            head = self.client.head_object(self.buckets.staging, session.staging_key)
        except R2NotFound:
            reason = "The upload was lost before it finished; please upload the file again."
            return self._finish(conn, session, Status.ABORTED, reason)
        if head.size != session.declared_size:
            reason = "The finished file wasn't the size that was declared."
            return self._finish(conn, session, Status.ABORTED, reason)
        now = db_now(conn)
        session = self._update(
            conn,
            session,
            now=now,
            status=Status.COMPLETED,
            error=None,
            expires_at=now + SESSION_TTL,
        )
        return Outcome(session)

    # -- 4. accept or reject ----------------------------------------------------------------

    def accept(
        self, conn: Connection, session_id: str, probe: Probe, *, workspace_id: str | None = None
    ) -> Outcome:
        """Keep a validated file: copy it to the originals bucket, record the asset, and turn
        the reservation into committed usage. The asset takes the session's id, so a retry
        copies to the same key and finds the same row."""
        require_upload_action("accept")
        session = self._load(conn, session_id, workspace_id, lock=True)
        if session.status is Status.ACCEPTED:
            return Outcome(session, asset_id=session.id)
        if session.status is not Status.COMPLETED:
            raise InvalidState(
                f"Only a completed upload can be accepted; this one is {session.status}."
            )
        if probe.size is not None and probe.size != session.declared_size:
            reason = "The file changed size while it was being checked."
            return self._finish(conn, session, Status.REJECTED, reason)
        if session.sha256 is not None and probe.sha256 != session.sha256:
            reason = "The file contents changed while they were being checked."
            return self._finish(conn, session, Status.REJECTED, reason)
        limits = self.limits.limits(conn, session.workspace_id)
        if limits.max_duration_s is not None and probe.duration_s > limits.max_duration_s:
            reason = (
                f"This song is {_minutes_text(probe.duration_s)} long, over your plan's "
                f"{_minutes_text(limits.max_duration_s)} limit."
            )
            return self._finish(conn, session, Status.REJECTED, reason)
        asset_id = session.id
        key = original_key(session.workspace_id, asset_id)
        if not self._copy_to_originals(session, key, probe):
            reason = "The uploaded file was lost before it could be kept; please upload it again."
            return self._finish(conn, session, Status.REJECTED, reason)
        now = db_now(conn)
        known = conn.execute(sa.select(assets.c.id).where(assets.c.id == asset_id)).first()
        if known is None:
            conn.execute(
                sa.insert(assets).values(
                    id=asset_id,
                    workspace_id=session.workspace_id,
                    original_key=key,
                    size=session.declared_size,
                    sha256=probe.sha256,
                    format=probe.format,
                    duration_s=float(probe.duration_s),
                    sample_rate=int(probe.sample_rate),
                    channels=int(probe.channels),
                    created_at=now,
                )
            )
        if session.reservation_id:
            self.quota.commit(conn, session.reservation_id)
        session = self._update(conn, session, now=now, status=Status.ACCEPTED, error=None)
        self._delete_staged(session)
        return Outcome(session, asset_id=asset_id)

    def _copy_to_originals(self, session: UploadSession, key: str, probe: Probe) -> bool:
        """Copy the staged file to `key`. False if neither the staged file nor an earlier copy
        is there any more."""
        originals = self.buckets.originals
        try:
            self.client.copy_object(
                self.buckets.staging,
                session.staging_key,
                originals,
                key,
                size=session.declared_size,
                content_type=FORMAT_TYPES.get(probe.format, DEFAULT_CONTENT_TYPE),
                metadata={"sha256": probe.sha256},
            )
        except R2NotFound:
            pass
        # An earlier attempt may have copied it and removed the staged file before its
        # transaction was lost.
        try:
            head = self.client.head_object(originals, key)
        except R2NotFound:
            return False
        if head.size != session.declared_size:
            raise UploadError(f"The original for upload {session.id} isn't the size it should be.")
        if head.metadata.get("sha256") != probe.sha256:
            raise UploadError(
                f"The original for upload {session.id} doesn't have the expected content hash."
            )
        return True

    def reject(
        self, conn: Connection, session_id: str, reason: str, *, workspace_id: str | None = None
    ) -> Outcome:
        """Refuse a file that failed validation: delete it, release its bytes, keep the reason."""
        session = self._load(conn, session_id, workspace_id, lock=True)
        if session.status is Status.ACCEPTED:
            raise InvalidState("This upload was already accepted; delete the song instead.")
        if session.status in ENDED:
            return Outcome(session)
        return self._finish(conn, session, Status.REJECTED, reason or "This file couldn't be used.")

    def cancel(
        self,
        conn: Connection,
        session_id: str,
        reason: str = "Cancelled.",
        *,
        workspace_id: str | None = None,
    ) -> Outcome:
        """Stop an upload the person no longer wants (skip a duplicate, close the dialog)."""
        session = self._load(conn, session_id, workspace_id, lock=True)
        if session.status is Status.ACCEPTED:
            raise InvalidState("This upload was already accepted; delete the song instead.")
        if session.status in ENDED:
            return Outcome(session)
        return self._finish(conn, session, Status.ABORTED, reason)

    # -- maintenance ------------------------------------------------------------------------

    def expire_sessions(
        self, conn: Connection, now: float | None = None, *, limit: int = 200
    ) -> int:
        """End sessions past their expiry: discard what was staged and release their bytes.
        Runs across workspaces, so call it from maintenance with a role that sees them all.
        Sessions another transaction holds are skipped and picked up next time."""
        moment = db_now(conn) if now is None else now
        query = lock_rows(
            sa.select(upload_sessions)
            .where(upload_sessions.c.status.in_([status.value for status in ACTIVE]))
            .where(upload_sessions.c.expires_at <= moment)
            .order_by(upload_sessions.c.expires_at)
            .limit(limit)
        )
        rows = conn.execute(query).mappings().all()
        for row in rows:
            self._finish(conn, UploadSession.from_row(row), Status.EXPIRED, EXPIRED_REASON)
        return len(rows)

    # -- plumbing ---------------------------------------------------------------------------

    @staticmethod
    def _refusal(size: Any, limits: PlanLimits) -> str | None:
        if not isinstance(size, int) or isinstance(size, bool):
            return "This file's size wasn't given."
        if size < 1:
            return "This file is empty."
        cap = min(limits.max_file_bytes, MAX_FILE_BYTES)
        if size > cap:
            return f"This file is {_size_text(size)}, over the {_size_text(cap)} limit per file."
        return None

    def _live_session_with(self, conn: Connection, workspace_id: str, sha: str) -> str | None:
        query = (
            sa.select(upload_sessions.c.id)
            .where(upload_sessions.c.workspace_id == workspace_id)
            .where(upload_sessions.c.sha256 == sha)
            .where(upload_sessions.c.status.in_([status.value for status in ACTIVE]))
            .limit(1)
        )
        return conn.execute(query).scalar_one_or_none()

    def _start_all(
        self, conn: Connection, sessions: list[UploadSession]
    ) -> dict[str, UploadSession]:
        """Create multipart uploads for planned sessions, several at once. A session R2 couldn't
        start stays planned; `start` tries again when the browser asks for its parts."""
        pending = [session for session in sessions if session.status is Status.PLANNED]
        if not pending:
            return {}
        bucket = self.buckets.staging

        def create(session: UploadSession) -> str | None:
            try:
                return self.client.create_multipart_upload(
                    bucket, session.staging_key, content_type=session.content_type
                )
            except R2Error as exc:
                log.warning("Couldn't start upload %s yet: %s", session.id, exc.code or exc.status)
                return None

        workers = min(self.max_workers, len(pending))
        if workers == 1:
            upload_ids = [create(session) for session in pending]
        else:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                upload_ids = list(pool.map(create, pending))
        now = db_now(conn)
        started: dict[str, UploadSession] = {}
        for session, upload_id in zip(pending, upload_ids, strict=True):
            if upload_id:
                started[session.id] = self._update(
                    conn, session, now=now, status=Status.UPLOADING, upload_id=upload_id
                )
        return started

    def _finish(
        self, conn: Connection, session: UploadSession, status: Status, reason: str
    ) -> Outcome:
        """End a session that won't become an asset: discard staged data, release its bytes."""
        self._discard(session)
        if session.reservation_id:
            self.quota.release(conn, session.reservation_id)
        session = self._update(conn, session, status=status, error=reason[:MAX_ERROR_LENGTH])
        return Outcome(session)

    def _discard(self, session: UploadSession) -> None:
        """Abort the multipart upload and delete the staged object. Best effort: if R2 is down,
        the staging bucket's lifecycle rules remove both within two days."""
        if not session.upload_id:
            return
        bucket, key = self.buckets.staging, session.staging_key
        try:
            self.client.abort_multipart_upload(bucket, key, session.upload_id)
        except R2Error as exc:
            log.warning("Couldn't abort upload %s: %s", session.id, exc.code or exc.status)
        self._delete_staged(session)

    def _delete_staged(self, session: UploadSession) -> None:
        try:
            self.client.delete_object(self.buckets.staging, session.staging_key)
        except R2Error as exc:
            log.warning("Couldn't delete staged upload %s: %s", session.id, exc.code or exc.status)

    @staticmethod
    def _load(
        conn: Connection, session_id: str, workspace_id: str | None, *, lock: bool
    ) -> UploadSession:
        query = sa.select(upload_sessions).where(upload_sessions.c.id == session_id)
        if workspace_id is not None:
            query = query.where(upload_sessions.c.workspace_id == workspace_id)
        if lock:
            query = query.with_for_update()
        row = conn.execute(query).mappings().first()
        if row is None:
            raise SessionNotFound(f"There's no upload session {session_id!r}.")
        return UploadSession.from_row(row)

    @staticmethod
    def _update(
        conn: Connection, session: UploadSession, *, now: float | None = None, **values: Any
    ) -> UploadSession:
        values["updated_at"] = db_now(conn) if now is None else now
        conn.execute(
            sa.update(upload_sessions).where(upload_sessions.c.id == session.id).values(**values)
        )
        return replace(session, **values)
