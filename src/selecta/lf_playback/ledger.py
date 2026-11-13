"""SQLite transaction/compare-and-swap ledger for playback ownership.

Single authoritative ledger per workspace/zone: BEGIN IMMEDIATE serialises two
requests from tabs or processes. The store is metadata-only and contains no
media paths, waveforms, file fingerprints or other reconstructible audio.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Iterator

from .contracts import Scope, TransferRejected, TransferRequest, TransferSnapshot, TransferStage

STAGES_IN_FLIGHT = "'requested','prepared','released','acquired','blocked'"


def encode_request(request: TransferRequest) -> str:
    return json.dumps(asdict(request), sort_keys=True, separators=(",", ":"))


def decode_request(raw: str) -> TransferRequest:
    data = json.loads(raw)
    data["scope"] = Scope(**data["scope"])
    data["recording_refs"] = tuple(data["recording_refs"])
    data["transition_refs"] = tuple(data["transition_refs"])
    return TransferRequest(**data)


class SQLiteOwnershipLedger:
    """Durable coordinator journal; one database must serve *all* controllers.

    In production the equivalent authoritative transactional store can replace
    this adapter, but must retain CAS, unique active transfer and serialization.
    Holding the write transaction during bounded engine I/O avoids duplicate
    release/acquire side effects across independently running controllers.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        with self.transaction() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS ownership (
                    workspace TEXT NOT NULL, zone TEXT NOT NULL,
                    generation INTEGER NOT NULL CHECK (generation >= 0),
                    device TEXT, state TEXT NOT NULL,
                    PRIMARY KEY (workspace, zone)
                );
                CREATE TABLE IF NOT EXISTS transfers (
                    operation_id TEXT PRIMARY KEY,
                    workspace TEXT NOT NULL, zone TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    request_json TEXT NOT NULL,
                    source_device TEXT,
                    generation INTEGER NOT NULL,
                    stage TEXT NOT NULL,
                    prepared_token TEXT,
                    failure_code TEXT,
                    UNIQUE(workspace, zone, idempotency_key)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS one_inflight_transfer
                  ON transfers(workspace, zone)
                  WHERE stage IN ('requested','prepared','released','acquired','blocked');
            """)

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA busy_timeout=10000")
            db.execute("BEGIN IMMEDIATE")
            yield db
            if db.in_transaction:
                db.commit()
        except BaseException:
            if db.in_transaction:
                db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def owner(db: sqlite3.Connection, scope: Scope) -> sqlite3.Row | None:
        return db.execute(
            "SELECT * FROM ownership WHERE workspace=? AND zone=?",
            (scope.workspace_id, scope.zone_key),
        ).fetchone()

    @staticmethod
    def attempt(db: sqlite3.Connection, operation_id: str) -> sqlite3.Row | None:
        return db.execute("SELECT * FROM transfers WHERE operation_id=?", (operation_id,)).fetchone()

    @staticmethod
    def snapshot(db: sqlite3.Connection, row: sqlite3.Row) -> TransferSnapshot:
        request = decode_request(row["request_json"])
        owner = SQLiteOwnershipLedger.owner(db, request.scope)
        return TransferSnapshot(
            request=request,
            stage=TransferStage(row["stage"]),
            generation=row["generation"],
            source_device_id=row["source_device"],
            active_device_id=owner["device"] if owner else None,
            prepared_token=row["prepared_token"],
            failure_code=row["failure_code"],
        )

    def get(self, operation_id: str) -> TransferSnapshot | None:
        with self.transaction() as db:
            row = self.attempt(db, operation_id)
            return self.snapshot(db, row) if row else None

    def current_owner(self, scope: Scope) -> tuple[str | None, int, str] | None:
        with self.transaction() as db:
            row = self.owner(db, scope)
            if row is None:
                return None
            return row["device"], row["generation"], row["state"]

    @staticmethod
    def mutate(db: sqlite3.Connection, operation_id: str, stage: TransferStage,
               *, token: str | None = None, failure: str | None = None) -> None:
        db.execute("""UPDATE transfers SET stage=?,
                      prepared_token=COALESCE(?, prepared_token), failure_code=?
                      WHERE operation_id=?""", (stage.value, token, failure, operation_id))

    @staticmethod
    def owner_state(db: sqlite3.Connection, scope: Scope, generation: int,
                    device: str | None, state: str) -> None:
        updated = db.execute(
            "UPDATE ownership SET generation=?, device=?, state=? WHERE workspace=? AND zone=?",
            (generation, device, state, scope.workspace_id, scope.zone_key),
        )
        if updated.rowcount != 1:
            raise TransferRejected("ownership_lost", "Playback owner row changed")
