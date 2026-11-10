"""The ten invariants of docs/saas/15-stress-testing.md §15.2, checked from the database.

Run `check(connection)` (or `assert_clean(engine)`) after a test, a scenario or a load run; it
reads every relevant table in one system transaction and returns each violation it finds, with
the invariant's number and a plain sentence. It changes nothing.

What each check looks at:

1. **No lost jobs.** Every attempt and dependency points at a job that exists; every unstarted
   job can still move (a queued job is counted in its fair-share head, a waiting one has a
   prerequisite that hasn't succeeded yet, a retry has a time to run, a blocked one says why or
   waits on a prerequisite that won't succeed);
   every running job holds exactly one live attempt; and, when the caller says which jobs were
   accepted, each of them is still there.
2. **No stale publish.** A succeeded job was finished by the attempt holding its current fencing
   token, and only by that one; every artifact row names that attempt.
3. **No cross-tenant rows.** Attempts, dependencies, parents and artifacts belong to the same
   workspace as their job, and every stored key starts with its row's own workspace.
4. **Quota never exceeded.** Committed plus reserved bytes fit the limit, unless the workspace is
   read-only because its plan shrank; reserved bytes equal its active reservations.
5. **Artifacts match their inputs.** Each artifact has a size and checksum and a provenance that
   passes `selecta.work.provenance`, and every key sits under
   `w/{workspace}/{kind}/{input_hash}/attempts/{attempt}/`. Given an `ArtifactStore`, the
   stored objects are verified too.
6. **Duplicates make one effect.** At most one live job per idempotency key, one artifact per
   input hash, one storage ledger entry per reservation and one terminal settlement each.
7. **Entitlements within plan.** A quota limit never exceeds what the workspace's plan or an
   active override gives, and no lane runs more at once than the plan's concurrency allows.
9. **No corrupt state.** Fair-share heads match the jobs table, finished jobs have no live
   attempt and a finish time, and counters are never negative.

Invariants 8 (AI output never authorises an action) and 10 (the UI never shows "done" without a
verified result) can't be read from the database; their tests live with the AI gateway and the
site. `NOT_CHECKED` names them so a report can say so.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta import persistence
from selecta.billing import plans as plan_catalogue
from selecta.billing.schema import entitlement_overrides
from selecta.storage.schema import assets
from selecta.usage.schema import quota_state, storage_reservations, usage_ledger
from selecta.work import provenance, upkeep
from selecta.work.model import ACTIVE, TERMINAL, UNSUCCESSFUL, JobState
from selecta.work.schema import artifacts, fair_heads, job_attempts, job_dependencies, jobs

S = JobState
NAMES = {
    1: "no lost jobs",
    2: "no stale publish",
    3: "no cross-tenant rows",
    4: "quota never exceeded",
    5: "artifacts match their inputs",
    6: "duplicates make one effect",
    7: "entitlements within plan",
    9: "no corrupt state",
}
NOT_CHECKED = {
    8: "AI output never authorises an action (checked by the AI gateway tests)",
    10: "the UI never shows done without a verified result (checked by the site's tests)",
}
BLOCK_REASONS = frozenset({"dependency", "flag_off", "staff_hold"})


@dataclass(frozen=True)
class Violation:
    invariant: int
    detail: str

    def __str__(self) -> str:
        return f"invariant {self.invariant} ({NAMES[self.invariant]}): {self.detail}"


class InvariantBroken(AssertionError):
    def __init__(self, found: list[Violation]) -> None:
        self.violations = found
        super().__init__("\n".join(str(item) for item in found))


def _rows(connection: Connection, table: sa.Table) -> list[Any]:
    return list(connection.execute(sa.select(table)))


def lost_jobs(connection: Connection, accepted: Iterable[str] = ()) -> list[Violation]:
    found: list[Violation] = []
    rows = {row.id: row for row in _rows(connection, jobs)}
    for job_id in accepted:
        if job_id not in rows:
            found.append(Violation(1, f"accepted job {job_id} is gone"))
    for attempt in _rows(connection, job_attempts):
        if attempt.job_id not in rows:
            found.append(Violation(1, f"attempt {attempt.id} belongs to a missing job"))
    prerequisites: dict[str, list[str]] = defaultdict(list)
    for link in _rows(connection, job_dependencies):
        if link.job_id not in rows or link.depends_on not in rows:
            found.append(Violation(1, f"dependency {link.job_id} -> {link.depends_on} is dangling"))
            continue
        prerequisites[link.job_id].append(rows[link.depends_on].state)
    live = Counter(
        row.job_id for row in connection.execute(
            sa.select(job_attempts.c.job_id).where(job_attempts.c.outcome.is_(None))
        )
    )
    for job in rows.values():
        state = S(job.state)
        if state in ACTIVE and live[job.id] != 1:
            found.append(Violation(1, f"{state} job {job.id} has {live[job.id]} live attempts"))
        elif state == S.WAITING_DEPS and not any(
            need != S.SUCCEEDED for need in prerequisites[job.id]
        ):
            found.append(Violation(1, f"waiting job {job.id} waits on nothing unfinished"))
        elif state == S.RETRY_SCHEDULED and job.not_before is None:
            found.append(Violation(1, f"retry of job {job.id} has no time to run"))
        elif (
            state == S.BLOCKED
            and job.error_class not in BLOCK_REASONS
            and not any(S(need) in UNSUCCESSFUL | {S.BLOCKED} for need in prerequisites[job.id])
        ):
            found.append(Violation(1, f"blocked job {job.id} has no reason to be"))
    return found


def stale_publish(connection: Connection) -> list[Violation]:
    found: list[Violation] = []
    rows = {row.id: row for row in _rows(connection, jobs)}
    winners: dict[str, list[Any]] = defaultdict(list)
    attempts = {row.id: row for row in _rows(connection, job_attempts)}
    for attempt in attempts.values():
        if attempt.outcome == "succeeded":
            winners[attempt.job_id].append(attempt)
    for job_id, won in winners.items():
        job = rows.get(job_id)
        if len(won) > 1:
            found.append(Violation(2, f"job {job_id} was published by {len(won)} attempts"))
        for attempt in won:
            if job is not None and attempt.fencing_token != job.lease_generation:
                found.append(Violation(2, f"attempt {attempt.id} published with a stale token"))
    for job in rows.values():
        if job.state == S.SUCCEEDED and not winners.get(job.id) and job.attempt_count:
            found.append(Violation(2, f"job {job.id} succeeded without a winning attempt"))
    for artifact in _rows(connection, artifacts):
        if artifact.attempt_id is None:
            continue
        attempt = attempts.get(artifact.attempt_id)
        job = rows.get(artifact.job_id)
        if (
            attempt is None or job is None or attempt.outcome != "succeeded"
            or attempt.fencing_token != job.lease_generation
        ):
            found.append(Violation(2, f"artifact {artifact.id} came from a stale attempt"))
    return found


def _key_owner(key: Any) -> str | None:
    if not isinstance(key, str) or not key.startswith("w/"):
        return None
    return key.split("/", 2)[1] if key.count("/") >= 2 else None


def cross_tenant(connection: Connection) -> list[Violation]:
    found: list[Violation] = []
    owner = {row.id: row.workspace_id for row in connection.execute(
        sa.select(jobs.c.id, jobs.c.workspace_id)
    )}
    for attempt in _rows(connection, job_attempts):
        if attempt.job_id in owner and owner[attempt.job_id] != attempt.workspace_id:
            found.append(Violation(3, f"attempt {attempt.id} sits in another workspace's job"))
    for link in _rows(connection, job_dependencies):
        pair = {owner.get(link.job_id), owner.get(link.depends_on), link.workspace_id}
        if len(pair - {None}) > 1:
            found.append(Violation(3, f"job {link.job_id} depends on another workspace's job"))
    for job in connection.execute(sa.select(jobs.c.id, jobs.c.workspace_id, jobs.c.parent_id)):
        if job.parent_id in owner and owner[job.parent_id] != job.workspace_id:
            found.append(Violation(3, f"job {job.id} has a parent in another workspace"))
    for artifact in _rows(connection, artifacts):
        if artifact.job_id in owner and owner[artifact.job_id] != artifact.workspace_id:
            found.append(Violation(3, f"artifact {artifact.id} came from another workspace's job"))
        keys = artifact.keys if isinstance(artifact.keys, list) else [artifact.keys]
        for key in keys:
            if _key_owner(key) not in (None, artifact.workspace_id) or not isinstance(key, str):
                found.append(Violation(3, f"artifact {artifact.id} names another workspace's key"))
    for asset in _rows(connection, assets):
        if _key_owner(asset.original_key) != asset.workspace_id:
            found.append(Violation(3, f"asset {asset.id} is stored under another workspace"))
    return found


def quota(connection: Connection) -> list[Violation]:
    found: list[Violation] = []
    active: Counter[str] = Counter()
    for row in connection.execute(
        sa.select(storage_reservations.c.workspace_id, storage_reservations.c.bytes).where(
            storage_reservations.c.state == "active"
        )
    ):
        active[row.workspace_id] += int(row.bytes)
    for row in _rows(connection, quota_state):
        used = int(row.committed_bytes) + int(row.reserved_bytes)
        if used > int(row.limit_bytes) and row.state != "over_quota_read_only":
            found.append(Violation(4, f"{row.workspace_id} uses {used} of {row.limit_bytes} bytes"))
        if int(row.reserved_bytes) != active[row.workspace_id]:
            found.append(Violation(
                4, f"{row.workspace_id} reserves {row.reserved_bytes} bytes but its active "
                f"reservations hold {active[row.workspace_id]}"
            ))
    return found


def artifacts_match(connection: Connection, store: Any = None) -> list[Violation]:
    found: list[Violation] = []
    for artifact in _rows(connection, artifacts):
        if artifact.size_bytes is None or not artifact.checksum:
            found.append(Violation(5, f"artifact {artifact.id} has no size or checksum"))
            continue
        try:
            provenance.check_output(artifact)
        except provenance.ProvenanceInvalid as problem:
            found.append(Violation(5, f"artifact {artifact.id}: {problem}"))
        keys = artifact.keys if isinstance(artifact.keys, list) else [artifact.keys]
        prefix = f"w/{artifact.workspace_id}/{artifact.kind}/{artifact.input_hash}/attempts/"
        if artifact.attempt_id is not None:
            prefix += f"{artifact.attempt_id}/"
        for key in keys:
            if not isinstance(key, str) or not key.startswith(prefix):
                found.append(Violation(5, f"artifact {artifact.id} key {key!r} isn't its inputs'"))
            elif store is not None and not store.verify(
                key, int(artifact.size_bytes), artifact.checksum
            ):
                found.append(Violation(5, f"artifact {artifact.id}'s stored object doesn't match"))
    return found


def duplicates(connection: Connection) -> list[Violation]:
    found: list[Violation] = []
    live = Counter(
        (row.workspace_id, row.type, row.idempotency_key)
        for row in connection.execute(
            sa.select(jobs.c.workspace_id, jobs.c.type, jobs.c.idempotency_key).where(
                jobs.c.idempotency_key.is_not(None),
                jobs.c.state.notin_([str(state) for state in TERMINAL]),
            )
        )
    )
    for key, count in live.items():
        if count > 1:
            found.append(Violation(6, f"{count} live jobs share the idempotency key {key}"))
    made = Counter((row.workspace_id, row.kind, row.input_hash) for row in _rows(
        connection, artifacts
    ))
    for key, count in made.items():
        if count > 1:
            found.append(Violation(6, f"{count} artifacts for the same inputs {key}"))
    entries = Counter(
        (row.workspace_id, row.ref, row.amount > 0)
        for row in connection.execute(
            sa.select(usage_ledger.c.workspace_id, usage_ledger.c.ref, usage_ledger.c.amount)
            .where(usage_ledger.c.kind == "storage_bytes", usage_ledger.c.ref.is_not(None))
        )
    )
    for (workspace, ref, grew), count in entries.items():
        if count > 1:
            sign = "commits" if grew else "releases"
            found.append(Violation(6, f"{workspace} ledger {sign} {ref} {count} times"))
    committed = {
        row.id for row in connection.execute(
            sa.select(storage_reservations.c.id).where(storage_reservations.c.state == "committed")
        )
    }
    ledgered = {ref for (_, ref, grew) in entries if grew}
    for reservation_id in committed - ledgered:
        found.append(Violation(6, f"committed reservation {reservation_id} has no ledger entry"))
    return found


def _storage_allowed(plan_id: str, version: int | None) -> int | None:
    try:
        return plan_catalogue.plan_for(plan_id, version).storage_bytes
    except plan_catalogue.UnknownPlan:
        return None


def entitlements(connection: Connection) -> list[Violation]:
    found: list[Violation] = []
    now = persistence.db_now(connection)
    overrides: dict[str, list[str]] = defaultdict(list)
    for row in connection.execute(
        sa.select(entitlement_overrides.c.workspace_id, entitlement_overrides.c.plan_id).where(
            entitlement_overrides.c.revoked_at.is_(None), entitlement_overrides.c.expires_at > now
        )
    ):
        overrides[row.workspace_id].append(row.plan_id)
    running: dict[tuple[str, str], int] = Counter()
    for head in _rows(connection, fair_heads):
        running[(head.workspace_id, head.lane)] += int(head.running_count)
    for row in _rows(connection, quota_state):
        plan_bytes = _storage_allowed(row.plan_id, row.plan_version)
        if plan_bytes is None:
            found.append(Violation(7, f"{row.workspace_id} is on an unknown plan {row.plan_id}"))
            continue
        allowed = max([plan_bytes, *(
            _storage_allowed(plan_id, None) or 0 for plan_id in overrides[row.workspace_id]
        )])
        if int(row.limit_bytes) > allowed:
            found.append(Violation(
                7, f"{row.workspace_id} may store {row.limit_bytes} bytes; its plan gives {allowed}"
            ))
        plan = plan_catalogue.plan_for(row.plan_id, row.plan_version)
        granted = [plan, *(plan_catalogue.plan_for(p) for p in overrides[row.workspace_id])]
        for lane in ("interactive", "standard"):
            cap = max(int(item.concurrency.get(lane, 0)) for item in granted)
            if running[(row.workspace_id, lane)] > cap:
                found.append(Violation(
                    7, f"{row.workspace_id} runs {running[(row.workspace_id, lane)]} {lane} "
                    f"jobs; its plan allows {cap}"
                ))
    return found


def corrupt_state(connection: Connection) -> list[Violation]:
    found = [
        Violation(9, f"fair-share head {key} disagrees with the jobs table")
        for key in upkeep.head_suspects(connection)
    ]
    live = {
        row.job_id for row in connection.execute(
            sa.select(job_attempts.c.job_id).where(job_attempts.c.outcome.is_(None))
        )
    }
    for job in connection.execute(sa.select(jobs.c.id, jobs.c.state, jobs.c.finished_at)):
        if S(job.state) in TERMINAL:
            if job.id in live:
                found.append(Violation(9, f"{job.state} job {job.id} still has a live attempt"))
            if job.finished_at is None:
                found.append(Violation(9, f"{job.state} job {job.id} has no finish time"))
    for head in _rows(connection, fair_heads):
        if head.queued_count < 0 or head.running_count < 0 or head.queued_est_s < -1e-6:
            found.append(Violation(9, f"head {head.workspace_id}/{head.lane} counts below zero"))
    return found


def check(
    connection: Connection, *, accepted: Iterable[str] = (), store: Any = None
) -> list[Violation]:
    """Every violation of the database-checkable invariants, in invariant order."""
    return [
        *lost_jobs(connection, accepted),
        *stale_publish(connection),
        *cross_tenant(connection),
        *quota(connection),
        *artifacts_match(connection, store),
        *duplicates(connection),
        *entitlements(connection),
        *corrupt_state(connection),
    ]


def assert_clean(engine: Engine, *, accepted: Iterable[str] = (), store: Any = None) -> None:
    """Raise `InvariantBroken` listing every violation; for the end of a test or a run."""
    with persistence.transaction(engine) as connection:
        found = check(connection, accepted=accepted, store=store)
    if found:
        raise InvariantBroken(found)


__all__ = ["NAMES", "NOT_CHECKED", "InvariantBroken", "Violation", "assert_clean", "check"]
