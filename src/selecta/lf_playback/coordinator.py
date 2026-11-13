"""Fail-closed local-first speaker handoff with durable, fenced state transitions.

The committed speaker is *not* a cloud lease. We never promote a destination
until the old local engine confirmed its physical output is silent and fenced.
"""

from __future__ import annotations

import sqlite3
import time
from typing import Callable

from .contracts import (
    EnginePort,
    Scope,
    TransferRejected,
    TransferRequest,
    TransferSnapshot,
    TransferStage,
)
from .ledger import SQLiteOwnershipLedger, encode_request


class TransferCoordinator:
    def __init__(self, ledger: SQLiteOwnershipLedger, engine: EnginePort,
                 *, clock: Callable[[], float] = time.time) -> None:
        self.ledger = ledger
        self.engine = engine
        self.clock = clock

    def adopt_verified_owner(self, scope: Scope, device_id: str, generation: int) -> None:
        """One-time migration with physical proof; never import cloud lease ownership.

        Only used when no scope row exists. The engine must attest its audible
        output and durable fence. This is NOT an unverified bootstrapping API.
        """
        scope.validate()
        if not device_id or generation <= 0:
            raise TransferRejected("invalid_owner", "Device and positive generation required")
        with self.ledger.transaction() as db:
            if self.ledger.owner(db, scope):
                raise TransferRejected("already_initialized", "Ownership already established")
            state = self.engine.observe(device_id, scope)
            if (not state.reachable or state.audible is not True
                    or state.owned_generation != generation
                    or state.fenced_generation is None
                    or state.fenced_generation != generation):
                raise TransferRejected("unverified_owner", "Local audible ownership not proven")
            db.execute("INSERT INTO ownership VALUES (?,?,?,?,?)",
                       (scope.workspace_id, scope.zone_key, generation, device_id, "audible"))

    def initialize_silent(self, scope: Scope, device_id: str) -> None:
        """Initial provisioning, only after operator confirms no older speaker exists.

        This explicitly handles first installation, not a cloud-lease expiry.
        """
        scope.validate()
        with self.ledger.transaction() as db:
            if self.ledger.owner(db, scope):
                raise TransferRejected("already_initialized", "Ownership already established")
            state = self.engine.observe(device_id, scope)
            if (not state.reachable or state.audible is not False
                    or state.fenced_generation is None):
                raise TransferRejected("unverified_silence", "Local output silence not proven")
            db.execute("INSERT INTO ownership VALUES (?,?,?,?,?)",
                       (scope.workspace_id, scope.zone_key, state.fenced_generation,
                        None, "silent"))

    def begin(self, request: TransferRequest) -> TransferSnapshot:
        """Exactly one active operation per workspace/zone; idempotent across tabs."""
        raw = encode_request(request)
        with self.ledger.transaction() as db:
            previous = self.ledger.attempt(db, request.operation_id)
            if previous:
                if previous["request_json"] != raw:
                    raise TransferRejected("idempotency_conflict", "Operation ID reused for a change")
                return self.ledger.snapshot(db, previous)
            request.validate(self.clock())
            existing = db.execute(
                "SELECT * FROM transfers WHERE workspace=? AND zone=? AND idempotency_key=?",
                (request.scope.workspace_id, request.scope.zone_key, request.idempotency_key),
            ).fetchone()
            if existing:
                if existing["request_json"] != raw:
                    raise TransferRejected("idempotency_conflict", "Key reused for another request")
                return self.ledger.snapshot(db, existing)
            owner = self.ledger.owner(db, request.scope)
            if owner is None:
                raise TransferRejected("uninitialized", "Explicit local owner/silence setup required")
            if owner["generation"] != request.expected_generation:
                raise TransferRejected("stale_generation", "Expected generation no longer current")
            if owner["device"] == request.target_device_id:
                raise TransferRejected("already_owner", "Destination already owns the output")
            try:
                db.execute(
                    """INSERT INTO transfers
                       (operation_id,workspace,zone,idempotency_key,request_json,
                        source_device,generation,stage)
                       VALUES (?,?,?,?,?,?,?,?)""",
                    (request.operation_id, request.scope.workspace_id, request.scope.zone_key,
                     request.idempotency_key, raw, owner["device"],
                     owner["generation"] + 1, TransferStage.REQUESTED.value),
                )
            except sqlite3.IntegrityError as exc:
                raise TransferRejected("transfer_busy", "Another takeover is in progress") from exc
            return self.ledger.snapshot(db, self.ledger.attempt(db, request.operation_id))

    def execute(self, request: TransferRequest) -> TransferSnapshot:
        """Advance every safe step; retry after crash using the same operation ID."""
        snapshot = self.begin(request)
        for _ in range(4):
            if snapshot.stage in (TransferStage.STARTED, TransferStage.ABORTED,
                                  TransferStage.BLOCKED):
                break
            snapshot = self.advance(request.operation_id)
        return snapshot

    def advance(self, operation_id: str) -> TransferSnapshot:
        """One linearized step. Local engine operations must have bounded timeouts.

        A process crash after a physical side effect but before commit rolls back
        the journal transaction; the next caller repeats that *idempotent* side
        effect, and reconciles physical/fenced state before advancing.
        """
        with self.ledger.transaction() as db:
            row = self.ledger.attempt(db, operation_id)
            if row is None:
                raise TransferRejected("unknown_operation", "No such transfer")
            snapshot = self.ledger.snapshot(db, row)
            stage = snapshot.stage
            if stage in (TransferStage.STARTED, TransferStage.ABORTED,
                         TransferStage.BLOCKED):
                return snapshot
            request = snapshot.request
            generation = snapshot.generation
            if self.clock() >= request.expires_at:
                self._fail(db, snapshot, "deadline_exceeded")
            elif stage is TransferStage.REQUESTED:
                self._prepare(db, snapshot)
            elif stage is TransferStage.PREPARED:
                self._release(db, snapshot)
            elif stage is TransferStage.RELEASED:
                self._acquire(db, snapshot)
            elif stage is TransferStage.ACQUIRED:
                self._start(db, snapshot)
            else:
                raise AssertionError(stage)
            return self.ledger.snapshot(db, self.ledger.attempt(db, operation_id))

    def _fail(self, db: sqlite3.Connection, snapshot: TransferSnapshot, code: str,
              *, uncertain: bool = False) -> None:
        # No automatic return to the old speaker once it was physically released.
        after_release = snapshot.stage in (TransferStage.RELEASED, TransferStage.ACQUIRED)
        stage = TransferStage.BLOCKED if after_release or uncertain else TransferStage.ABORTED
        self.ledger.mutate(db, snapshot.request.operation_id, stage, failure=code)

    def _prepare(self, db: sqlite3.Connection, s: TransferSnapshot) -> None:
        request = s.request
        try:
            observation = self.engine.observe(request.target_device_id, request.scope)
            if not observation.reachable or observation.audible is not False:
                self._fail(db, s, "destination_not_proven_silent", uncertain=True)
                return
            report = self.engine.preflight(request)
            failures = report.missing(request, self.clock())
            if failures:
                self._fail(db, s, "preflight:" + ",".join(failures))
                return
            token = self.engine.prepare_silent(request, s.generation)
            observed = self.engine.observe(request.target_device_id, request.scope)
            if (not token or not observed.reachable or observed.audible is not False):
                self._fail(db, s, "silent_preparation_unverified", uncertain=True)
                return
            self.ledger.mutate(db, request.operation_id, TransferStage.PREPARED, token=token)
        except (OSError, TimeoutError, RuntimeError, TransferRejected) as exc:
            self._pre_release_failure(db, s, "prepare_failed:" + type(exc).__name__)

    def _pre_release_failure(self, db: sqlite3.Connection, s: TransferSnapshot,
                             reason: str) -> None:
        try:
            observed = self.engine.observe(s.request.target_device_id, s.request.scope)
        except (OSError, TimeoutError, RuntimeError, TransferRejected):
            observed = None
        self._fail(db, s, reason, uncertain=(observed is None or
                   not observed.reachable or observed.audible is not False))

    def _release(self, db: sqlite3.Connection, s: TransferSnapshot) -> None:
        source = s.source_device_id
        if source is not None:
            try:
                self.engine.stop_and_confirm(source, s.request, s.generation)
            except (OSError, TimeoutError, RuntimeError, TransferRejected):
                # Lost acknowledgement does not mean the source is still audible.
                # Inspect the independent physical output and durable fence.
                pass
            try:
                observed = self.engine.observe(source, s.request.scope)
            except (OSError, TimeoutError, RuntimeError, TransferRejected):
                observed = None
            # Acknowledgements are insufficient without measured silence AND a
            # persisted local fence preventing the old generation restarting.
            confirmed = (observed is not None and observed.reachable
                         and observed.audible is False
                         and observed.fenced_generation is not None
                         and observed.fenced_generation == s.generation
                         and observed.operation_id == s.request.operation_id)
            if not confirmed:
                # If source remains audibly playing, preserve it; if its physical
                # state is unknown, block rather than assert a safe migration.
                uncertain = (observed is None or not observed.reachable
                             or observed.audible is not True)
                self._fail(db, s, "source_release_unconfirmed", uncertain=uncertain)
                return
            # A lost stop ack is recoverable only with local physical+fence proof.
        self.ledger.owner_state(db, s.request.scope, s.generation, None, "silent")
        self.ledger.mutate(db, s.request.operation_id, TransferStage.RELEASED)

    def _acquire(self, db: sqlite3.Connection, s: TransferSnapshot) -> None:
        try:
            report = self.engine.preflight(s.request)
            if report.missing(s.request, self.clock()):
                self._fail(db, s, "preflight_changed_after_release")
                return
            if not self.engine.acquire_silent(s.request, s.generation,
                                             s.prepared_token or ""):
                self._fail(db, s, "silent_acquire_refused")
                return
            observed = self.engine.observe(s.request.target_device_id, s.request.scope)
            if (not observed.reachable or observed.audible is not False
                    or observed.owned_generation != s.generation
                    or observed.fenced_generation is None
                    or observed.fenced_generation != s.generation
                    or observed.operation_id != s.request.operation_id):
                self._fail(db, s, "silent_acquire_unverified")
                return
        except (OSError, TimeoutError, RuntimeError, TransferRejected) as exc:
            self._fail(db, s, "acquire_failed:" + type(exc).__name__)
            return
        self.ledger.owner_state(db, s.request.scope, s.generation,
                                s.request.target_device_id, "silent")
        self.ledger.mutate(db, s.request.operation_id, TransferStage.ACQUIRED)

    def _start(self, db: sqlite3.Connection, s: TransferSnapshot) -> None:
        try:
            self.engine.start_and_confirm(s.request, s.generation)
            observed = self.engine.observe(s.request.target_device_id, s.request.scope)
            if (not observed.reachable or observed.audible is not True
                    or observed.owned_generation != s.generation
                    or observed.fenced_generation != s.generation
                    or observed.operation_id != s.request.operation_id):
                self._fail(db, s, "start_unverified")
                return
        except (OSError, TimeoutError, RuntimeError, TransferRejected) as exc:
            # Failure after output starts but before acknowledgement is not
            # retried as a second start if we cannot inspect physical truth.
            try:
                observed = self.engine.observe(s.request.target_device_id,
                                               s.request.scope)
            except (OSError, TimeoutError, RuntimeError, TransferRejected):
                observed = None
            if (observed is None or not observed.reachable
                    or observed.audible is not True
                    or observed.owned_generation != s.generation
                    or observed.fenced_generation != s.generation
                    or observed.operation_id != s.request.operation_id):
                self._fail(db, s, "start_failed:" + type(exc).__name__)
                return
        self.ledger.owner_state(db, s.request.scope, s.generation,
                                s.request.target_device_id, "audible")
        self.ledger.mutate(db, s.request.operation_id, TransferStage.STARTED)

    def manual_isolation(self, operation_id: str, evidence_token: str) -> TransferSnapshot:
        """Physical fail-safe override, *not* a force-takeover cloud button.

        Implementations must independently verify an on-site hardware isolation
        (including prevention of auto-restart). An unauthenticated assertion or
        stale heartbeat is never isolation evidence.
        """
        if not evidence_token or len(evidence_token) > 256:
            raise TransferRejected("invalid_evidence", "Trusted isolation evidence required")
        with self.ledger.transaction() as db:
            row = self.ledger.attempt(db, operation_id)
            if row is None:
                raise TransferRejected("unknown_operation", "No such transfer")
            s = self.ledger.snapshot(db, row)
            if s.stage not in (TransferStage.PREPARED, TransferStage.BLOCKED):
                raise TransferRejected("invalid_stage", "Manual isolation is not applicable")
            if s.source_device_id is None:
                raise TransferRejected("no_source", "There is no previous speaker")
            if not s.prepared_token:
                raise TransferRejected("not_prepared", "Destination was never prepared silently")
            try:
                target = self.engine.observe(s.request.target_device_id, s.request.scope)
                preflight = self.engine.preflight(s.request)
            except Exception as exc:
                raise TransferRejected("unverified_destination", "Cannot verify target") from exc
            if (not target.reachable or target.audible is not False
                    or preflight.missing(s.request, self.clock())):
                raise TransferRejected("unverified_destination", "Target is not safe to acquire")
            owner = self.ledger.owner(db, s.request.scope)
            if owner["device"] != s.source_device_id or owner["generation"] + 1 != s.generation:
                raise TransferRejected("stale_generation", "Ownership has changed")
            if self.clock() >= s.request.expires_at:
                raise TransferRejected("expired", "Start a fresh recovery operation")
            if not self.engine.manual_isolate(s.source_device_id, s.request,
                                               s.generation, evidence_token):
                raise TransferRejected("unverified_isolation", "Physical isolation not established")
            self.ledger.owner_state(db, s.request.scope, s.generation, None, "silent")
            self.ledger.mutate(db, operation_id, TransferStage.RELEASED)
            return self.ledger.snapshot(db, self.ledger.attempt(db, operation_id))
