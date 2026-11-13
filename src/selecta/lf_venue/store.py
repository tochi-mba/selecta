"""SQLite journal and state checkpoints stored on the speaker device, never in Cloud."""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path

from .model import Daypart, Opening, Policy, Recording, Venue, VenueError, Zone


def _decode_venue(data: dict) -> Venue:
    p = dict(data["policy"])
    p["dayparts"] = tuple(Daypart(**d) for d in p.get("dayparts", ()))
    return Venue(
        workspace_id=data["workspace_id"],
        venue_id=data["venue_id"],
        engine_id=data["engine_id"],
        timezone=data["timezone"],
        openings=tuple(Opening(**item) for item in data["openings"]),
        zones=tuple(
            Zone(
                **{
                    **item,
                    "channels": tuple(item.get("channels", (0, 1))),
                    "allowed_sources": tuple(item.get("allowed_sources", ())),
                }
            )
            for item in data["zones"]
        ),
        policy=Policy(
            **{
                **p,
                "blocked_artists": tuple(p.get("blocked_artists", ())),
                "fallback_ids": tuple(p.get("fallback_ids", ())),
            }
        ),
        authorised_roots=tuple(data.get("authorised_roots", ())),
        programme_id=data.get("programme_id", ""),
    )


class VenueStore:
    """Atomic local state. WAL + BEGIN IMMEDIATE serialise zone/output races."""

    def __init__(self, database: str | Path):
        self.path = str(database)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.db = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA busy_timeout=5000")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS config (workspace TEXT, venue TEXT, document TEXT NOT NULL,
              PRIMARY KEY (workspace, venue));
          CREATE TABLE IF NOT EXISTS tracks (workspace TEXT, venue TEXT, track TEXT,
              document TEXT NOT NULL,
              PRIMARY KEY (workspace, venue, track));
          CREATE TABLE IF NOT EXISTS output_bindings (engine TEXT, output TEXT, channel INTEGER,
              workspace TEXT, venue TEXT, zone TEXT,
              PRIMARY KEY (engine, output, channel));
          CREATE TABLE IF NOT EXISTS sessions (workspace TEXT, venue TEXT, zone TEXT,
              generation INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'stopped',
              current TEXT, position REAL NOT NULL DEFAULT 0, started_at REAL,
              last_verified REAL, checkpoint_at REAL, last_seen_utc REAL,
              committed TEXT NOT NULL DEFAULT '[]', prepared TEXT NOT NULL DEFAULT '[]',
              planned TEXT NOT NULL DEFAULT '[]', reason TEXT,
              PRIMARY KEY (workspace, venue, zone));
          CREATE TABLE IF NOT EXISTS journal (
              workspace TEXT, venue TEXT, zone TEXT, seq INTEGER, event_id TEXT UNIQUE,
              kind TEXT NOT NULL, track TEXT, generated_at REAL NOT NULL, generation INTEGER,
              source TEXT NOT NULL, uploaded INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (workspace, venue, zone, seq));
          CREATE TABLE IF NOT EXISTS played (workspace TEXT, venue TEXT, zone TEXT, track TEXT,
              played_at REAL, PRIMARY KEY (workspace, venue, zone, track));
        """)

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield self.db
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def close(self) -> None:
        self.db.close()

    def configure(self, venue: Venue) -> None:
        """Reserve physical channels *across venues* on the same engine, all-or-nothing."""
        with self.tx() as db:
            old = db.execute(
                "SELECT document FROM config WHERE workspace=? AND venue=?",
                (venue.workspace_id, venue.venue_id),
            ).fetchone()
            if old is not None:
                previous = _decode_venue(json.loads(old["document"]))
                prior_outputs = {z.id: (z.output_id, z.channels) for z in previous.zones}
                for current in previous.zones:
                    state = db.execute(
                        "SELECT state FROM sessions WHERE workspace=? AND venue=? AND zone=?",
                        (venue.workspace_id, venue.venue_id, current.id),
                    ).fetchone()
                    new_zone = next((z for z in venue.zones if z.id == current.id), None)
                    if (
                        state is not None
                        and state[0] in ("playing", "unknown")
                        and (
                            venue.engine_id != previous.engine_id
                            or new_zone is None
                            or (new_zone.output_id, new_zone.channels) != prior_outputs[current.id]
                        )
                    ):
                        raise VenueError("Cannot remap an active or unknown physical output")
            db.execute(
                "DELETE FROM output_bindings WHERE workspace=? AND venue=?",
                (venue.workspace_id, venue.venue_id),
            )
            try:
                for zone in venue.zones:
                    if (
                        not zone.output_id
                        or not zone.channels
                        or len(set(zone.channels)) != len(zone.channels)
                    ):
                        raise VenueError(
                            "A zone needs a unique physical output and nonempty channels"
                        )
                    for channel in zone.channels:
                        if channel < 0:
                            raise VenueError("Output channel must be nonnegative")
                        db.execute(
                            "INSERT INTO output_bindings VALUES (?,?,?,?,?,?)",
                            (
                                venue.engine_id,
                                zone.output_id,
                                channel,
                                venue.workspace_id,
                                venue.venue_id,
                                zone.id,
                            ),
                        )
            except sqlite3.IntegrityError as exc:
                raise VenueError(
                    "Physical output channel already assigned to another zone"
                ) from exc
            db.execute(
                "INSERT INTO config VALUES (?,?,?) "
                "ON CONFLICT(workspace,venue) DO UPDATE SET document=excluded.document",
                (venue.workspace_id, venue.venue_id, json.dumps(asdict(venue))),
            )
            for zone in venue.zones:
                db.execute(
                    "INSERT OR IGNORE INTO sessions(workspace,venue,zone) VALUES (?,?,?)",
                    (venue.workspace_id, venue.venue_id, zone.id),
                )

    def config(self, workspace: str, venue: str) -> Venue:
        row = self.db.execute(
            "SELECT document FROM config WHERE workspace=? AND venue=?", (workspace, venue)
        ).fetchone()
        if row is None:
            raise VenueError("Unknown venue or workspace")
        return _decode_venue(json.loads(row["document"]))

    def put_recording(self, workspace: str, venue: str, recording: Recording) -> None:
        self.config(workspace, venue)  # must exist; never let inventories cross venues
        with self.tx() as db:
            db.execute(
                "INSERT INTO tracks VALUES (?,?,?,?) "
                "ON CONFLICT(workspace,venue,track) "
                "DO UPDATE SET document=excluded.document",
                (workspace, venue, recording.track_id, json.dumps(asdict(recording))),
            )

    def recording(self, workspace: str, venue: str, track_id: str) -> Recording | None:
        row = self.db.execute(
            "SELECT document FROM tracks WHERE workspace=? AND venue=? AND track=?",
            (workspace, venue, track_id),
        ).fetchone()
        return Recording(**json.loads(row["document"])) if row else None

    def session(self, workspace: str, venue: str, zone: str) -> dict:
        row = self.db.execute(
            "SELECT * FROM sessions WHERE workspace=? AND venue=? AND zone=?",
            (workspace, venue, zone),
        ).fetchone()
        if row is None:
            raise VenueError("Unknown local zone")
        d = dict(row)
        for key in ("committed", "prepared", "planned"):
            d[key] = json.loads(d[key])
        return d

    def mutate(self, workspace: str, venue: str, zone: str, **fields: object) -> dict:
        allowed = {
            "generation",
            "state",
            "current",
            "position",
            "started_at",
            "last_verified",
            "checkpoint_at",
            "last_seen_utc",
            "committed",
            "prepared",
            "planned",
            "reason",
        }
        if not fields or set(fields) - allowed:
            raise ValueError("Unknown or empty session state update")
        data = {
            k: json.dumps(v) if k in ("committed", "prepared", "planned") else v
            for k, v in fields.items()
        }
        with self.tx() as db:
            cursor = db.execute(
                "UPDATE sessions SET "
                + ", ".join(k + "=?" for k in data)
                + " WHERE workspace=? AND venue=? AND zone=?",
                (*data.values(), workspace, venue, zone),
            )
            if cursor.rowcount != 1:
                raise VenueError("Unknown zone")
        return self.session(workspace, venue, zone)

    def append_ack(
        self,
        workspace: str,
        venue: str,
        zone: str,
        *,
        event_id: str,
        kind: str,
        track: str | None,
        at: float,
        generation: int,
        source: str = "schedule",
    ) -> bool:
        """Only audio-output acknowledgements enter the journal; no paths or guest IDs."""
        if kind not in ("started", "ended", "stopped", "failed") or source not in (
            "schedule",
            "staff",
            "request",
            "fallback",
            "recovery",
        ):
            raise VenueError("Not an auditable local output acknowledgement")
        with self.tx() as db:
            if db.execute("SELECT 1 FROM journal WHERE event_id=?", (event_id,)).fetchone():
                return False
            row = db.execute(
                "SELECT COALESCE(MAX(seq),0)+1 FROM journal "
                "WHERE workspace=? AND venue=? AND zone=?",
                (workspace, venue, zone),
            ).fetchone()
            db.execute(
                "INSERT INTO journal (workspace,venue,zone,seq,event_id,kind,track,"
                "generated_at,generation,source) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (workspace, venue, zone, row[0], event_id, kind, track, at, generation, source),
            )
            if kind == "started" and track:
                db.execute(
                    "INSERT INTO played VALUES (?,?,?,?,?) "
                "ON CONFLICT(workspace,venue,zone,track) "
                "DO UPDATE SET played_at=excluded.played_at",
                    (workspace, venue, zone, track, at),
                )
            return True

    def record_start(
        self,
        workspace: str,
        venue: str,
        zone: str,
        *,
        generation: int,
        track: str,
        position: float,
        at: float,
        source: str,
    ) -> None:
        """Durable checkpoint and physical-output acknowledgement in one transaction."""
        if source not in ("schedule", "recovery", "fallback", "request", "staff"):
            raise VenueError("Invalid journal source")
        event = f"{workspace}:{venue}:{zone}:{generation}:start"
        with self.tx() as db:
            cursor = db.execute(
                """UPDATE sessions SET generation=?,state='playing',current=?,started_at=?,
                position=?,checkpoint_at=?,last_verified=?,reason=NULL,last_seen_utc=?
                WHERE workspace=? AND venue=? AND zone=?""",
                (generation, track, at - position, position, at, at, at, workspace, venue, zone),
            )
            if cursor.rowcount != 1:
                raise VenueError("Unknown local session")
            seq = db.execute(
                "SELECT COALESCE(MAX(seq),0)+1 FROM journal "
                "WHERE workspace=? AND venue=? AND zone=?",
                (workspace, venue, zone),
            ).fetchone()[0]
            db.execute(
                "INSERT INTO journal (workspace,venue,zone,seq,event_id,kind,track,"
                "generated_at,generation,source) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (workspace, venue, zone, seq, event, "started", track, at, generation, source),
            )
            db.execute(
                "INSERT INTO played VALUES (?,?,?,?,?) "
                "ON CONFLICT(workspace,venue,zone,track) "
                "DO UPDATE SET played_at=excluded.played_at",
                (workspace, venue, zone, track, at),
            )

    def last_played(self, workspace: str, venue: str, zone: str, track: str) -> float | None:
        row = self.db.execute(
            "SELECT played_at FROM played WHERE workspace=? AND venue=? AND zone=? AND track=?",
            (workspace, venue, zone, track),
        ).fetchone()
        return row[0] if row else None

    def pending_events(self, workspace: str, venue: str, limit: int = 500) -> list[dict]:
        rows = self.db.execute(
            "SELECT zone,seq,event_id,kind,track,generated_at,generation,source "
            "FROM journal WHERE workspace=? AND venue=? AND uploaded=0 "
            "ORDER BY zone,seq LIMIT ?",
            (workspace, venue, min(max(limit, 1), 500)),
        ).fetchall()
        return [dict(row) for row in rows]  # deliberately metadata-only, never transport commands

    def acknowledge_events(self, workspace: str, venue: str, event_ids: list[str]) -> int:
        if not event_ids:
            return 0
        with self.tx() as db:
            return sum(
                db.execute(
                    "UPDATE journal SET uploaded=1 WHERE workspace=? AND venue=? AND event_id=?",
                    (workspace, venue, event_id),
                ).rowcount
                for event_id in set(event_ids)
            )
