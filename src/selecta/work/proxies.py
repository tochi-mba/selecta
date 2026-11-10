"""Playback files made lazily, only for songs about to be heard (ADR-0399, SC-0399-01).

A FLAC playback copy of an MP3 is about six times its size, so Selecta never makes one per song
at upload (§5.8). `prepare` is called when songs enter something that will play them: a mix
revision, a preview or a request. For each song it answers one of:

- `direct`: the original is already lossless at the analysis rate (44.1 kHz stereo FLAC or WAV)
  and plays as it is, so no copy is made;
- `ready`: a playback file for these exact inputs exists (and is now marked used, which keeps it
  from being the next thing evicted);
- the state of the `play.proxy` job that will make it.

The job inherits the lane and urgency of the work that needs it. Given `for_job`, that job is
made to wait on the proxy, and the queue's own inheritance (`dependents.promote`) lifts the proxy
to its lane and urgency, and hands them back when it's done. Without one, the lane and urgency
given are used, and a proxy job already queued for the same song is raised to them if it was
less urgent. Asking twice for the same song makes one job (its idempotency key is the input
hash). Playback files are ordinary derived artifacts, so `storage/eviction.py` removes them under
the workspace's budget unless a playing or frozen revision uses them, and the next `prepare`
makes them again.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa

from selecta import persistence
from selecta.scheduling.policy import DEFAULT_URGENCY, Lane, inherited
from selecta.storage.keys import original_key
from selecta.storage.schema import assets
from selecta.work.dependents import move_lane
from selecta.work.enqueue import JobSpec
from selecta.work.model import TERMINAL, Job
from selecta.work.state import lock_job

NEEDS = ("mix", "preview", "request")
PROXY_VERSION = 1
DIRECT_FORMATS = frozenset({"flac", "wav"})
ANALYSIS_RATE = 44_100


class ProxyRefused(ValueError):
    """The song can't have a playback file: it's missing, deleted or lacks its metadata."""


@dataclass(frozen=True)
class Prepared:
    asset_id: str
    status: str
    """`direct`, `ready`, or the proxy job's state."""
    input_hash: str | None = None
    job_id: str | None = None
    keys: Any = None


def identity(source_sha256: str, sample_rate: int) -> tuple[dict, str]:
    """The playback file's provenance and its input hash, as `play.proxy` computes them."""
    provenance = {"source_sha256": source_sha256, "sample_rate": sample_rate,
                  "proxy_version": PROXY_VERSION, "codec": "flac", "bits": 24}
    digest = hashlib.sha256(json.dumps(provenance, sort_keys=True).encode()).hexdigest()
    return provenance, digest


def plays_directly(asset: Any) -> bool:
    return (
        str(asset.format).lower() in DIRECT_FORMATS
        and asset.sample_rate == ANALYSIS_RATE
        and asset.channels == 2
    )


def _asset(store, workspace_id: str, asset_id: str):
    with persistence.transaction(store.engine, workspace_id) as connection:
        row = connection.execute(sa.select(assets).where(
            assets.c.id == asset_id, assets.c.workspace_id == workspace_id,
            assets.c.deleted_at.is_(None),
        )).first()
    if row is None:
        raise ProxyRefused(f"There's no song {asset_id} in this workspace.")
    valid_hash = isinstance(row.sha256, str) and re.fullmatch(r"[0-9a-f]{64}", row.sha256)
    if not valid_hash or not isinstance(row.sample_rate, int) or not (
        8_000 <= row.sample_rate <= 192_000
    ):
        raise ProxyRefused(f"Song {asset_id} has no playback metadata yet.")
    return row


def _raise_to(store, job: Job, lane: str, urgency: int) -> Job:
    with persistence.transaction(store.engine, job.workspace_id) as connection:
        current = lock_job(connection, job.id)
        if current.state in TERMINAL:
            return current
        new_lane, new_urgency = inherited(current.lane, current.urgency, [(lane, urgency)])
        if (str(new_lane), new_urgency) == (current.lane, current.urgency):
            return current
        return move_lane(
            connection, current, str(new_lane), new_urgency, persistence.db_now(connection)
        )


def prepare(
    store,
    workspace_id: str,
    asset_ids: Iterable[str],
    *,
    need: str,
    lane: Lane | str | None = None,
    urgency: int | None = None,
    needed_by: float | None = None,
    for_job: str | None = None,
    created_by: str | None = None,
) -> list[Prepared]:
    """Make sure each song can play, making playback files only where needed (module notes)."""
    if need not in NEEDS:
        raise ValueError(f"Playback files are made for {', '.join(NEEDS)}, not {need!r}.")
    needing = store.job(for_job) if for_job is not None else None
    if for_job is not None and (needing is None or needing.workspace_id != workspace_id):
        raise ProxyRefused("The work that needs these songs isn't in this workspace.")
    lane = Lane(needing.lane if needing is not None else (lane or Lane.INTERACTIVE))
    urgency = needing.urgency if needing is not None else (
        DEFAULT_URGENCY[lane] if urgency is None else int(urgency)
    )
    needed_by = needing.needed_by if needing is not None and needed_by is None else needed_by
    prepared: list[Prepared] = []
    for asset_id in dict.fromkeys(asset_ids):
        asset = _asset(store, workspace_id, asset_id)
        if plays_directly(asset):
            prepared.append(Prepared(asset_id, "direct"))
            continue
        _, input_hash = identity(asset.sha256, asset.sample_rate)
        found = store.find_artifact(workspace_id, "playback", input_hash)
        if found is not None:
            prepared.append(Prepared(asset_id, "ready", input_hash, keys=found.keys))
            continue
        spec = JobSpec(
            workspace_id=workspace_id, type="play.proxy", idempotency_key=input_hash,
            lane=lane, urgency=urgency, needed_by=needed_by, created_by=created_by,
            input_ref={
                "objects": [original_key(workspace_id, asset_id)],
                "source_sha256": asset.sha256, "sample_rate": asset.sample_rate,
                "output": {"kind": "playback", "input_hash": input_hash}, "need": need,
            },
        )
        made = store.enqueue(spec)
        job = made.job if made.created else _raise_to(store, made.job, str(lane), urgency)
        if needing is not None and job.state not in TERMINAL:
            store.add_dependency(workspace_id, needing.id, job.id)
            job = store.job(job.id) or job
        prepared.append(Prepared(asset_id, str(job.state), input_hash, job.id))
    return prepared


__all__ = ["NEEDS", "Prepared", "ProxyRefused", "identity", "plays_directly", "prepare"]
