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

A new export is what the plan pays for (`allow_export`): it takes one of the plan's exports this
month (`Plan.exports_per_month`, the same counter the Plan & billing meter shows), and none is
made while storage is over the plan's limit (`over_quota_read_only`), because a kept export
counts against storage. Asking again for an export already made or already queued takes
nothing, and a job that isn't made gives its export back.
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
READ_ONLY = ("Your storage is over your plan's limit, so a new export can't be kept. Delete some "
             "songs or exports, or move to a plan with more storage, to export again.")
USED_UP = ("You've made this month's {limit} exports on your plan. More open on the 1st, or "
           "move to a plan with more.")


def allow_export(engine: Engine, workspace_id: str, created_by: str | None, *,
                 charge: bool = True):
    """(None, what was taken) when a new export may be made, else (the reason, None). With
    `charge` false (the export was paid for by an earlier ask) only storage is checked."""
    from selecta.billing import plans, stripe_sync
    from selecta.identity.schema import users
    from selecta.usage import allowances, quota

    with transaction(engine, workspace_id) as conn:
        if quota.usage(conn, workspace_id).read_only:
            return READ_ONLY, None
        if not charge:
            return None, None
        entitlement = stripe_sync.effective_entitlement(conn, workspace_id)
        plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
        zone = conn.execute(sa.select(users.c.timezone).where(
            users.c.id == created_by)).scalar() if created_by else None
        limit = allowances.limit_for(plan, "export")
        taken = allowances.try_consume(conn, workspace_id, "export", 1, limit,
                                       timezone=zone or "UTC")
    if not taken.ok:
        return USED_UP.format(limit=int(limit or 0)), None
    return None, taken


def _give_back(engine: Engine, workspace_id: str, taken) -> None:
    from selecta.usage import allowances

    with transaction(engine, workspace_id) as conn:
        allowances.give_back(conn, taken)


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
    from selecta.hosted_limits import export_too_long

    too_long = export_too_long(sum(float(part["seconds"]) for part in timeline))
    if too_long:  # said before any job, never a job that runs into its limit (hosted_limits)
        return {"state": "refused", "why": too_long}
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
    taken = None
    # Only a first ask takes one of the plan's exports: a broken job's replacement, or the same
    # export asked again after it failed or was cancelled, was paid for by that first ask.
    paid = old is not None and (broken or str(old["state"]) != "succeeded")
    why, taken = allow_export(engine, workspace_id, created_by, charge=not paid)
    if why is not None:
        return {"state": "refused", "why": why}
    try:
        if broken:
            job_id, refused = hosted_render._make(work, spec, old)
            created = True
        else:
            job_id, refused, created = work.submit_new(spec)
    except Exception:
        if taken is not None:
            _give_back(engine, workspace_id, taken)
        raise
    if taken is not None and (refused or job_id is None or not created):
        # nothing new was made (refused, or another device's press made this export first)
        _give_back(engine, workspace_id, taken)
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


def stored_exports(engine: Engine, workspace_id: str, *, client, buckets) -> dict[str, Any]:
    """Every finished hosted export this workspace still keeps, newest first, each with a
    15-minute download link: `{"exports": [{"id", "created_at", "size_bytes", "seconds",
    "expires_at", "url"}]}`.

    It belongs to `cloud.stored_media`, not the hosted grant (T-20261125-d37b): the grant gates
    new processing, never a customer's access to files they already have, so with hosted
    storage switched off for the account its exports stay downloadable until their plan's
    retention ends them (`storage.export_expiry`). Originals download through
    `GET /api/assets/{id}/playback-url?download=true`, also under `cloud.stored_media`."""
    from selecta.storage.export_expiry import DAY_S, retention_days, shortened_at
    from selecta.work.schema import artifacts

    with transaction(engine, workspace_id) as conn:
        rows = conn.execute(sa.select(
            artifacts.c.id, artifacts.c["keys"], artifacts.c.size_bytes, artifacts.c.created_at,
            artifacts.c.job_id).where(
            artifacts.c.workspace_id == workspace_id, artifacts.c.kind == "export")
            .order_by(artifacts.c.created_at.desc(), artifacts.c.id).limit(200)).all()
        kept = retention_days(conn, workspace_id)
        since = shortened_at(conn, workspace_id, kept[1]) if kept else None
        results = {row.id: row.result for row in conn.execute(sa.select(jobs.c.id, jobs.c.result)
                   .where(jobs.c.workspace_id == workspace_id,
                          jobs.c.id.in_([r.job_id for r in rows if r.job_id])))}
    out = []
    for row in rows:
        key = _first_key(row._mapping["keys"])
        expires = None
        if kept is not None:
            expires = max(float(row.created_at), float(since or 0.0)) + kept[1] * DAY_S
        result = results.get(row.job_id) or {}
        out.append({"id": row.id, "created_at": float(row.created_at),
                    "size_bytes": row.size_bytes, "seconds": result.get("seconds"),
                    "expires_at": expires,
                    "url": _sign(client, buckets, key, workspace_id) if key else None})
    return {"exports": out}


__all__ = ["export_spec", "export_status", "export_timeline", "request_export",
           "stored_exports"]
