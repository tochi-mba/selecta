"""The derived-files collector: deletes worker outputs nothing uses (T-20261125-7e14).

Workers write every output under their own attempt folder before they complete
(`w/<workspace>/<kind>/<input_hash>/attempts/<attempt_id>/<name>`, `storage.keys`), and the
`artifacts` row names only the winning attempt's keys. A failed attempt, a lost lease, a later
attempt that published the same inputs again, and a crash between a row's delete and its
object's delete (`storage.eviction`, `storage.export_expiry`) all leave files no row names.
`collect` finds and deletes them, one workspace prefix at a time.

An object in a workspace's derived prefix is deleted only when every one of these holds:

1. it is a valid derived key of that same workspace (`storage.keys.validate_key`,
   `workspace_of`), listed under that workspace's own prefix: nothing else is ever touched;
2. no `artifacts` row of the workspace names it, and no live job of the workspace names it in
   its input (`input_ref`: an export queued with a playback file's key, say);
3. its attempt folder is a `job_attempts` row of the same workspace. Anything else (the
   `features` arrays written under the fixed folder `current`, or a folder this code doesn't
   know) is kept and counted as `kept_unknown`;
4. that attempt has ended (`outcome` set), and ended more than `GC_AGE_S` ago;
5. the object itself was written more than `GC_AGE_S` ago (the listing's `LastModified`; an
   object whose time can't be read is kept);
6. when a row for the same kind and inputs names another attempt (this file was superseded),
   that winning attempt also ended more than `GC_AGE_S` ago, so a player still holding a
   15-minute link to the old file is long finished.

`GC_AGE_S` is 6 hours: the longest job runtime limit is 36 minutes (a 30-minute song's
analysis, `hosted_limits.analysis_run_s`; `export.render` is 30), a signed upload link lives
15 minutes, and an attempt that has ended can't complete and write a row naming its files
afterwards (completion is fenced), so a running attempt, or one that finished minutes ago with
its row about to be written, never loses a file.

Bounded per run: at most `MAX_DELETE` objects deleted, `MAX_LIST` listed and `MAX_SECONDS`
spent; the next run carries on with the next workspace (a round robin kept by the task). Safe to
run twice and beside uploads: deletes are idempotent, and a decision is made from rows read
after the listing. With `dry_run` nothing is deleted and the report says what would be. Each
workspace's deletions are recorded as one `storage.derived_gc` audit event (counts per kind and
the attempt folders emptied), and the run's totals go to the console's read model
(`storage.derived_gc` metrics), which the Workers page can read.

`expire_idle_playback` also removes lossless playback files (`play.proxy`, kind `playback`)
nobody has used for `PLAYBACK_IDLE_DAYS`: they are about 40 MB a song, are remade on demand by
`work.proxies.prepare` the next time a mix needs them (15 to 35 s of cpu-light, about $0.0005),
and are never touched while a playing or frozen revision, a kiosk horizon or a live job uses them
(`storage.eviction.protected_ids`). The row goes first, in its own transaction, then the object,
as eviction does.

Deleting needs the `cloud.derived_gc` flag; with it off the maintenance task runs dry and still
reports, so an operator can read a dry run (`selecta storage gc`) before turning it on.
"""

from __future__ import annotations

import datetime as dt
import time
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta import persistence
from selecta.storage.keys import Bucket, UnsafeKey, validate_key, workspace_of, workspace_prefix
from selecta.storage.objects import ObjectClient, R2Error
from selecta.work.model import TERMINAL
from selecta.work.schema import artifacts, job_attempts, jobs, revision_artifacts

FLAG = "cloud.derived_gc"
TASK_NAME = "derived_gc"
EVERY_S = 3_600.0
GC_AGE_S = 6 * 3_600.0
"""How long after its attempt ended (and after it was written) an unnamed file may go."""
PLAYBACK_IDLE_DAYS = 30
"""A playback file unused this long is deleted and remade on demand (module notes)."""
PLAYBACK_KIND = "playback"
DAY_S = 86_400.0
MAX_DELETE = 1_000
MAX_LIST = 20_000
MAX_SECONDS = 120.0
MAX_PLAYBACK = 500
BATCH = 500
AUDIT_ACTION = "storage.derived_gc"
METRIC = "storage.derived_gc"


@dataclass
class Report:
    """What one run did (or, dry, would do). Counts are objects unless named otherwise."""

    dry_run: bool
    workspaces: int = 0
    listed: int = 0
    deleted: int = 0
    deleted_bytes: int = 0
    failed: int = 0
    kept_named: int = 0
    kept_running: int = 0
    kept_young: int = 0
    kept_unknown: int = 0
    kept_foreign: int = 0
    playback_expired: int = 0
    playback_bytes: int = 0
    stopped: str | None = None
    """"time", "delete" or "list" when a bound stopped the run early, else None."""
    by_kind: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {name: getattr(self, name) for name in self.__dataclass_fields__}

    def lines(self) -> list[str]:
        verb = "Would delete" if self.dry_run else "Deleted"
        kinds = ", ".join(f"{kind} {count}" for kind, count in sorted(self.by_kind.items()))
        return [
            f"{verb} {self.deleted} unused derived files ({self.deleted_bytes / 1e9:.2f} GB) "
            f"in {self.workspaces} workspaces{f' ({kinds})' if kinds else ''}.",
            f"Kept: {self.kept_named} named by a row or a live job, {self.kept_running} of "
            f"attempts running or ended within {GC_AGE_S / 3600:.0f} hours, {self.kept_young} "
            f"written within that time, {self.kept_unknown} in folders that are not job "
            f"attempts; {self.kept_foreign} listed keys outside the workspace's layout.",
            f"{verb} {self.playback_expired} playback files unused for {PLAYBACK_IDLE_DAYS} "
            f"days ({self.playback_bytes / 1e9:.2f} GB).",
            *([f"{self.failed} deletes failed and will be tried again."] if self.failed else []),
            *([f"Stopped early ({self.stopped} bound); the next run carries on."]
              if self.stopped else []),
        ]


def parse_time(text: str | None) -> float | None:
    """Epoch seconds from a listing's ISO time or a HEAD's HTTP date; None if unreadable."""
    if not text:
        return None
    try:
        moment = dt.datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError:
        try:
            moment = parsedate_to_datetime(str(text))
        except (TypeError, ValueError):
            return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt.UTC)
    return moment.timestamp()


def _strings(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list | tuple):
        for item in value:
            yield from _strings(item)


def named_keys(conn: Connection, workspace_id: str) -> set[str]:
    """Every key a row of the workspace names: its artifacts, and its live jobs' inputs."""
    named: set[str] = set()
    for stored in conn.execute(sa.select(artifacts.c["keys"]).where(
            artifacts.c.workspace_id == workspace_id)).scalars():
        named.update(_strings(stored))  # a list, one key, or any JSON shape holding keys
    return named | _live_job_keys(conn, workspace_id)


def _attempts(conn: Connection, workspace_id: str, ids: Iterable[str]) -> dict[str, tuple]:
    """(outcome, ended_at) for each of these attempt ids that is an attempt of the workspace."""
    found: dict[str, tuple] = {}
    wanted = sorted(set(ids))
    for start in range(0, len(wanted), BATCH):
        rows = conn.execute(sa.select(
            job_attempts.c.id, job_attempts.c.outcome, job_attempts.c.ended_at).where(
            job_attempts.c.workspace_id == workspace_id,
            job_attempts.c.id.in_(wanted[start:start + BATCH])))
        found.update({row.id: (row.outcome, row.ended_at) for row in rows})
    return found


def _winners(conn: Connection, workspace_id: str) -> dict[tuple[str, str], float | None]:
    """When the attempt each row names ended, per (kind, input hash); None when unknown."""
    rows = conn.execute(
        sa.select(artifacts.c.kind, artifacts.c.input_hash, job_attempts.c.ended_at)
        .select_from(artifacts.outerjoin(job_attempts, sa.and_(
            job_attempts.c.id == artifacts.c.attempt_id,
            job_attempts.c.workspace_id == artifacts.c.workspace_id)))
        .where(artifacts.c.workspace_id == workspace_id))
    return {(row.kind, row.input_hash): row.ended_at for row in rows}


@dataclass(frozen=True)
class _Listed:
    key: str
    kind: str
    input_hash: str
    attempt_id: str
    size: int
    written_at: float | None


def _parse(key: str, workspace_id: str, prefix: str) -> tuple[str, str, str] | None:
    """(kind, input hash, attempt id) of a derived key of this workspace, else None."""
    if not key.startswith(prefix):
        return None
    try:
        if validate_key(key) is not Bucket.DERIVED or workspace_of(key) != workspace_id:
            return None
    except UnsafeKey:
        return None
    _w, _ws, kind, input_hash, _attempts_dir, attempt_id, _name = key.split("/")
    return kind, input_hash, attempt_id


class _Budget:
    def __init__(self, *, max_delete: int, max_list: int, max_seconds: float,
                 clock: Callable[[], float]) -> None:
        self.max_delete, self.max_list, self.max_seconds = max_delete, max_list, max_seconds
        self.clock = clock
        self.started = clock()

    def spent(self, report: Report) -> str | None:
        if self.clock() - self.started >= self.max_seconds:
            return "time"
        if report.deleted >= self.max_delete:
            return "delete"
        if report.listed >= self.max_list:
            return "list"
        return None


def _decide(engine: Engine, workspace_id: str, page: list[_Listed], now: float,
            report: Report) -> list[_Listed]:
    """The listed files that may go (module notes), counting why the others stay."""
    cutoff = now - GC_AGE_S
    with persistence.transaction(engine, workspace_id) as conn:
        named = named_keys(conn, workspace_id)
        attempts = _attempts(conn, workspace_id, (item.attempt_id for item in page))
        winners = _winners(conn, workspace_id)
    doomed = []
    for item in page:
        if item.key in named:
            report.kept_named += 1
            continue
        found = attempts.get(item.attempt_id)
        if found is None:
            report.kept_unknown += 1
            continue
        outcome, ended_at = found
        if outcome is None or ended_at is None or float(ended_at) > cutoff:
            report.kept_running += 1
            continue
        if item.written_at is None or item.written_at > cutoff:
            report.kept_young += 1
            continue
        winner = (item.kind, item.input_hash)
        if winner in winners and (winners[winner] is None or float(winners[winner]) > cutoff):
            report.kept_running += 1
            continue
        doomed.append(item)
    return doomed


def _record(engine: Engine, workspace_id: str, gone: list[_Listed], report: Report,
            what: str) -> None:
    from selecta.authz import audit

    kinds: dict[str, int] = {}
    for item in gone:
        kinds[item.kind] = kinds.get(item.kind, 0) + 1
    with persistence.transaction(engine, workspace_id) as conn:
        audit.record(
            conn, action=AUDIT_ACTION, result="success", resource_type="workspace",
            resource_id=workspace_id, workspace_id=workspace_id,
            reason=f"{what}: {len(gone)} derived files no row or live job names",
            metadata={"objects": len(gone), "bytes": sum(item.size for item in gone),
                      "kinds": kinds, "dry_run": report.dry_run,
                      "attempts": sorted({item.attempt_id for item in gone})[:200]})


def _delete(objects: ObjectClient, bucket: str, items: list[_Listed]) -> tuple[list[_Listed], int]:
    """Delete in batches of at most 1,000; (what went, how many failed)."""
    gone: list[_Listed] = []
    failed = 0
    for start in range(0, len(items), 1_000):
        chunk = items[start:start + 1_000]
        by_key = {item.key: item for item in chunk}
        try:
            result = objects.delete_objects(bucket, list(by_key))
        except R2Error:
            failed += len(chunk)
            continue
        gone += [by_key[key] for key in result.deleted if key in by_key]
        failed += len(result.failed)
    return gone, failed


def collect_workspace(engine: Engine, objects: ObjectClient, bucket: str, workspace_id: str,
                      report: Report, budget: _Budget, *, now: float) -> bool:
    """Collect one workspace (module notes). False when a bound stopped it part way."""
    prefix = workspace_prefix(workspace_id)
    report.workspaces += 1
    page: list[_Listed] = []
    removed: list[_Listed] = []

    def settle() -> None:
        doomed = _decide(engine, workspace_id, page, now, report)
        room = max(0, budget.max_delete - report.deleted)
        doomed = doomed[:room]
        if report.dry_run:
            went, failed = doomed, 0
        else:
            went, failed = _delete(objects, bucket, doomed)
        report.failed += failed
        report.deleted += len(went)
        report.deleted_bytes += sum(item.size for item in went)
        for item in went:
            report.by_kind[item.kind] = report.by_kind.get(item.kind, 0) + 1
        removed.extend(went)
        page.clear()

    finished = True
    for listed in objects.list_objects_v2(bucket, prefix, page_size=1_000):
        report.listed += 1
        parsed = _parse(listed.key, workspace_id, prefix)
        if parsed is None:
            report.kept_foreign += 1
        else:
            page.append(_Listed(listed.key, *parsed, int(listed.size or 0),
                                parse_time(listed.last_modified)))
        if len(page) >= BATCH:
            settle()
        stop = budget.spent(report)
        if stop is not None:
            report.stopped = stop
            finished = False
            break
    if page:
        settle()
    if finished and report.deleted >= budget.max_delete:
        report.stopped, finished = "delete", False  # some may be left: carry on next run
    if removed:
        _record(engine, workspace_id, removed,
                report, "Would delete" if report.dry_run else "Deleted")
    return finished


def workspaces_with_ended_attempts(engine: Engine, before: float) -> list[str]:
    """Every workspace with an attempt that ended before `before`: the only places a file no
    row names can be (a running attempt's files are always kept)."""
    with persistence.transaction(engine) as conn:
        return sorted(conn.execute(sa.select(job_attempts.c.workspace_id).distinct().where(
            job_attempts.c.ended_at.is_not(None), job_attempts.c.ended_at < before)).scalars())


def _live_job_keys(conn: Connection, workspace_id: str) -> set[str]:
    live = conn.execute(sa.select(jobs.c.input_ref).where(
        jobs.c.workspace_id == workspace_id,
        jobs.c.state.notin_([str(state) for state in TERMINAL]))).scalars()
    return {key for input_ref in live for key in _strings(input_ref)}


def expire_idle_playback(engine: Engine, objects: ObjectClient | None, bucket: str,
                         report: Report, *, now: float, limit: int = MAX_PLAYBACK) -> None:
    """Delete playback files unused for `PLAYBACK_IDLE_DAYS` (module notes)."""
    from selecta.storage.eviction import protected_ids

    cutoff = now - PLAYBACK_IDLE_DAYS * DAY_S
    with persistence.transaction(engine) as conn:
        spaces = sorted(conn.execute(sa.select(artifacts.c.workspace_id).distinct().where(
            artifacts.c.kind == PLAYBACK_KIND, artifacts.c.last_used_at < cutoff)).scalars())
    for workspace_id in spaces:
        if report.playback_expired >= limit:
            report.stopped = report.stopped or "delete"
            return
        with persistence.transaction(engine, workspace_id) as conn:
            rows = conn.execute(
                sa.select(artifacts.c.id, artifacts.c["keys"], artifacts.c.size_bytes,
                          artifacts.c.attempt_id)
                .where(artifacts.c.workspace_id == workspace_id,
                       artifacts.c.kind == PLAYBACK_KIND, artifacts.c.last_used_at < cutoff)
                .order_by(artifacts.c.last_used_at, artifacts.c.id)
                .limit(limit - report.playback_expired)
                .with_for_update()).all()
            keep = protected_ids(conn, workspace_id)
            in_jobs = _live_job_keys(conn, workspace_id)
            chosen = [row for row in rows if row.id not in keep
                      and not set(_strings(row._mapping["keys"])) & in_jobs]
            if chosen and not report.dry_run:
                ids = [row.id for row in chosen]
                conn.execute(revision_artifacts.delete().where(
                    revision_artifacts.c.workspace_id == workspace_id,
                    revision_artifacts.c.artifact_id.in_(ids)))
                conn.execute(artifacts.delete().where(
                    artifacts.c.workspace_id == workspace_id, artifacts.c.id.in_(ids)))
        if not chosen:
            continue
        items = [_Listed(key, PLAYBACK_KIND, "", str(row.attempt_id or ""),
                         int(row.size_bytes or 0), None)
                 for row in chosen for key in _strings(row._mapping["keys"])
                 if _parse(key, workspace_id, workspace_prefix(workspace_id))]
        if not report.dry_run and objects is not None:
            # rows are gone: a crash here leaves files the collector removes on a later run
            _went, failed = _delete(objects, bucket, items)
            report.failed += failed
        report.playback_expired += len(chosen)
        report.playback_bytes += sum(int(row.size_bytes or 0) for row in chosen)
        _record(engine, workspace_id, items, report,
                f"{'Would expire' if report.dry_run else 'Expired'} playback files unused for "
                f"{PLAYBACK_IDLE_DAYS} days")


class Collector:
    """The maintenance task: a round robin over workspaces, bounded per run."""

    def __init__(self, engine: Engine, objects: Callable[[], ObjectClient], bucket: str, *,
                 dry_run: Callable[[], bool], clock: Callable[[], float] = time.monotonic,
                 max_delete: int = MAX_DELETE, max_list: int = MAX_LIST,
                 max_seconds: float = MAX_SECONDS) -> None:
        self.engine, self.objects, self.bucket = engine, objects, bucket
        self.dry_run = dry_run
        self.clock = clock
        self.bounds = dict(max_delete=max_delete, max_list=max_list, max_seconds=max_seconds)
        self.next_after: str = ""
        """The last workspace finished; the next run starts after it."""

    def run(self, *, now: float | None = None, only: str | None = None) -> Report:
        report = Report(dry_run=self.dry_run())
        budget = _Budget(**self.bounds, clock=self.clock)
        with persistence.transaction(self.engine) as conn:
            moment = persistence.db_now(conn) if now is None else now
        spaces = [only] if only else workspaces_with_ended_attempts(self.engine,
                                                                     moment - GC_AGE_S)
        order = [w for w in spaces if w > self.next_after] + [
            w for w in spaces if w <= self.next_after]
        client = self.objects()
        try:
            for workspace_id in order:
                if not collect_workspace(self.engine, client, self.bucket, workspace_id,
                                         report, budget, now=moment):
                    break
                self.next_after = workspace_id
            else:
                self.next_after = ""
            if report.stopped is None:
                expire_idle_playback(self.engine, client, self.bucket, report, now=moment)
        finally:
            getattr(client, "close", lambda: None)()
        _report_metrics(self.engine, report, moment)
        return report

    def __call__(self, _fence=None) -> dict[str, Any]:
        return self.run().to_dict()


def _report_metrics(engine: Engine, report: Report, now: float) -> None:
    from selecta.admin import read_models

    with persistence.transaction(engine) as conn:
        for name in ("deleted", "deleted_bytes", "playback_expired", "playback_bytes",
                     "failed", "kept_unknown"):
            read_models.report(conn, METRIC, float(getattr(report, name)),
                               {"what": name, "dry_run": str(report.dry_run).lower()}, now)


def last_run(conn: Connection) -> dict[str, Any] | None:
    """The newest run's totals from the read model, for the Workers page: {"at", "dry_run",
    "deleted", "deleted_bytes", "playback_expired", "playback_bytes", "failed",
    "kept_unknown"}, or None before the first run."""
    from selecta.admin.schema import admin_metrics

    rows = conn.execute(sa.select(admin_metrics.c.labels, admin_metrics.c.value,
                                  admin_metrics.c.as_of)
                        .where(admin_metrics.c.name == METRIC)).all()
    if not rows:
        return None
    import json

    newest = max(float(row.as_of) for row in rows)
    out: dict[str, Any] = {"at": newest}
    for row in rows:
        if float(row.as_of) != newest:
            continue
        labels = json.loads(row.labels or "{}")
        out["dry_run"] = labels.get("dry_run") == "true"
        out[labels.get("what", "")] = int(row.value or 0)
    return out


__all__ = [
    "EVERY_S", "FLAG", "GC_AGE_S", "PLAYBACK_IDLE_DAYS", "Collector", "Report",
    "collect_workspace", "expire_idle_playback", "last_run", "named_keys", "parse_time",
]
