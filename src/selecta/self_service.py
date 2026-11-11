"""What Workspace can say for certain about a local fault, for people to put right themselves.

GP-0263: every check here is something measured on this PC just now, never a guess. Each value is a
boolean or a count, so nothing here can carry a path, a song name or anything else private.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

from selecta.routes.exports import NO_ROOM

# under this much free space, rendering and saving files are likely to stop
LOW_DISK_BYTES = 1024**3


def local_checks(home: Path) -> dict[str, bool]:
    """What this PC has, checked now: a dependency that is missing is reported as missing, and a
    dependency that is there is not explained at all."""
    try:
        free = shutil.disk_usage(home).free
    except OSError:
        free = None
    return {
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "data_writable": home.is_dir() and os.access(home, os.W_OK),
        "disk_low": free is not None and free < LOW_DISK_BYTES,
    }


def export_outcomes(home: Path) -> dict[str, int]:
    """How saved export jobs ended, counted by what is known about why. Only counts leave here."""
    counts = {"failed": 0, "failed_no_room": 0, "interrupted": 0}
    try:
        records = list((home / "exports" / "jobs").glob("*.json"))
    except OSError:
        return counts
    for record in records:
        try:
            job = json.loads(record.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        state = job.get("state") if isinstance(job, dict) else None
        if state == "failed":
            counts["failed_no_room" if job.get("error") == NO_ROOM else "failed"] += 1
        elif state == "interrupted":
            counts["interrupted"] += 1
    return counts
