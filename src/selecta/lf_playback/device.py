"""Device-local persistent fence around one *physical* audio output.

Local engines must place this guard between Agent 07 authenticated commands and
Agent 01/09 DSP/output drivers. Never expose its methods as unauthenticated HTTP.
The journal must be on persistent local storage, not in the cloud or an audio cache.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Protocol

from .contracts import OutputObservation, Preflight, Scope, TransferRejected, TransferRequest
from .ledger import SQLiteOwnershipLedger


class PhysicalAudioOutput(Protocol):
    """Driver-specific operations must check actual hardware/OS audio output."""

    def is_audible(self) -> bool | None: ...

    def preflight(self, request: TransferRequest) -> Preflight: ...

    def prepare_silent(self, request: TransferRequest) -> str: ...

    def mute_and_stop(self) -> None: ...

    def start_prepared(self, token: str) -> None: ...

    def verify_hardware_isolation(self, evidence_token: str) -> bool: ...


class FencedLocalOutput:
    """Fenced, idempotent local output authority for one physical output.

    Each DB must be exclusive to one physical audio output. A shared OS lock and
    actual hardware probe are required by PhysicalAudioOutput's implementation;
    the guard cannot by itself stop a second, unmanaged application playing.
    """

    def __init__(self, path: str | Path, device_id: str, audio: PhysicalAudioOutput) -> None:
        if not device_id:
            raise ValueError("device_id required")
        self.device_id = device_id
        self.audio = audio
        self.ledger = SQLiteOwnershipLedger(path)
        with self.ledger.transaction() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS local_output_fence (
                id INTEGER PRIMARY KEY CHECK (id=1), workspace TEXT, zone TEXT,
                floor INTEGER NOT NULL DEFAULT 0, generation INTEGER,
                operation_id TEXT, token TEXT, state TEXT NOT NULL
            )""")
            db.execute("INSERT OR IGNORE INTO local_output_fence(id, floor, state) VALUES (1,0,'idle')")

    @staticmethod
    def _row(db: sqlite3.Connection) -> sqlite3.Row:
        return db.execute("SELECT * FROM local_output_fence WHERE id=1").fetchone()

    @staticmethod
    def _scope_matches(row: sqlite3.Row, scope: Scope) -> bool:
        return row["workspace"] == scope.workspace_id and row["zone"] == scope.zone_key

    def inspect(self, scope: Scope) -> OutputObservation:
        with self.ledger.transaction() as db:
            row = self._row(db)
            if row["workspace"] is not None and not self._scope_matches(row, scope):
                # Never disclose another tenant's output or allow one to operate it.
                return OutputObservation(True, None, None, None)
            return OutputObservation(True, self.audio.is_audible(),
                                     row["generation"], row["floor"], row["operation_id"])

    def adopt_active(self, scope: Scope, generation: int) -> None:
        """One-time local migration requires a physically confirmed playing output."""
        scope.validate()
        if generation < 1:
            raise TransferRejected("invalid_generation", "Positive generation required")
        with self.ledger.transaction() as db:
            row = self._row(db)
            if row["state"] != "idle" or self.audio.is_audible() is not True:
                raise TransferRejected("unverified_owner", "Output cannot be adopted")
            db.execute("""UPDATE local_output_fence SET workspace=?, zone=?, floor=?,
                         generation=?, state='audible' WHERE id=1""",
                       (scope.workspace_id, scope.zone_key, generation, generation))

    def preflight(self, request: TransferRequest) -> Preflight:
        self._require_target(request)
        with self.ledger.transaction() as db:
            row = self._row(db)
            self._require_scope(row, request.scope)
            if row["generation"] is not None and row["state"] == "audible":
                raise TransferRejected("output_busy", "Physical output is already in use")
        return self.audio.preflight(request)

    def prepare_silent(self, request: TransferRequest, generation: int) -> str:
        self._require_target(request)
        with self.ledger.transaction() as db:
            row = self._row(db)
            self._require_scope(row, request.scope)
            if generation <= row["floor"]:
                raise TransferRejected("stale_generation", "Destination fence is newer")
            if (row["operation_id"] == request.operation_id and row["token"]
                    and row["state"] == "prepared"):
                return row["token"]
            if row["state"] not in ("idle", "silent"):
                raise TransferRejected("output_busy", "The output is not idle")
            if self.audio.is_audible() is not False:
                raise TransferRejected("unsafe_output", "Hardware silence is unknown")
            token = self.audio.prepare_silent(request)
            if not token or self.audio.is_audible() is not False:
                raise TransferRejected("unsafe_preparation", "Preparation was not silent")
            db.execute("""UPDATE local_output_fence SET workspace=?, zone=?,
                         operation_id=?, token=?, state='prepared' WHERE id=1""",
                       (request.scope.workspace_id, request.scope.zone_key,
                        request.operation_id, token))
            return token

    def stop_and_confirm(self, request: TransferRequest, generation: int) -> bool:
        """Fail closed unless source output is *measured* silent and fenced."""
        with self.ledger.transaction() as db:
            row = self._row(db)
            self._require_scope(row, request.scope)
            if row["floor"] >= generation:
                # A restored cloud backup can request an obsolete transfer.
                # Never acknowledge one whose fence belongs to a *newer* operation.
                return (row["floor"] == generation and row["generation"] is None
                        and row["operation_id"] == request.operation_id
                        and self.audio.is_audible() is False)
            if row["generation"] != generation - 1:
                raise TransferRejected("stale_generation", "Source generation changed")
            self.audio.mute_and_stop()
            if self.audio.is_audible() is not False:
                return False
            db.execute("""UPDATE local_output_fence SET floor=?, generation=NULL,
                         operation_id=?, token=NULL, state='silent' WHERE id=1""",
                       (generation, request.operation_id))
            return True

    def acquire_silent(self, request: TransferRequest, generation: int,
                       prepared_token: str) -> bool:
        self._require_target(request)
        with self.ledger.transaction() as db:
            row = self._row(db)
            self._require_scope(row, request.scope)
            if (row["generation"] == generation and row["operation_id"] == request.operation_id
                    and row["state"] in ("owned_silent", "audible")):
                return self.audio.is_audible() is False or row["state"] == "audible"
            if (generation <= row["floor"] or row["state"] != "prepared"
                    or row["operation_id"] != request.operation_id
                    or not prepared_token or row["token"] != prepared_token):
                raise TransferRejected("stale_or_unprepared", "Output is not prepared for acquisition")
            if self.audio.is_audible() is not False:
                return False
            db.execute("""UPDATE local_output_fence SET floor=?, generation=?,
                         state='owned_silent' WHERE id=1""", (generation, generation))
            return True

    def start_and_confirm(self, request: TransferRequest, generation: int) -> bool:
        self._require_target(request)
        with self.ledger.transaction() as db:
            row = self._row(db)
            self._require_scope(row, request.scope)
            if row["generation"] != generation or row["operation_id"] != request.operation_id:
                raise TransferRejected("stale_generation", "Operation lost physical ownership")
            if row["state"] == "audible":
                return self.audio.is_audible() is True
            if row["state"] != "owned_silent" or not row["token"]:
                raise TransferRejected("unprepared", "Cannot start before acquire")
            if self.audio.is_audible() is not False:
                raise TransferRejected("unsafe_output", "Output already audible before start")
            self.audio.start_prepared(row["token"])
            if self.audio.is_audible() is not True:
                return False
            db.execute("UPDATE local_output_fence SET state='audible' WHERE id=1")
            return True

    def manual_isolate(self, request: TransferRequest, generation: int,
                       evidence_token: str) -> bool:
        """Requires a locally verified *hardware* interlock, never a UI checkbox."""
        with self.ledger.transaction() as db:
            row = self._row(db)
            self._require_scope(row, request.scope)
            if (row["generation"] != generation - 1
                    or not self.audio.verify_hardware_isolation(evidence_token)):
                return False
            if self.audio.is_audible() is not False:
                return False
            db.execute("""UPDATE local_output_fence SET floor=?, generation=NULL,
                         operation_id=?, token=NULL, state='silent' WHERE id=1""",
                       (generation, request.operation_id))
            return True

    def _require_target(self, request: TransferRequest) -> None:
        if request.target_device_id != self.device_id:
            raise TransferRejected("wrong_device", "Command targets a different engine")

    @staticmethod
    def _require_scope(row: sqlite3.Row, scope: Scope) -> None:
        scope.validate()
        if row["workspace"] is not None and not FencedLocalOutput._scope_matches(row, scope):
            raise TransferRejected("wrong_workspace", "Output belongs to a different scope")
