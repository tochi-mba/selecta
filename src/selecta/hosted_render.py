"""Hosted Cloud processing: the server runs the local app's engine on uploaded songs.

For an account with the `cloud.hosted_media` grant (ADR-0456), `cloud.hosted_render` turns on:

- **Analysis at upload.** An accepted upload gets an `analyse.song` job (`on_upload_accepted`);
  `prepare_songs` makes the same job for any stored song still missing one (older uploads) and
  replaces a job that can never finish (`hosted_status.needs_new`). A failure that was the
  song's own is tried again only by `retry=True` (the customer's Try again).
- **Song status** (`songs_status`): per song waiting, running, done or failed with a plain
  reason, with totals and a time estimate (from this workspace's own finished jobs) only while
  something is moving.
- **Server mixes.** `plan_mix` orders the analysed songs with the local planner
  (`planner.beam.plan_set`), each recording once (`one_per_recording`: copies and versions of
  one song are planned once), and its planned move per hand-off. `mix_state` then asks for what the
  mix needs: each song's lossless playback file (`work.proxies.prepare`, the same `play.proxy`
  the player uses) and a `seam.render` per hand-off once both analyses exist, with the planned
  move as the style (the worker renders it the local app's way, `workers.engine_seams`). It
  answers with a timeline: song parts cut at each rendered seam's cue points and the seam clips
  between them, each with a short-lived signed link, and the state of every seam.
- **Export** (`hosted_export`): one `export.render` job naming the exact timeline `mix_state`
  answers, which the worker joins as the player plays it.

Every job carries its stored inputs in `input_ref["objects"]`, which is what the worker gateway
signs (and the dev worker reads). Jobs are idempotent by their input hashes, so polling never
duplicates work.
"""

from __future__ import annotations

import hashlib
import json
import re
import tempfile
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta import hosted_analysis_cache, hosted_brain, hosted_caps, hosted_limits, hosted_status
from selecta.config import ANALYSIS_VERSION
from selecta.persistence import db_now, transaction
from selecta.scheduling.policy import Lane
from selecta.seam_kinds import RENDER_VERSION
from selecta.storage.keys import Bucket, original_key, validate_key, workspace_of
from selecta.storage.schema import assets, upload_sessions
from selecta.work.enqueue import JobSpec
from selecta.work.schema import artifacts, jobs

FLAG = "cloud.hosted_render"
ANALYSE, SEAM, EXPORT = "analyse.song", "seam.render", "export.render"
MAX_PLAN_SONGS = 60
WORKER_SEEN_S = 180.0
URL_TTL_S = 900
# Until a workspace has finished analyses of its own, the estimate uses this (seconds per job),
# measured on the dev worker with real 3 to 4 minute songs
# (docs/engineering/cloud-library-walkthrough.md). Transitions have first guesses by kind
# (`hosted_estimate.SEAM_FIRST_GUESS_S`); an export's time comes from its own progress.
FIRST_GUESS_S = {ANALYSE: 20.0}


def _hash(payload: dict[str, Any]) -> str:
    # The worker's own rule (engine_handlers._hash), so a lookup finds what it published.
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def analysis_hash(sha256: str) -> str:
    return _hash({"source_sha256": sha256, "analysis": ANALYSIS_VERSION})


def seam_hash(a_sha256: str, b_sha256: str, style: str | None,
              core: dict[str, str] | None = None) -> str:
    """`core` is what a planner-core seam adds (`workers.engine_core.hash_part`); without it
    the hash is exactly the older one, so every seam made before stays found."""
    return _hash(
        {"a": a_sha256, "b": b_sha256, "style": style, "analysis": ANALYSIS_VERSION,
         "render": RENDER_VERSION, **(core or {})}
    )


def _first_key(keys: Any) -> str | None:
    if isinstance(keys, list) and keys:
        return str(keys[0])
    return str(keys) if isinstance(keys, str) else None


def _songs(conn: Connection, workspace_id: str, ids: Sequence[str] | None = None) -> list[dict]:
    query = (
        sa.select(assets.c.id, assets.c.sha256, assets.c.duration_s, assets.c.format,
                  assets.c.sample_rate, assets.c.channels, assets.c.original_key,
                  upload_sessions.c.display_name)
        .select_from(assets.outerjoin(upload_sessions, sa.and_(
            upload_sessions.c.id == assets.c.id,
            upload_sessions.c.workspace_id == assets.c.workspace_id)))
        .where(assets.c.workspace_id == workspace_id, assets.c.deleted_at.is_(None))
        .order_by(assets.c.created_at, assets.c.id)
    )
    if ids is not None:
        query = query.where(assets.c.id.in_(list(dict.fromkeys(ids))))
    found = [dict(row) for row in conn.execute(query).mappings()]
    if ids is None:
        return found
    by_id = {row["id"]: row for row in found}
    return [by_id[i] for i in ids if i in by_id]


def _artifact(conn: Connection, workspace_id: str, kind: str, input_hash: str):
    return conn.execute(sa.select(artifacts).where(
        artifacts.c.workspace_id == workspace_id, artifacts.c.kind == kind,
        artifacts.c.input_hash == input_hash)).mappings().first()


def _latest_job(conn: Connection, workspace_id: str, kind: str, key: str):
    return conn.execute(sa.select(
        jobs.c.id, jobs.c.state, jobs.c.error_class, jobs.c.error_detail, jobs.c.result,
        jobs.c.progress_done, jobs.c.progress_total, jobs.c.started_at, jobs.c.finished_at,
        jobs.c.input_ref,
    ).where(jobs.c.workspace_id == workspace_id, jobs.c.type == kind,
            jobs.c.idempotency_key == key)
        .order_by(jobs.c.created_at.desc(), jobs.c.id.desc()).limit(1)).mappings().first()


def _unsuccessful(conn: Connection, workspace_id: str, kind: str, key: str) -> int:
    """How many jobs for this work ended failed, quarantined or cancelled."""
    return int(conn.execute(sa.select(sa.func.count()).where(
        jobs.c.workspace_id == workspace_id, jobs.c.type == kind, jobs.c.idempotency_key == key,
        jobs.c.state.in_(("failed", "quarantined", "cancelled")))).scalar_one())


def _state(artifact_row, job_row) -> dict[str, Any]:
    if artifact_row is not None:
        return {"state": "ready"}
    if job_row is None:
        return {"state": "not_started"}
    state = str(job_row["state"])
    if state in ("leased", "running", "validating"):
        state = "running"
    elif state in ("failed", "cancelled", "quarantined", "blocked", "cancel_requested"):
        state = "failed"
    elif state == "succeeded":
        state = "ready"  # its output was evicted or not yet visible; asking again remakes it
    else:
        state = "queued"
    out: dict[str, Any] = {"state": state, "job_id": job_row["id"]}
    if state == "failed":
        # words for the customer, never a worker's traceback (hosted_status.failure_reason)
        out["why"] = hosted_status.failure_reason(job_row)
    return out


def _output(kind: str, input_hash: str) -> dict[str, str]:
    # Where the gateway lets a remote worker write (cloud_ports.signed_outputs): without this
    # declared namespace it refuses the upload slot and the job can never finish.
    return {"kind": kind, "input_hash": input_hash}


def _objects(*keys: str | None) -> list[str]:
    return [key for key in keys if key]


class Work:
    """How this module makes jobs: `submit(spec)` returns (job id, None) or (None, why not)."""

    def __init__(self, store) -> None:
        self.store = store

    def submit(self, spec: JobSpec) -> tuple[str | None, str | None]:
        job_id, refused, _created = self.submit_new(spec)
        return job_id, refused

    def submit_new(self, spec: JobSpec) -> tuple[str | None, str | None, bool]:
        """`submit`, also saying whether this call made the job (False when another request
        made the same job first: two devices pressing Export at once make one job)."""
        admission = self.store.admit(spec)
        if not admission.creates_job:
            return None, getattr(admission, "reason", None) or "Not admitted right now.", False
        made = self.store.enqueue(spec)
        return made.job.id, None, bool(made.created)

    def renew(self, spec: JobSpec, old_job_id: str) -> tuple[str | None, str | None]:
        """A fresh job in place of one that can never finish (`JobStore.replace`): never two
        live jobs for the same work. (None, None) while a worker lets go of the old one."""
        admission = self.store.admit(spec)
        if not admission.creates_job:
            return None, getattr(admission, "reason", None) or "Not admitted right now."
        expected = spec.input_ref["output"]
        made = self.store.replace(
            spec.workspace_id, old_job_id, spec,
            lambda job: not hosted_status.declared_output_ok(job.input_ref, expected))
        return (made.job.id if made is not None else None), None


def _make(work: Work, spec: JobSpec, job) -> tuple[str | None, str | None]:
    """A new job for this work, replacing the latest one when there is one."""
    return work.submit(spec) if job is None else work.renew(spec, job["id"])


def _analysis_spec(workspace_id: str, song: dict, created_by: str | None, lane=Lane.STANDARD):
    key = original_key(workspace_id, song["id"])
    return JobSpec(
        workspace_id=workspace_id, type=ANALYSE, idempotency_key=analysis_hash(song["sha256"]),
        lane=lane, created_by=created_by,
        # the runtime limit follows the song's length (hosted_limits)
        max_run_s=hosted_limits.analysis_run_s(song.get("duration_s")),
        input_ref={"source_key": key, "source_sha256": song["sha256"], "objects": [key],
                   "output": _output("analysis", analysis_hash(song["sha256"]))},
    )


def prepare_songs(engine: Engine, work: Work, workspace_id: str, ids: Sequence[str] | None = None,
                  *, retry: bool = False, created_by: str | None = None) -> dict[str, int]:
    """An analysis job for every stored song that needs one (module notes). Returns counts.

    A song needs one when it has no analysis and no job, or its latest job can never finish
    (`hosted_status.needs_new`: no declared output namespace, cancelled, its file evicted, or
    failed on our side, up to `hosted_status.AUTO_RENEW_LIMIT` jobs). `retry` (the customer's
    Try again) also renews a failure that was the song's own. Songs with the same bytes share
    one analysis and so one job. Safe to call from any number of tabs at once: a replacement
    locks the old job, and the store never holds two live jobs for the same work.
    """
    made = {"queued": 0, "ready": 0, "running": 0, "failed": 0, "refused": 0, "replaced": 0,
            "allowance": 0, "too_long": 0}
    with transaction(engine, workspace_id) as conn:
        wanted, reusable, seen = [], [], set()
        for song in _songs(conn, workspace_id, ids):
            digest = analysis_hash(song["sha256"])
            if digest in seen:
                continue
            seen.add(digest)
            found = _artifact(conn, workspace_id, "analysis", digest)
            if found is not None and hosted_analysis_cache.enabled():
                reusable.append((song, digest, found))
            if found is None and hosted_limits.too_long(song["duration_s"]):
                made["too_long"] += 1  # never a job that would run into its limit and fail
                continue
            job = _latest_job(conn, workspace_id, ANALYSE, digest)
            failures = _unsuccessful(conn, workspace_id, ANALYSE, digest) if job else 0
            why = hosted_status.needs_new(found is not None, job, _output("analysis", digest),
                                          unsuccessful=failures, retry=retry, renew_failed=True)
            if why is not None:
                wanted.append((song, job))
                continue
            state = _state(found, job)["state"]
            made["ready" if state == "ready" else "failed" if state == "failed"
                 else "running"] += 1
    for song, digest, found in reusable:
        hosted_analysis_cache.remember(engine, workspace_id, song, digest, found)
    for song, job in wanted:
        if job is None and hosted_analysis_cache.materialize(
            engine, workspace_id, song["sha256"], analysis_hash(song["sha256"])
        ):
            made["ready"] += 1
            continue
        made[_queue_analysis(engine, work, workspace_id, song, job, created_by)] += 1
    return made


def _queue_analysis(engine: Engine, work: Work, workspace_id: str, song: dict, job,
                    created_by: str | None) -> str:
    """One song's analysis job, paid from the daily allowance only for its first analysis
    (`hosted_caps`). Returns which count of `prepare_songs` it adds to."""
    spec = _analysis_spec(workspace_id, song, created_by)
    taken = None
    if job is None:
        with transaction(engine, workspace_id) as conn:
            paid = hosted_caps.analysis_paid(conn, workspace_id, song["sha256"])
        if not paid:
            taken, _why = hosted_caps.take(engine, workspace_id, hosted_caps.ANALYSIS, 1)
            if taken is None:
                return "allowance"  # waits, with the reason on its row; nothing is dropped
    try:
        if job is None:
            job_id, refused, created = work.submit_new(spec)
        else:
            (job_id, refused), created = work.renew(spec, job["id"]), True
    except Exception:
        hosted_caps.give_back(engine, workspace_id, taken)
        raise
    if taken is not None:
        if created and job_id and not refused:
            hosted_caps.mark_analysis_paid(engine, workspace_id, song["id"])
        else:  # another tab or a retry made it first, or it wasn't admitted: never pay twice
            hosted_caps.give_back(engine, workspace_id, taken)
    if refused:
        return "refused"
    if job_id is None:
        return "running"  # its worker is letting go; the next call replaces it
    return "replaced" if job is not None else "queued"


def _make_paid(engine: Engine, work: Work, spec: JobSpec, job, kind: str,
               amount: float) -> tuple[str | None, bool]:
    """`_make`, taking `amount` of a daily allowance for a first job (none for a renewal).
    Returns (why it wasn't made, whether the allowance was the reason)."""
    if job is not None:
        return _make(work, spec, job)[1], False
    taken, why = hosted_caps.take(engine, spec.workspace_id, kind, amount)
    if taken is None:
        with transaction(engine, spec.workspace_id) as conn:
            other = _latest_job(conn, spec.workspace_id, spec.type, spec.idempotency_key)
        if other is not None and str(other["state"]) not in hosted_status.TERMINAL:
            return None, False  # another tab made this very job a moment ago and paid for it
        return why, True
    try:
        job_id, refused, created = work.submit_new(spec)
    except Exception:
        hosted_caps.give_back(engine, spec.workspace_id, taken)
        raise
    if refused or job_id is None or not created:
        hosted_caps.give_back(engine, spec.workspace_id, taken)
    return refused, False


def on_upload_accepted(engine: Engine, work: Work, workspace_id: str, asset_id: str,
                       created_by: str | None = None) -> None:
    """An accepted upload's analysis job. Never raises: an upload is accepted either way."""
    try:
        prepare_songs(engine, work, workspace_id, [asset_id], created_by=created_by)
    except Exception:  # noqa: BLE001 - the upload stands; Library's prepare picks it up again
        import logging

        logging.getLogger(__name__).exception("Hosted analysis for %s not queued", asset_id)


def _measured(conn: Connection, workspace_id: str, kind: str) -> float:
    """Median seconds the last finished jobs of this type really ran here (`actual_cost_s`, the
    successful attempt alone, so a retried job's lost time doesn't count), or the first guess."""
    took = sorted(float(value) for value in conn.execute(sa.select(jobs.c.actual_cost_s).where(
        jobs.c.workspace_id == workspace_id, jobs.c.type == kind, jobs.c.state == "succeeded",
        jobs.c.actual_cost_s > 0).order_by(jobs.c.finished_at.desc()).limit(25)).scalars())
    return took[len(took) // 2] if took else FIRST_GUESS_S[kind]


def _worker_seen(conn: Connection, pool: str) -> bool:
    """Whether a worker of this pool checked in within `WORKER_SEEN_S`. Queued work has no time
    limit (it waits for a worker however long that takes), so with none seen an estimate would
    be a promise nobody keeps: the page says it is waiting for a worker instead."""
    from selecta.work import fleet

    return fleet.pool_slots(conn, pool, db_now(conn) - WORKER_SEEN_S) > 0


def songs_status(engine: Engine, workspace_id: str) -> dict[str, Any]:
    """Where every stored song's analysis stands, for the hosted card.

    Answers::

        {"songs": [{"asset_id", "name", "duration_s",
                    "status": {"state": "waiting" | "running" | "done" | "failed",
                               "reason": str | None, "job_id": str | None,
                               "can_retry": bool},
                    "analysis": {"state": "ready" | "running" | "queued" | "failed"
                                          | "not_started", "job_id"?, "why"?, "bpm"?,
                                 "camelot"?},
                    "same_file_as"?: [asset_id, ...], "same_recording_as"?: [asset_id, ...]}],
         "totals": {"waiting", "running", "done", "failed", "total"},
         "moving": bool, "waiting_for": "worker" | "retry" | None,
         "counts": {"ready", "running", "queued", "failed", "not_started"},
         "estimate_s": int | None, "seconds_each": float, "worker_seen": bool, "total": int}

    `status` and `totals` are the current shape; `analysis` and `counts` are the first one,
    kept for pages that read it. `reason` is written for the customer (a failure's cause in
    plain words, or what a waiting song waits for), never a worker's traceback. `estimate_s` is
    null whenever nothing is moving: no worker of the analysis pool checked in within
    `WORKER_SEEN_S` (`waiting_for` "worker"), or every unfinished song waits on a retry's
    backoff or a hold (`waiting_for` "retry"). Queued work never expires: it waits for a worker
    however long that takes, and operators hear of it (`work.queue_health`). Songs with the same
    bytes share one analysis; each names the others in `same_file_as`. `same_recording_as` names
    every other upload of the same recording (copies, or another file of it: `recording_of`);
    a planned mix uses only the first.
    """
    with transaction(engine, workspace_id) as conn:
        songs = _songs(conn, workspace_id)
        worker = _worker_seen(conn, "cpu-heavy")
        each = _measured(conn, workspace_id, ANALYSE)
        # today's analysis allowance used up: songs with no job yet say so (hosted_caps)
        paused = hosted_caps.used_up(conn, workspace_id, hosted_caps.ANALYSIS)
        out, by_digest = [], {}
        for song in songs:
            digest = analysis_hash(song["sha256"])
            found = _artifact(conn, workspace_id, "analysis", digest)
            job = _latest_job(conn, workspace_id, ANALYSE, digest)
            state = _state(found, job)
            result = (job["result"] if job is not None else None) or {}
            if state["state"] == "ready":
                state.update({"bpm": result.get("bpm"), "camelot": result.get("camelot")})
            status = hosted_status.customer_status(
                found is not None, job, worker_seen=worker,
                not_started=paused["why"] if paused else None)
            long_why = None if found is not None else hosted_limits.too_long(song["duration_s"])
            if long_why:
                status = {"state": "failed", "reason": long_why, "job_id": None,
                          "can_retry": False}
                state = {"state": "failed", "why": long_why}
            entry = {"asset_id": song["id"], "name": song["display_name"] or "Untitled",
                     "duration_s": song["duration_s"], "status": status, "analysis": state}
            by_digest.setdefault(digest, []).append(entry)
            out.append(entry)
    for twins in by_digest.values():
        for entry in twins if len(twins) > 1 else ():
            entry["same_file_as"] = [t["asset_id"] for t in twins if t is not entry]
    # copies and other files of one recording: a mix plans the first of them only
    owner = recording_of(songs)
    groups: dict[str, list[str]] = {}
    for song in songs:
        groups.setdefault(owner[song["id"]], []).append(song["id"])
    for entry in out:
        others = [i for i in groups[owner[entry["asset_id"]]] if i != entry["asset_id"]]
        if others:
            entry["same_recording_as"] = others
    counts = {name: sum(1 for s in out if s["analysis"]["state"] == name)
              for name in ("ready", "running", "queued", "failed", "not_started")}
    totals = {name: sum(1 for s in out if s["status"]["state"] == name)
              for name in ("waiting", "running", "done", "failed")}
    totals["total"] = len(out)
    in_line = sum(1 for s in out if s["status"]["reason"] == hosted_status.IN_LINE)
    moving = worker and totals["running"] + in_line > 0
    unfinished = totals["running"] + totals["waiting"]
    waiting_for = None if moving or not unfinished else ("retry" if worker else "worker")
    found = {"songs": out, "totals": totals, "moving": moving, "waiting_for": waiting_for,
             "counts": counts, "seconds_each": round(each, 1),
             "estimate_s": round(unfinished * each) if moving else None,
             "worker_seen": worker, "total": len(out)}
    if paused and any(s["status"]["reason"] == paused["why"] for s in out):
        # {"kind", "limit", "used", "resets_at", "why"}: songs wait for tomorrow's allowance
        found["allowance_used"] = paused
    return found


def song_status(engine: Engine, workspace_id: str, asset_id: str) -> dict[str, Any] | None:
    """One song's entry from `songs_status`, or None when this workspace has no such song."""
    for song in songs_status(engine, workspace_id)["songs"]:
        if song["asset_id"] == asset_id:
            return song
    return None


# --- server mixes --------------------------------------------------------------------------------


def _read_analysis(read_object: Callable[[str, Path], Path], key: str, folder: Path) -> Path:
    return read_object(key, folder / (hashlib.sha256(key.encode()).hexdigest()[:16] + ".npz"))


_TRACK_NUMBER = re.compile(r"^\s*\d{1,3}\s*[.)_-]\s*")


def title_artist(display_name: str | None) -> tuple[str, str]:
    """(title, artist) as an import reads "001. Artist - Title.mp3"; artist "" when unnamed."""
    stem = Path(display_name or "").stem
    artist, _, title = _TRACK_NUMBER.sub("", stem).rpartition(" - ")
    return (title or stem).strip(), artist.strip()


def one_per_recording(ready: Sequence[tuple[dict, Any]]) -> list[tuple[dict, Any]]:
    """The first upload of each recording, in upload order (to-do T-20261125-ed08).

    The duplicate-songs rule of the local catalogue (ADR-0469 amendment 2,
    `local_media.versions`): identical bytes are always one recording; a different file is the
    same recording when its normalised title and artist match and its length is within
    `VERSION_TOLERANCE_S` (a remix or extended mix differs by more and stays its own song). A
    hosted upload has no tags here, so title and artist come from its file name, and only a name
    that has both counts (two "Untitled" files are not one song).
    """
    first = recording_of([song for song, _extra in ready])
    return [(song, extra) for song, extra in ready if first[song["id"]] == song["id"]]


def recording_of(songs: Sequence[dict]) -> dict[str, str]:
    """Each song's id mapped to the id of the first song (in this order) of its recording, by
    the rule `one_per_recording` describes."""
    from selecta.local_media.versions import name_key, same_length

    first: dict[str, str] = {}
    by_content: dict[str, str] = {}
    by_name: dict[tuple[str, str], list[tuple[str, Any]]] = {}
    for song in songs:
        title, artist = title_artist(song.get("display_name"))
        key = name_key(title, artist) if title and artist else None
        found = by_content.get(song["sha256"])
        if found is None and key is not None:
            found = next((owner for owner, length in by_name.get(key, ())
                          if same_length(length, song.get("duration_s"))), None)
        if found is None:
            found = song["id"]
            if key is not None:
                by_name.setdefault(key, []).append((found, song.get("duration_s")))
        by_content.setdefault(song["sha256"], found)
        first[song["id"]] = found
    return first


def planning_pool(ready: Sequence[tuple[dict, Any]], *, pick=None) -> list[tuple[dict, Any]]:
    """The songs a plan chooses from: every recording when there are `MAX_PLAN_SONGS` or fewer,
    else that many picked at random, so every song of a large library can reach a mix (the
    first 60 uploads used to be the only ones ever planned) and each Make another mix picks
    again. Kept in upload order. `pick` is `random.sample`'s shape, for tests."""
    import random

    if len(ready) <= MAX_PLAN_SONGS:
        return list(ready)
    chosen = set((pick or random.sample)(range(len(ready)), MAX_PLAN_SONGS))
    return [item for number, item in enumerate(ready) if number in chosen]


def plan_mix(engine: Engine, workspace_id: str, read_object: Callable[[str, Path], Path],
             ids: Sequence[str] | None = None, count: int = 12,
             pool: dict[str, int] | None = None, artifacts=None) -> list[dict[str, Any]]:
    """The local planner's order and moves for the analysed songs, each recording once
    (`one_per_recording`; module notes), chosen from `planning_pool`. With `pool`, it is
    filled with `considered` (the songs the plan chose from) and `analysed` (every analysed
    recording), so the page can say plainly when a large library was sampled.

    `artifacts` is the engine store's artifact store: with it, each analysed song's facts are
    kept (`hosted_facts`, `cloud.brain`), and with `cloud.hosted_brain` the order is the planner
    core's from those facts (`hosted_brain.plan_order`) whenever it can plan one."""
    from selecta import flags, hosted_facts
    from selecta.planner.beam import plan_set
    from selecta.workers.engine_handlers import song_from_analysis

    with transaction(engine, workspace_id) as conn:
        songs = _songs(conn, workspace_id, ids)
        ready, audio_ids = [], {}
        for song in songs:
            digest = analysis_hash(song["sha256"])
            row = _artifact(conn, workspace_id, "analysis", digest)
            key = _first_key(row["keys"]) if row is not None else None
            if key:
                ready.append((song, key))
                if artifacts is not None and flags.on(hosted_facts.FLAG):
                    job = _latest_job(conn, workspace_id, ANALYSE, digest)
                    audio_ids[song["id"]] = ((job["result"] if job is not None else None)
                                             or {}).get("audio_id")
    recordings = one_per_recording(ready)
    ready = planning_pool(recordings)
    if pool is not None:
        pool.update(considered=len(ready), analysed=len(recordings))
    if len(ready) < 2:
        return [{"asset_id": song["id"], "move": None} for song, _key in ready]
    hosted_facts.keep(engine, workspace_id,
                      [(song["sha256"], key, audio_ids.get(song["id"])) for song, key in ready],
                      read_object, artifacts)
    if artifacts is not None and hosted_brain.on():
        planned_core = hosted_brain.plan_order(
            engine, workspace_id, [song for song, _key in ready], count, artifacts)
        if planned_core:
            return planned_core
    infos, by_number = [], {}
    with tempfile.TemporaryDirectory(prefix="selecta-plan-") as folder:
        for number, (song, key) in enumerate(ready, start=1):
            name = song["display_name"] or "Untitled"
            artist, _, title = name.rpartition(" - ")
            side = {"title": Path(title or name).stem, "artist": artist or None}
            path = _read_analysis(read_object, key, Path(folder))
            infos.append(song_from_analysis(path, Path(song["original_key"]), number, side))
            by_number[number] = song["id"]
    # A song with nowhere to leave or land (a short clip has no exit cue) can't join a mix: the
    # planner would start there and stop at one song. Try the next start when a plan is short.
    usable = [song for song in infos if song.exit_cues() and song.entry_cues()]
    planned: list = []
    for start in usable[:6]:
        tried = plan_set(usable, start_id=start.id, count=min(count, len(usable)), seed=None)
        if len(tried) > len(planned):
            planned = tried
        if len(planned) >= min(count, len(usable)):
            break
    return [{"asset_id": by_number[item.song.id], "move": item.transition} for item in planned]


_LOUDNESS: dict[str, tuple[float, float]] = {}


def _loudness(result: dict, analysis_key: str | None,
              read_object: Callable[[str, Path], Path] | None) -> tuple[float, float] | None:
    """(LUFS, peak dB) of a song: from its analysis job's result, or, for an analysis made before
    the result carried them, read once from the stored analysis file."""
    lufs, peak = result.get("lufs"), result.get("peak_db")
    if isinstance(lufs, int | float) and isinstance(peak, int | float):
        return float(result["lufs"]), float(result["peak_db"])
    if not analysis_key or read_object is None:
        return None
    if analysis_key not in _LOUDNESS:
        import numpy as np

        with tempfile.TemporaryDirectory(prefix="selecta-loudness-") as folder:
            path = read_object(analysis_key, Path(folder) / "analysis.npz")
            with np.load(path) as data:
                summary = json.loads(str(data["summary"]))
        _LOUDNESS[analysis_key] = (float(summary["lufs"]), float(summary["peak_db"]))
    return _LOUDNESS[analysis_key]


def gain_db(loudness: tuple[float, float] | None) -> float:
    """The level the local app plays a song at in a mix (`SongInfo.gain_db`). A rendered seam
    has it built in, so the song parts around it must be played at it too, or every join steps
    by several decibels (measured: about 6 dB on chart songs).

    It never lifts a song's loudest sample over `PEAK_CEILING_DB` (-1 dBFS), so a quiet song
    given positive gain can't clip. A near-silent file (a sample peak around -120 dB, a loudness
    of minus infinity) would ask for over 100 dB of gain; the level is held inside
    `GAIN_RANGE_DB`, the range an export accepts, so such a song plays at most 24 dB up and its
    mix can still be exported."""
    import math

    from selecta.analysis.song import PEAK_CEILING_DB, TARGET_LUFS

    if loudness is None:
        return 0.0
    lufs, peak = loudness
    wanted = min(TARGET_LUFS - lufs, PEAK_CEILING_DB - peak)
    if not math.isfinite(wanted):
        return 0.0
    low, high = GAIN_RANGE_DB
    return round(float(min(high, max(low, wanted))), 3)


GAIN_RANGE_DB = (-60.0, 24.0)
"""The song levels an export accepts (`workers.export_join.check_timeline`)."""


def _sign(client, buckets, key: str, workspace_id: str) -> str | None:
    try:
        bucket = validate_key(key)
    except ValueError:
        return None
    if workspace_of(key) != workspace_id:
        return None
    name = {Bucket.DERIVED: buckets.derived, Bucket.ORIGINALS: buckets.originals,
            Bucket.EXPORTS: buckets.exports}.get(bucket)
    return client.presign_get(name, key, URL_TTL_S) if name else None


def _cues(row) -> tuple[float, float, float] | None:
    settings = ((row["provenance"] or {}).get("settings") or {}) if row is not None else {}
    cues = settings.get("cues")
    try:
        return float(cues["a_source_start"]), float(cues["b_source_end"]), float(cues["seconds"])
    except (KeyError, TypeError, ValueError):
        return None


def _seam_spec(workspace_id: str, a: dict, b: dict, move: str | None, lane, created_by,
               facts: tuple[dict, dict] | None = None):
    """`facts` (each side's correction and lyrics, `hosted_brain.side_facts`) marks a
    planner-core seam (`cloud.hosted_brain`); without it the job is exactly the older one."""
    def side(song: dict, analysis_key: str) -> dict:
        name = song["display_name"] or "Untitled"
        artist, _, title = name.rpartition(" - ")
        return {"source_key": original_key(workspace_id, song["id"]),
                "source_sha256": song["sha256"], "analysis_key": analysis_key,
                "title": Path(title or name).stem[:120], "artist": (artist or None)}

    sa_, sb = side(a, a["analysis_key"]), side(b, b["analysis_key"])
    core = None
    if facts is not None:
        from selecta.workers.engine_core import MARK, hash_part

        sa_["facts"], sb["facts"] = facts
        core = hash_part(sa_, sb)
    digest = seam_hash(a["sha256"], b["sha256"], move, core)
    input_ref = {"style": move, "a": sa_, "b": sb, "objects": _objects(
        sa_["source_key"], sa_["analysis_key"], sb["source_key"], sb["analysis_key"]),
        "output": _output("seam", digest)}
    if core is not None:
        input_ref["brain"] = MARK
    return JobSpec(
        workspace_id=workspace_id, type=SEAM, lane=lane, created_by=created_by,
        idempotency_key=f"hosted-seam:{digest}", input_ref=input_ref,
    )


def _core_part(facts: dict[str, dict] | None, a: dict, b: dict):
    """(the seam's hash part, its sides' facts) for a planner-core seam, or (None, None)."""
    if facts is None:
        return None, None
    from selecta.workers.engine_core import hash_part

    pair = (facts.get(a["sha256"].lower()) or {}, facts.get(b["sha256"].lower()) or {})
    return hash_part({"facts": pair[0]}, {"facts": pair[1]}), pair


def mix_state(engine: Engine, work: Work, workspace_id: str, order: Sequence[dict[str, Any]],
              *, client, buckets, created_by: str | None = None,
              retry: bool = False,
              read_object: Callable[[str, Path], Path] | None = None,
              files: bool = False) -> dict[str, Any]:
    """Ask for what the mix needs and say where it stands (module notes).

    Answers `parts`, `seams`, `counts`, `complete`, `worker_seen` and the time left:
    `estimate_s` (seconds, or null when it would be a guess), `estimate_why` (null, `no_worker`,
    `overrunning` or `busy`) and `work` (`queued`, `running`, `slots`), by `hosted_estimate`.
    With `files`, each part also carries `_file` (`key`, `sha256`): what an export joins.
    """
    from selecta import hosted_estimate
    from selecta import hosted_pairs as pairs
    from selecta.work import fleet

    ids = [str(item["asset_id"]) for item in order]
    moves = [item.get("move") if isinstance(item.get("move"), str) else None for item in order]
    # each hand-off is asked for as `hosted_pairs.pair_state` asks for one
    brain, playback = pairs.prepared(engine, work, workspace_id, ids, retry=retry,
                                     created_by=created_by)
    with transaction(engine, workspace_id) as conn:
        songs, analysed = pairs.read_songs(conn, workspace_id, ids, playback, read_object)
        seams, wanted, rendered = [], [], []
        for index in range(len(songs) - 1):
            seam, want, made = pairs.look(conn, workspace_id, index, songs[index],
                                          songs[index + 1], moves[index + 1], brain, retry)
            seams.append(seam)
            wanted += [want] if want is not None else []
            rendered += [made] if made is not None else []
        slots = fleet.pool_slots(conn, "cpu-heavy", db_now(conn) - WORKER_SEEN_S)
        durations = hosted_estimate.Durations(conn, workspace_id, FIRST_GUESS_S)
    pairs.keep_in_store(engine, workspace_id, analysed, rendered, read_object, client, buckets)
    capped = False
    for want in wanted:
        lane = Lane.INTERACTIVE if want[0] < 2 else Lane.STANDARD  # the next two first
        refused, by_allowance = pairs.make(engine, work, workspace_id, want, lane, created_by,
                                           durations)
        capped = capped or by_allowance
        if refused:
            seams[want[0]].update(state="refused", why=refused)
    timeline = _timeline(workspace_id, songs, seams, playback, client, buckets, files=files)
    with transaction(engine, workspace_id) as conn:
        # after the jobs above are made, so they count; hand-offs still waiting for analysis
        # count as transitions to come
        later = [seam["planned_move"] for seam in seams
                 if seam["state"] == "waiting_for_analysis"]
        left = hosted_estimate.mix_estimate(
            conn, workspace_id, hosted_estimate.Durations(conn, workspace_id, FIRST_GUESS_S),
            slots=slots, now=db_now(conn), later_seams=later)
        paused = hosted_caps.used_up(conn, workspace_id, hosted_caps.TRANSITIONS,
                                     refused=True) if capped else None
    if timeline["complete"]:
        left = {**left, "estimate_s": 0, "estimate_why": None}
    extra = {"allowance_used": paused} if paused else {}
    return {**timeline, **left, "worker_seen": slots > 0, **extra}


def _timeline(workspace_id, songs, seams, playback, client, buckets, *, files=False):
    from selecta.hosted_pairs import file_key as file_of

    parts: list[dict[str, Any]] = []
    start = 0.0
    for index, song in enumerate(songs):
        file_key = file_of(workspace_id, song["id"], playback.get(song["id"]))
        seam = seams[index] if index < len(seams) else None
        cues = _cues(seam["row"]) if seam is not None and seam["state"] == "ready" else None
        end = float(song["duration_s"] or 0.0)
        if cues is not None and start < cues[0] <= end:
            end = cues[0]
        else:
            cues = None
        parts.append({"kind": "song", "asset_id": song["id"], "name": song["display_name"],
                      "from_s": round(start, 4), "seconds": round(max(0.0, end - start), 4),
                      "gain_db": gain_db(song.get("loudness")),
                      "url": _sign(client, buckets, file_key, workspace_id) if file_key else None,
                      "file": "lossless" if file_key else "preparing"})
        if files:
            parts[-1]["_file"] = {"key": file_key, "sha256": song.get("file_sha256")}
        if cues is not None:
            key = _first_key(seam["row"]["keys"])
            parts.append({"kind": "seam", "index": index, "from_s": 0.0,
                          "seconds": round(cues[2], 4), "move": seam.get("move"),
                          "url": _sign(client, buckets, key, workspace_id) if key else None})
            if files:
                parts[-1]["_file"] = {"key": key, "sha256": seam["row"]["checksum"]}
            start = cues[1]
        else:
            start = 0.0
    public = [{k: v for k, v in seam.items() if k != "row"} for seam in seams]
    ready = sum(1 for seam in seams if seam["state"] == "ready")
    analysed = sum(1 for song in songs if song.get("analysis_key"))
    failed = sum(1 for seam in seams if seam["state"] in ("failed", "refused"))
    # a hand-off whose render failed plays as the two songs back to back, said on the page, so
    # one failure never keeps the rest of the mix from playing
    waiting = len(seams) - ready - failed
    return {
        "parts": parts, "seams": public,
        "counts": {"seams_ready": ready, "seams_failed": failed, "seams": len(seams),
                   "songs_analysed": analysed,
                   "songs": len(songs),
                   "files_ready": sum(1 for p in parts if p["kind"] == "song" and p["url"])},
        "complete": waiting == 0 and all(p["url"] for p in parts),
    }


__all__ = [
    "FLAG", "Work", "analysis_hash", "mix_state", "on_upload_accepted", "plan_mix",
    "prepare_songs", "seam_hash", "song_status", "songs_status",
]
