"""Bounded SQLite command journal and metadata-only offline event reconciliation.

Cloud and each engine use separate database files. Neither an ACK nor queue delivery is
proof of playback; only a locally verified execution report can advance to 'applied'.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from .credentials import _db
from .protocol import (CommandEnvelope, ControlError, LocalScope, _id, _integer,
                       authorise_local)

STATES = frozenset({"created", "authorised", "queued", "delivered", "accepted",
                    "applied", "acknowledged", "rejected", "conflicted", "superseded", "expired"})
TERMINAL = frozenset({"acknowledged", "rejected", "conflicted", "superseded", "expired"})
NEXT = {
    "created": {"authorised"}, "authorised": {"queued"}, "queued": {"delivered"},
    "delivered": {"accepted"}, "accepted": {"applied"}, "applied": {"acknowledged"},
}
EVENT_FIELDS: dict[str, frozenset[str]] = {
    "command_result": frozenset({"operation_id", "status", "generation", "output_confirmed"}),
    "device_state": frozenset({"generation", "engine_state"}),
    "playback_observed": frozenset({"generation", "state", "song_index", "offset_ms"}),
    "configuration_applied": frozenset({"operation_id", "revision", "generation"}),
}


@dataclass(frozen=True)
class CommandRecord:
    operation_id: str
    workspace_id: str
    device_id: str
    state: str
    digest: str
    updated_at: float
    replayed: bool = False


@dataclass(frozen=True)
class Event:
    event_id: str
    workspace_id: str
    device_id: str
    device_generation: int
    sequence: int
    kind: str
    payload: dict[str, Any]
    recorded_at: float


def _event_payload(kind: str, raw: Mapping[str, Any]) -> dict[str, Any]:
    if kind not in EVENT_FIELDS or type(raw) is not dict or set(raw) != EVENT_FIELDS[kind]:
        raise ControlError("unsafe_event")
    p = dict(raw)
    if kind == "command_result":
        _id(p["operation_id"])
        if p["status"] not in ("accepted", "applied", "rejected", "conflicted", "expired"):
            raise ControlError("unsafe_event")
        if type(p["output_confirmed"]) is not bool:
            raise ControlError("unsafe_event")
    elif kind == "device_state":
        if p["engine_state"] not in ("ready", "degraded", "offline", "silent", "unknown"):
            raise ControlError("unsafe_event")
    elif kind == "playback_observed":
        if p["state"] not in ("playing", "paused", "stopped", "silent"):
            raise ControlError("unsafe_event")
        _integer(p["song_index"], maximum=2**31 - 1)
        _integer(p["offset_ms"], maximum=2**31 - 1)
    else:
        _id(p["operation_id"])
        _id(p["revision"])
    _integer(p["generation"])
    if len(json.dumps(p, separators=(",", ":"))) > 2048:
        raise ControlError("unsafe_event")
    return p


class ControlJournal:
    def __init__(self, path: str | Path, *, limit: int = 4096):
        if type(limit) is not int or limit < 1:
            raise ValueError("limit must be positive")
        self.path = path
        self.limit = limit
        with _db(path) as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS lf_commands (
                    workspace TEXT NOT NULL, device TEXT NOT NULL, operation TEXT NOT NULL,
                    idem_key TEXT NOT NULL, digest TEXT NOT NULL, envelope TEXT NOT NULL,
                    state TEXT NOT NULL, created REAL NOT NULL, expires REAL NOT NULL,
                    updated REAL NOT NULL,
                    PRIMARY KEY(workspace, device, operation),
                    UNIQUE(workspace, device, idem_key)
                );
                CREATE TABLE IF NOT EXISTS lf_command_history (
                    workspace TEXT NOT NULL, device TEXT NOT NULL, operation TEXT NOT NULL,
                    state TEXT NOT NULL, at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS lf_command_fences (
                    workspace TEXT NOT NULL, device TEXT NOT NULL,
                    last_sequence INTEGER NOT NULL, PRIMARY KEY(workspace, device)
                );
                CREATE TABLE IF NOT EXISTS lf_events (
                    workspace TEXT NOT NULL, device TEXT NOT NULL, event_id TEXT NOT NULL,
                    generation INTEGER NOT NULL, sequence INTEGER NOT NULL,
                    kind TEXT NOT NULL, payload TEXT NOT NULL, recorded REAL NOT NULL,
                    acknowledged REAL,
                    PRIMARY KEY(workspace, device, event_id),
                    UNIQUE(workspace, device, generation, sequence)
                );
                CREATE TABLE IF NOT EXISTS lf_event_fences (
                    workspace TEXT NOT NULL, device TEXT NOT NULL, generation INTEGER NOT NULL,
                    last_sequence INTEGER NOT NULL,
                    PRIMARY KEY(workspace, device, generation)
                );
                CREATE TABLE IF NOT EXISTS lf_inbox (
                    workspace TEXT NOT NULL, device TEXT NOT NULL, generation INTEGER NOT NULL,
                    sequence INTEGER NOT NULL, event_id TEXT NOT NULL, kind TEXT NOT NULL,
                    payload TEXT NOT NULL, applied INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(workspace, device, generation, sequence),
                    UNIQUE(workspace, device, event_id)
                );
                CREATE TABLE IF NOT EXISTS lf_inbox_fences (
                    workspace TEXT NOT NULL, device TEXT NOT NULL, generation INTEGER NOT NULL,
                    applied_sequence INTEGER NOT NULL,
                    PRIMARY KEY(workspace, device, generation)
                );
            """)

    def envelope(self, workspace: str, device: str, operation: str) -> CommandEnvelope | None:
        with _db(self.path) as db:
            row = db.execute("SELECT envelope FROM lf_commands WHERE workspace=? AND device=? "
                             "AND operation=?", (workspace, device, operation)).fetchone()
        return CommandEnvelope.parse(json.loads(row[0])) if row else None

    def get(self, workspace: str, device: str, operation: str) -> CommandRecord | None:
        with _db(self.path) as db:
            row = db.execute("SELECT * FROM lf_commands WHERE workspace=? AND device=? AND operation=?",
                             (workspace, device, operation)).fetchone()
        if not row:
            return None
        return CommandRecord(row["operation"], row["workspace"], row["device"],
                             row["state"], row["digest"], row["updated"])

    def _insert(self, db: sqlite3.Connection, env: CommandEnvelope,
                state: str, now: float) -> CommandRecord:
        existing = db.execute("SELECT * FROM lf_commands WHERE workspace=? AND device=? "
                              "AND (operation=? OR idem_key=?)",
                              (env.workspace_id, env.target_device_id, env.operation_id,
                               env.idempotency_key)).fetchone()
        if existing:
            if existing["digest"] != env.digest or existing["operation"] != env.operation_id:
                raise ControlError("idempotency_conflict")
            return CommandRecord(env.operation_id, env.workspace_id, env.target_device_id,
                                 existing["state"], env.digest, existing["updated"], True)
        count = db.execute("SELECT count(*) FROM lf_commands WHERE workspace=? AND device=? "
                           "AND state NOT IN ('acknowledged','rejected','conflicted','superseded','expired')",
                           (env.workspace_id, env.target_device_id)).fetchone()[0]
        if count >= self.limit:
            raise ControlError("journal_full")
        db.execute("INSERT INTO lf_commands VALUES(?,?,?,?,?,?,?,?,?,?)",
                   (env.workspace_id, env.target_device_id, env.operation_id,
                    env.idempotency_key, env.digest, env.canonical().decode("ascii"),
                    state, env.created_at, env.expires_at, now))
        db.execute("INSERT INTO lf_command_history VALUES(?,?,?,?,?)",
                   (env.workspace_id, env.target_device_id, env.operation_id, state, now))
        return CommandRecord(env.operation_id, env.workspace_id, env.target_device_id,
                             state, env.digest, now)

    def create_cloud(self, env: CommandEnvelope, *, now: float) -> CommandRecord:
        CommandEnvelope.parse(json.loads(env.canonical()), now=now)
        with _db(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            record = self._insert(db, env, "created", now)
            db.commit()
            return record

    def move_cloud(self, workspace: str, device: str, operation: str,
                   state: str, *, now: float, local_proof: bool = False) -> CommandRecord:
        if state not in STATES:
            raise ControlError("invalid_state")
        with _db(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM lf_commands WHERE workspace=? AND device=? AND operation=?",
                             (workspace, device, operation)).fetchone()
            if row is None:
                raise ControlError("unknown_operation")
            old = row["state"]
            if old == state:
                return CommandRecord(operation, workspace, device, old, row["digest"], row["updated"])
            if old in TERMINAL or (state not in NEXT.get(old, set()) and state not in
                                   {"rejected", "conflicted", "superseded", "expired"}):
                raise ControlError("invalid_transition")
            if state == "applied" and not local_proof:
                raise ControlError("local_proof_required")
            if state == "acknowledged" and not local_proof:
                raise ControlError("local_proof_required")
            db.execute("UPDATE lf_commands SET state=?, updated=? WHERE workspace=? AND device=? AND operation=?",
                       (state, now, workspace, device, operation))
            db.execute("INSERT INTO lf_command_history VALUES(?,?,?,?,?)",
                       (workspace, device, operation, state, now))
            db.commit()
            return CommandRecord(operation, workspace, device, state, row["digest"], now)

    def accept_local(self, env: CommandEnvelope, scope: LocalScope,
                     *, now: float) -> CommandRecord:
        CommandEnvelope.parse(json.loads(env.canonical()), now=now)
        authorise_local(env, scope)
        with _db(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM lf_commands WHERE workspace=? AND device=? "
                                  "AND (operation=? OR idem_key=?)",
                                  (env.workspace_id, env.target_device_id, env.operation_id,
                                   env.idempotency_key)).fetchone()
            if existing:
                if existing["digest"] != env.digest or existing["operation"] != env.operation_id:
                    raise ControlError("idempotency_conflict")
                return CommandRecord(env.operation_id, env.workspace_id, env.target_device_id,
                                     existing["state"], env.digest, existing["updated"], True)
            fence = db.execute("SELECT last_sequence FROM lf_command_fences "
                               "WHERE workspace=? AND device=?",
                               (env.workspace_id, env.target_device_id)).fetchone()
            if fence and env.sequence <= fence[0]:
                raise ControlError("stale_sequence")
            record = self._insert(db, env, "accepted", now)
            db.execute("INSERT INTO lf_command_fences VALUES(?,?,?) "
                       "ON CONFLICT(workspace,device) DO UPDATE SET last_sequence=excluded.last_sequence",
                       (env.workspace_id, env.target_device_id, env.sequence))
            db.commit()
            return record

    def finish_local(self, env: CommandEnvelope, *, applied: bool, output_confirmed: bool,
                     now: float) -> CommandRecord:
        with _db(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM lf_commands WHERE workspace=? AND device=? AND operation=?",
                             (env.workspace_id, env.target_device_id, env.operation_id)).fetchone()
            if row is None or row["digest"] != env.digest:
                raise ControlError("unknown_operation")
            if row["state"] in TERMINAL | {"applied"}:
                return CommandRecord(env.operation_id, env.workspace_id, env.target_device_id,
                                     row["state"], env.digest, row["updated"])
            if row["state"] != "accepted":
                raise ControlError("invalid_transition")
            # Transport effects need an actual engine observation; never infer audio from delivery.
            if applied and env.command in {"play", "pause", "skip", "seek", "set_volume"} and not output_confirmed:
                raise ControlError("output_unconfirmed")
            state = "applied" if applied else "rejected"
            db.execute("UPDATE lf_commands SET state=?, updated=? WHERE workspace=? AND device=? AND operation=?",
                       (state, now, env.workspace_id, env.target_device_id, env.operation_id))
            db.execute("INSERT INTO lf_command_history VALUES(?,?,?,?,?)",
                       (env.workspace_id, env.target_device_id, env.operation_id, state, now))
            db.commit()
            return CommandRecord(env.operation_id, env.workspace_id, env.target_device_id,
                                 state, env.digest, now)

    def discard_stale(self, *, now: float, workspace: str, device: str,
                      minimum_policy: int | None = None) -> int:
        """Never auto-execute an undelivered transport button after reconnect."""
        count = 0
        with _db(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            rows = db.execute("SELECT * FROM lf_commands WHERE workspace=? AND device=? "
                              "AND state IN ('created','authorised','queued','delivered','accepted')",
                              (workspace, device)).fetchall()
            for row in rows:
                data = json.loads(row["envelope"])
                expired = row["expires"] <= now
                stale = minimum_policy is not None and data["policy_version"] < minimum_policy
                if not expired and not stale:
                    continue
                state = "expired" if expired else "superseded"
                db.execute("UPDATE lf_commands SET state=?, updated=? WHERE workspace=? AND device=? AND operation=?",
                           (state, now, workspace, device, row["operation"]))
                db.execute("INSERT INTO lf_command_history VALUES(?,?,?,?,?)",
                           (workspace, device, row["operation"], state, now))
                count += 1
            db.commit()
        return count

    def append_event(self, event: Event) -> bool:
        _id(event.event_id)
        _id(event.workspace_id)
        _id(event.device_id)
        _integer(event.device_generation)
        _integer(event.sequence, minimum=1)
        payload = _event_payload(event.kind, event.payload)
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        with _db(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            found = db.execute("SELECT * FROM lf_events WHERE workspace=? AND device=? "
                               "AND (event_id=? OR (generation=? AND sequence=?))",
                               (event.workspace_id, event.device_id, event.event_id,
                                event.device_generation, event.sequence)).fetchone()
            if found:
                if (found["event_id"], found["generation"], found["sequence"],
                    found["kind"], found["payload"]) != (
                        event.event_id, event.device_generation, event.sequence,
                        event.kind, encoded):
                    raise ControlError("event_conflict")
                return False
            count = db.execute("SELECT count(*) FROM lf_events WHERE workspace=? AND device=? "
                               "AND acknowledged IS NULL", (event.workspace_id, event.device_id)).fetchone()[0]
            if count >= self.limit:
                raise ControlError("outbox_full")
            last_row = db.execute("SELECT last_sequence FROM lf_event_fences "
                                  "WHERE workspace=? AND device=? AND generation=?",
                                  (event.workspace_id, event.device_id,
                                   event.device_generation)).fetchone()
            last = last_row[0] if last_row else 0
            if event.sequence != last + 1:
                raise ControlError("event_out_of_order")
            db.execute("INSERT INTO lf_events VALUES(?,?,?,?,?,?,?,?,NULL)",
                       (event.workspace_id, event.device_id, event.event_id,
                        event.device_generation, event.sequence, event.kind,
                        encoded, event.recorded_at))
            db.execute("INSERT INTO lf_event_fences VALUES(?,?,?,?) "
                       "ON CONFLICT(workspace,device,generation) DO UPDATE SET "
                       "last_sequence=excluded.last_sequence",
                       (event.workspace_id, event.device_id, event.device_generation,
                        event.sequence))
            db.commit()
            return True

    def pending_events(self, workspace: str, device: str, *, limit: int = 100) -> list[Event]:
        if type(limit) is not int or not 1 <= limit <= 500:
            raise ControlError("invalid_limit")
        with _db(self.path) as db:
            rows = db.execute("SELECT * FROM lf_events WHERE workspace=? AND device=? "
                              "AND acknowledged IS NULL ORDER BY generation,sequence LIMIT ?",
                              (workspace, device, limit)).fetchall()
        return [Event(r["event_id"], workspace, device, r["generation"], r["sequence"],
                      r["kind"], json.loads(r["payload"]), r["recorded"]) for r in rows]

    def acknowledge_event(self, workspace: str, device: str, event_id: str,
                          *, now: float) -> bool:
        with _db(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            result = db.execute("UPDATE lf_events SET acknowledged=? WHERE workspace=? AND "
                                "device=? AND event_id=? AND acknowledged IS NULL",
                                (now, workspace, device, event_id))
            db.commit()
            return result.rowcount == 1

    def ingest_remote(self, event: Event) -> tuple[str, ...]:
        """Cloud stages reordered events; returns only contiguous IDs to process."""
        _id(event.event_id)
        _id(event.workspace_id)
        _id(event.device_id)
        _integer(event.device_generation)
        _integer(event.sequence, minimum=1)
        encoded = json.dumps(_event_payload(event.kind, event.payload),
                             sort_keys=True, separators=(",", ":"))
        with _db(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT * FROM lf_inbox WHERE workspace=? AND device=? AND "
                             "(event_id=? OR (generation=? AND sequence=?))",
                             (event.workspace_id, event.device_id, event.event_id,
                              event.device_generation, event.sequence)).fetchone()
            if old and (old["event_id"] != event.event_id or old["payload"] != encoded or old["kind"] != event.kind):
                raise ControlError("event_conflict")
            if not old:
                unprocessed = db.execute("SELECT count(*) FROM lf_inbox WHERE workspace=? AND "
                                         "device=? AND applied=0",
                                         (event.workspace_id, event.device_id)).fetchone()[0]
                if unprocessed >= self.limit:
                    raise ControlError("inbox_full")
                db.execute("INSERT INTO lf_inbox VALUES(?,?,?,?,?,?,?,0)",
                           (event.workspace_id, event.device_id, event.device_generation,
                            event.sequence, event.event_id, event.kind, encoded))
            fence = db.execute("SELECT applied_sequence FROM lf_inbox_fences WHERE workspace=? "
                               "AND device=? AND generation=?",
                               (event.workspace_id, event.device_id, event.device_generation)).fetchone()
            cursor = fence[0] if fence else 0
            newly: list[str] = []
            while True:
                row = db.execute("SELECT event_id FROM lf_inbox WHERE workspace=? AND device=? "
                                 "AND generation=? AND sequence=? AND applied=0",
                                 (event.workspace_id, event.device_id, event.device_generation,
                                  cursor + 1)).fetchone()
                if not row:
                    break
                cursor += 1
                newly.append(row[0])
            # Leave rows unapplied until the caller durably handles each; an interrupted
            # reducer can retry after restart instead of losing events.
            db.commit()
            return tuple(newly)

    def compact(self, *, before: float) -> None:
        """Keep unacknowledged events; only old, already confirmed metadata may be removed."""
        with _db(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM lf_events WHERE acknowledged IS NOT NULL AND acknowledged<?",
                       (before,))
            db.commit()

    def inbox_event(self, workspace: str, device: str, event_id: str) -> Event | None:
        with _db(self.path) as db:
            row = db.execute("SELECT * FROM lf_inbox WHERE workspace=? AND device=? AND event_id=?",
                             (workspace, device, event_id)).fetchone()
        if row is None:
            return None
        data = json.loads(row["payload"])
        kind = row["kind"]
        return Event(event_id, workspace, device, row["generation"],
                     row["sequence"], kind, data, 0)

    def acknowledge_remote(self, workspace: str, device: str, generation: int,
                           event_id: str) -> bool:
        """Commit a contiguous cloud event only after the consumer has handled it."""
        with _db(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM lf_inbox WHERE workspace=? AND device=? AND "
                             "generation=? AND event_id=?",
                             (workspace, device, generation, event_id)).fetchone()
            if row is None:
                raise ControlError("unknown_event")
            if row["applied"]:
                return False
            fence = db.execute("SELECT applied_sequence FROM lf_inbox_fences WHERE "
                               "workspace=? AND device=? AND generation=?",
                               (workspace, device, generation)).fetchone()
            current = fence[0] if fence else 0
            if row["sequence"] != current + 1:
                raise ControlError("event_out_of_order")
            db.execute("UPDATE lf_inbox SET applied=1 WHERE workspace=? AND device=? "
                       "AND generation=? AND event_id=?", (workspace, device, generation, event_id))
            db.execute("INSERT INTO lf_inbox_fences VALUES(?,?,?,?) "
                       "ON CONFLICT(workspace,device,generation) DO UPDATE SET "
                       "applied_sequence=excluded.applied_sequence",
                       (workspace, device, generation, row["sequence"]))
            db.commit()
            return True
