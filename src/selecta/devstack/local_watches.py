"""Loopback-only local music folder watches for the Cloud development workspace.

This is a *device-local development companion*, NOT a Cloud API or production
media service. It never uploads, serves, proxies or copies audio to Cloud. The
installed engine owns the production version of this workflow; remote browsers
must use metadata-only device snapshots and local engine handoff.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

import os
import sqlite3
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from selecta.devstack import guard
from selecta.devstack.settings import DevSettings
from selecta.lf_catalogue import LocalCatalogue
from selecta.lf_catalogue.catalogue import ScanCancelled

WATCH_EVERY_SECONDS = 300
_DB_LABEL = "local-watches.sqlite"
_DEVICE_ID = "dev-local-device"
_WORKSPACE_ID = "dev-local-workspace"


class FolderInput(BaseModel):
    folder: str = Field(min_length=1, max_length=2048)


class WatchToggle(BaseModel):
    enabled: bool


def _approved_path(text: str) -> Path:
    """Paths are accepted only from a same-machine user action, never Cloud commands."""
    raw = text.strip()
    if not raw or "\x00" in raw or raw.startswith(("\\\\", "//")):
        raise ValueError("Choose a folder on this computer, not a network share.")
    folder = Path(raw).expanduser()
    if not folder.is_absolute() or ".." in folder.parts:
        raise ValueError("Enter the full folder address on this computer.")
    try:
        root = folder.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise ValueError("The folder is unavailable. Reconnect its drive and try again.") from exc
    if not root.is_dir():
        raise ValueError("Choose a folder rather than a file.")
    if not os.access(root, os.R_OK):
        raise ValueError("Selecta does not have permission to read this folder.")
    return root


class LocalWatches:
    """Persist source identity, enabled state and progress in a private local SQLite file.

    The background loop does bounded source scans while the Cloud dev site is closed.
    Stopping a watch never deletes sources, recordings or any files on disk.
    """

    def __init__(self, settings: DevSettings, *, interval: int = WATCH_EVERY_SECONDS):
        self.file = settings.data / _DB_LABEL
        self.interval = interval
        self._gate = threading.RLock()
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._requests: set[str] = set()
        self._cancel: set[str] = set()
        self._thread: threading.Thread | None = None
        with self._gate, self._catalogue() as catalogue:
            catalogue.conn.execute(
                "CREATE TABLE IF NOT EXISTS watch_settings ("
                "source_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1,"
                "last_attempt REAL, last_success REAL, problem TEXT)"
            )
            catalogue.conn.commit()

    def _catalogue(self) -> LocalCatalogue:
        return LocalCatalogue(
            self.file, workspace_id=_WORKSPACE_ID, device_id=_DEVICE_ID
        )

    def start(self) -> None:
        with self._gate:
            if self._thread is not None:
                return
            self._thread = threading.Thread(
                target=self._run, name="selecta-dev-folder-watches", daemon=True
            )
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def _rows(self, catalogue: LocalCatalogue):
        return catalogue.conn.execute(
            "SELECT s.id, s.root, s.state, s.scan_active, s.discovered, "
            "s.last_verified, w.enabled, w.last_attempt, w.last_success, w.problem,"
            " (SELECT COUNT(*) FROM local_files f WHERE f.source_id=s.id "
            "AND f.state='ready') AS indexed "
            "FROM watch_settings w JOIN sources s ON s.id=w.source_id "
            "WHERE s.workspace_id=? AND s.device_id=? ORDER BY s.root COLLATE NOCASE",
            (_WORKSPACE_ID, _DEVICE_ID),
        ).fetchall()

    def snapshot(self) -> dict:
        with self._gate, self._catalogue() as catalogue:
            items = [
                {
                    "id": row["id"],
                    "name": Path(row["root"]).name or "Music folder",
                    # Only the loopback dev UI receives this path. It is NEVER
                    # included in the metadata-only hosted Cloud snapshot.
                    "path": row["root"],
                    "enabled": bool(row["enabled"]),
                    "available": Path(row["root"]).is_dir(),
                    "state": (
                        "paused" if not row["enabled"]
                        else "scanning" if row["scan_active"]
                        else row["state"]
                    ),
                    "indexed": row["indexed"],
                    "discovered": row["discovered"],
                    "last_scanned_at": row["last_success"],
                    "last_attempt_at": row["last_attempt"],
                    "problem": row["problem"],
                }
                for row in self._rows(catalogue)
            ]
        return {"schema_version": 1, "device": "This computer",
                "watch_every_seconds": self.interval, "sources": items}

    def check(self, folder: str) -> dict:
        root = _approved_path(folder)
        with self._gate, self._catalogue() as catalogue:
            for row in self._rows(catalogue):
                previous = Path(row["root"])
                if root == previous:
                    return {"ok": False, "reason": "This folder is already in the list."}
                if root.is_relative_to(previous):
                    return {
                        "ok": False,
                        "reason": "Already included in a watched parent folder.",
                    }
                if previous.is_relative_to(root):
                    return {
                        "ok": False,
                        "reason": "This folder includes another watched source. "
                        "Stop the smaller watch first to avoid duplicates.",
                    }
        return {"ok": True, "name": root.name or "Music folder"}

    def add(self, folder: str) -> dict:
        validated = self.check(folder)
        if not validated["ok"]:
            raise ValueError(validated["reason"])
        root = _approved_path(folder)
        with self._gate, self._catalogue() as catalogue:
            source_id = catalogue.add_source(root)
            catalogue.conn.execute(
                "INSERT INTO watch_settings(source_id,enabled,last_attempt,"
                "last_success,problem) VALUES(?,1,NULL,NULL,NULL) "
                "ON CONFLICT(source_id) DO UPDATE SET enabled=1,problem=NULL",
                (source_id,),
            )
            catalogue.conn.commit()
            self._requests.add(source_id)
            self._cancel.discard(source_id)
        self._wake.set()
        return {"accepted": True, "source_id": source_id}

    def toggle(self, source_id: str, enabled: bool) -> dict:
        with self._gate, self._catalogue() as catalogue:
            row = catalogue.conn.execute(
                "SELECT 1 FROM watch_settings WHERE source_id=?", (source_id,)
            ).fetchone()
            if row is None:
                raise KeyError("Unknown local source")
            catalogue.conn.execute(
                "UPDATE watch_settings SET enabled=?,problem=NULL WHERE source_id=?",
                (int(enabled), source_id),
            )
            catalogue.conn.commit()
            if enabled:
                self._cancel.discard(source_id)
                self._requests.add(source_id)
            else:
                self._cancel.add(source_id)
                self._requests.discard(source_id)
        self._wake.set()
        return {"accepted": True, "enabled": enabled}

    def forget(self, source_id: str) -> dict:
        """Remove a watch from this device, retaining the catalogue and all files."""
        with self._gate, self._catalogue() as catalogue:
            gone = catalogue.conn.execute(
                "DELETE FROM watch_settings WHERE source_id=?", (source_id,)
            ).rowcount
            if not gone:
                raise KeyError("Unknown local source")
            catalogue.conn.commit()
            self._cancel.add(source_id)
            self._requests.discard(source_id)
        self._wake.set()
        return {"accepted": True, "files_deleted": False}

    def scan(self, source_id: str) -> dict:
        with self._gate, self._catalogue() as catalogue:
            row = catalogue.conn.execute(
                "SELECT enabled FROM watch_settings WHERE source_id=?", (source_id,)
            ).fetchone()
            if row is None:
                raise KeyError("Unknown local source")
            if not row["enabled"]:
                raise ValueError("Resume watching before requesting a scan.")
            self._requests.add(source_id)
        self._wake.set()
        return {"accepted": True, "message": "A local source scan has been queued."}

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                with self._gate, self._catalogue() as catalogue:
                    due = [
                        row["id"] for row in self._rows(catalogue)
                        if row["enabled"] and (
                            row["id"] in self._requests
                            or row["last_attempt"] is None
                            or time.time() - row["last_attempt"] >= self.interval
                        )
                    ]
                for source_id in due:
                    if self._stop.is_set():
                        break
                    self._scan_one(source_id)
            except (sqlite3.Error, OSError):
                # Keep the daemon alive; the next interval retries transient disk faults.
                pass
            self._wake.wait(2)
            self._wake.clear()

    def _scan_one(self, source_id: str) -> None:
        try:
            with self._gate, self._catalogue() as catalogue:
                entry = catalogue.conn.execute(
                    "SELECT enabled FROM watch_settings WHERE source_id=?", (source_id,)
                ).fetchone()
                if entry is None or not entry["enabled"]:
                    return
                self._requests.discard(source_id)
                self._cancel.discard(source_id)
                catalogue.conn.execute(
                    "UPDATE watch_settings SET last_attempt=?,problem=NULL WHERE source_id=?",
                    (time.time(), source_id),
                )
                catalogue.conn.commit()
            while not self._stop.is_set():
                with self._gate, self._catalogue() as catalogue:
                    progress = catalogue.scan_step(
                        source_id, max_entries=32,
                        should_cancel=lambda: self._stop.is_set()
                        or source_id in self._cancel,
                    )
                    if progress.complete:
                        catalogue.conn.execute(
                            "UPDATE watch_settings SET last_success=?,problem=NULL "
                            "WHERE source_id=?", (time.time(), source_id)
                        )
                        catalogue.conn.commit()
                        return
                    if progress.status.value in ("offline", "degraded", "cancelled"):
                        return
                time.sleep(0.05)
        except ScanCancelled:
            return
        except (sqlite3.Error, OSError, ValueError, KeyError) as exc:
            with self._gate, self._catalogue() as catalogue:
                catalogue.conn.execute(
                    "UPDATE watch_settings SET problem=? WHERE source_id=?",
                    (f"Scan needs attention ({type(exc).__name__}).", source_id),
                )
                catalogue.conn.commit()


def install_routes(app: FastAPI, settings: DevSettings) -> None:
    """Register routes only in selecta.devstack.cloud_app, never in api_cloud."""
    guard.require_development()
    manager = LocalWatches(settings)

    # Cloud already owns a lifespan for event fanout and resource disposal.
    # FastAPI versions with lifespan support no longer expose add_event_handler;
    # compose the existing context instead of overriding or bypassing it.
    parent_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def with_local_watches(application: FastAPI):
        async with parent_lifespan(application):
            manager.start()
            try:
                yield
            finally:
                manager.stop()

    app.router.lifespan_context = with_local_watches

    def local_request(request: Request) -> None:
        # Vite proxies this explicit local-only header to the loopback API.
        # An unrelated website cannot supply it via a simple cross-origin request.
        origin = request.headers.get("origin")
        if (
            request.headers.get("x-selecta-local-watch") != "1"
            or request.headers.get("sec-fetch-site") == "cross-site"
            or (origin and origin not in settings.site_origins)
        ):
            raise HTTPException(403, "Only the local development site may manage folders.")

    @app.get("/dev/local-watches", include_in_schema=False)
    def get_watches(request: Request) -> dict:
        local_request(request)
        return manager.snapshot()

    @app.get("/dev/local-watches/check", include_in_schema=False)
    def check_watch(request: Request, folder: str) -> dict:
        local_request(request)
        try:
            return manager.check(folder)
        except ValueError as exc:
            return {"ok": False, "reason": str(exc)}

    @app.post("/dev/local-watches", include_in_schema=False)
    def add_watch(request: Request, body: FolderInput) -> dict:
        local_request(request)
        try:
            return manager.add(body.folder)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.post("/dev/local-watches/{source_id}/scan", include_in_schema=False)
    def scan_watch(request: Request, source_id: str) -> dict:
        local_request(request)
        try:
            return manager.scan(source_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.patch("/dev/local-watches/{source_id}", include_in_schema=False)
    def toggle_watch(request: Request, source_id: str, body: WatchToggle) -> dict:
        local_request(request)
        try:
            return manager.toggle(source_id, body.enabled)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc

    @app.delete("/dev/local-watches/{source_id}", include_in_schema=False)
    def forget_watch(request: Request, source_id: str) -> dict:
        local_request(request)
        try:
            return manager.forget(source_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
