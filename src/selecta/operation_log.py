"""Answers to operations that already happened, kept on disk so a retry after a restart still
gets the first answer instead of doing the change twice (T0256).

A page that loses the answer to a change sends it again with the same operation id. The server
used to remember those answers only in memory, so if it restarted in between, the retry made a
second draft. Each finished answer is now one small file in the data folder, named by a hash of
the operation id, and only the newest few hundred are kept. Nothing here leaves this computer.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import tempfile
from pathlib import Path

Finished = tuple[int, bytes, str]  # status, response body, fingerprint of the request


class FinishedOperations:
    """A bounded map of operation id to its first answer, in memory and on disk."""

    def __init__(self, folder: Path, keep: int) -> None:
        self.folder = folder
        self.keep = keep
        self._memory: dict[str, Finished] = {}
        self._writes = 0

    def _path(self, operation: str) -> Path:
        return self.folder / f"{hashlib.sha256(operation.encode()).hexdigest()[:40]}.json"

    def get(self, operation: str) -> Finished | None:
        known = self._memory.get(operation)
        if known is not None:
            return known
        try:
            saved = json.loads(self._path(operation).read_text("utf-8"))
        except (OSError, ValueError):
            return None
        if saved.get("operation") != operation:
            return None  # a hash collision, or a file from something else
        try:
            known = (
                int(saved["status"]),
                base64.b64decode(saved["body"]),
                str(saved["fingerprint"]),
            )
        except (KeyError, TypeError, ValueError):
            return None
        self._memory[operation] = known
        return known

    def __contains__(self, operation: object) -> bool:
        return isinstance(operation, str) and self.get(operation) is not None

    def remember(self, operation: str, finished: Finished) -> None:
        self._memory[operation] = finished
        while len(self._memory) > self.keep:
            del self._memory[next(iter(self._memory))]
        status, body, fingerprint = finished
        record = {
            "operation": operation,
            "status": status,
            "body": base64.b64encode(body).decode("ascii"),
            "fingerprint": fingerprint,
        }
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                "w", encoding="utf-8", dir=self.folder, suffix=".tmp", delete=False
            ) as stream:
                json.dump(record, stream)
            os.replace(stream.name, self._path(operation))
        except OSError:
            return  # memory still answers retries until the next restart
        self._writes += 1
        if self._writes % 25 == 0:
            self._prune()

    def _prune(self) -> None:
        try:
            files = sorted(self.folder.glob("*.json"), key=lambda path: path.stat().st_mtime_ns)
        except OSError:
            return
        for old in files[: max(len(files) - self.keep, 0)]:
            old.unlink(missing_ok=True)
