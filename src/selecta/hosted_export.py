"""Hosted export: one `export.render` job for the mix exactly as it plays (cloud.hosted_render).

`request_export` asks `hosted_render.mix_state` for the mix's timeline (the same answer the web
player plays) and, once every part is ready or failed, queues one job whose input names that
timeline: each part's file by object key and SHA-256, its cut (`from_s`, `seconds`) and its mix
level. A hand-off whose render failed is already two song parts back to back in that timeline,
so it exports as the straight change it plays as. The job's idempotency key and declared output
both follow from the timeline (`workers.export_join.export_hash`), so asking twice makes one job
and a later change of plan can't change an export already asked for. The worker joins the parts
without rendering anything (`workers.export_join`).

`export_status` reads the job: `progress` and `parts_done` / `parts_total` are real units (parts
written, plus the upload as the last unit), and `estimate_s` is given only while the job is
running and has written at least one part, from its own pace so far.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta import hosted_render, hosted_status
from selecta.hosted_render import EXPORT, Work, _first_key, _latest_job, _output, _sign, _state
from selecta.persistence import db_now, transaction
from selecta.scheduling.policy import Lane
from selecta.work.enqueue import JobSpec
from selecta.work.model import TERMINAL
from selecta.work.schema import jobs

NOT_READY = "The mix isn't ready yet: export opens once every part of it is ready."


def export_timeline(parts: Sequence[dict[str, Any]]) -> list[dict[str, Any]] | None:
    """The export input from `mix_state(..., files=True)` parts, or None while a part has no
    file yet. Parts with no length are left out (the player plays nothing for them either)."""
    timeline = []
    for part in parts:
        found = part.get("_file") or {}
        if not found.get("key") or not found.get("sha256"):
            return None
        if float(part["seconds"]) <= 0:
            continue
        timeline.append({"kind": part["kind"], "key": found["key"], "sha256": found["sha256"],
                         "from_s": float(part["from_s"]), "seconds": float(part["seconds"]),
                         "gain_db": float(part.get("gain_db") or 0.0)
                         if part["kind"] == "song" else 0.0})
    return timeline


def export_spec(workspace_id: str, timeline: list[dict[str, Any]],
                created_by: str | None) -> JobSpec:
    from selecta.workers.export_join import export_hash  # the worker's own rule

    digest = export_hash(timeline)
    return JobSpec(
        workspace_id=workspace_id, type=EXPORT, idempotency_key=f"hosted-export:{digest}",
        lane=Lane.STANDARD, created_by=created_by,
        input_ref={"timeline": timeline, "objects": list(dict.fromkeys(
            part["key"] for part in timeline)), "output": _output("export", digest)})


def request_export(engine: Engine, work: Work, workspace_id: str, order: Sequence[dict[str, Any]],
                   *, client, buckets, created_by: str | None = None,
                   read_object: Callable[[str, Path], Path] | None = None) -> dict[str, Any]:
    """One `export.render` job for this mix as it plays now (module notes)."""
    mix = hosted_render.mix_state(engine, work, workspace_id, order, client=client,
                                  buckets=buckets, created_by=created_by,
                                  read_object=read_object, files=True)
    if sum(1 for part in mix["parts"] if part["kind"] == "song") < 2:
        return {"state": "refused", "why": "An export needs at least two songs."}
    timeline = export_timeline(mix["parts"]) if mix["complete"] else None
    if timeline is None:
        return {"state": "refused", "why": NOT_READY}
    spec = export_spec(workspace_id, timeline, created_by)
    with transaction(engine, workspace_id) as conn:
        old = _latest_job(conn, workspace_id, EXPORT, spec.idempotency_key)
        made = hosted_render._artifact(conn, workspace_id, "export",
                                       spec.input_ref["output"]["input_hash"])
    if old is not None and str(old["state"]) == "succeeded" and made is not None:
        # this exact mix was exported already and its file is still stored: hand it over
        done = export_status(engine, workspace_id, old["id"], client=client, buckets=buckets)
        if done is not None:
            return {**done, "job_id": old["id"]}
    # a live export that can never publish is replaced; a finished one (or one that failed or
    # was cancelled) is asked for again by making a new job, as before
    broken = old is not None and hosted_status.needs_new(
        False, old, spec.input_ref["output"]) == "no_output"
    total = len(timeline) + 1
    if old is not None and not broken and str(old["state"]) not in TERMINAL:
        return {"state": "queued", "job_id": old["id"], "parts_done": 0, "parts_total": total,
                "progress": [0, total]}  # asked twice: still the one job
    job_id, refused = hosted_render._make(work, spec, old if broken else None)
    if refused:
        return {"state": "refused", "why": refused}
    return {"state": "queued", "job_id": job_id or old["id"], "parts_done": 0,
            "parts_total": total, "progress": [0, total]}


def export_status(engine: Engine, workspace_id: str, job_id: str, *, client,
                  buckets) -> dict[str, Any] | None:
    """`{"state", "progress": [done, total], "parts_done", "parts_total", "estimate_s"?,
    "worker_seen", "url"?, "size_bytes"?, "seconds"?, "why"?}` (module notes)."""
    with transaction(engine, workspace_id) as conn:
        job = conn.execute(sa.select(jobs).where(
            jobs.c.workspace_id == workspace_id, jobs.c.id == job_id,
            jobs.c.type == EXPORT)).mappings().first()
        if job is None:
            return None
        worker = hosted_render._worker_seen(conn, "export")
        now = db_now(conn)
    result = job["result"] or {}
    if str(job["state"]) == "succeeded":
        key = _first_key(result.get("keys"))
        return {"state": "ready", "url": _sign(client, buckets, key, workspace_id) if key else None,
                "size_bytes": result.get("size_bytes"), "seconds": result.get("seconds")}
    state = _state(None, job)
    done = float(job["progress_done"] or 0.0)
    total = float(job["progress_total"]) if job["progress_total"] else None
    out = {**state, "progress": [job["progress_done"], job["progress_total"]],
           "parts_done": int(done), "parts_total": int(total) if total else None,
           "worker_seen": worker}
    started = job["started_at"]
    if state["state"] == "running" and started and total and 0 < done < total:
        elapsed = max(0.0, now - float(started))
        out["estimate_s"] = max(1, round(elapsed * (total - done) / done))
    return out


__all__ = ["export_spec", "export_status", "export_timeline", "request_export"]
