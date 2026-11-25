"""Hosted Cloud processing: the server runs the local app's engine on uploaded songs.

For an account with the `cloud.hosted_media` grant (ADR-0456), `cloud.hosted_render` turns on:

- **Analysis at upload.** An accepted upload gets an `analyse.song` job (`on_upload_accepted`);
  `prepare_songs` makes the same job for any stored song still missing one (older uploads). A
  failed analysis is never retried by itself: `retry=True` (the customer's Try again) does it.
- **Song status** (`songs_status`): per song, analysis queued, running, ready (tempo, key) or
  failed (and why), with counts and a time estimate from this workspace's own finished jobs.
- **Server mixes.** `plan_mix` orders the analysed songs with the local planner
  (`planner.beam.plan_set`) and its planned move per hand-off. `mix_state` then asks for what the
  mix needs: each song's lossless playback file (`work.proxies.prepare`, the same `play.proxy`
  the player uses) and a `seam.render` per hand-off once both analyses exist, with the planned
  move as the style (the worker renders it the local app's way, `workers.engine_seams`). It
  answers with a timeline: song parts cut at each rendered seam's cue points and the seam clips
  between them, each with a short-lived signed link, and the state of every seam.
- **Export** (`request_export`): one `export.render` job for the mix's songs.

Every job carries its stored inputs in `input_ref["objects"]`, which is what the worker gateway
signs (and the dev worker reads). Jobs are idempotent by their input hashes, so polling never
duplicates work.
"""

from __future__ import annotations

import hashlib
import json
import tempfile
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

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
URL_TTL_S = 900
# Until a workspace has finished jobs of its own, the estimate uses these (seconds per job),
# measured on the dev worker with real 3 to 4 minute songs
# (docs/engineering/hosted-mode-walkthrough.md).
FIRST_GUESS_S = {ANALYSE: 20.0, SEAM: 25.0, "play.proxy": 3.0, EXPORT: 240.0}


def _hash(payload: dict[str, Any]) -> str:
    # The worker's own rule (engine_handlers._hash), so a lookup finds what it published.
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def analysis_hash(sha256: str) -> str:
    return _hash({"source_sha256": sha256, "analysis": ANALYSIS_VERSION})


def seam_hash(a_sha256: str, b_sha256: str, style: str | None) -> str:
    return _hash(
        {"a": a_sha256, "b": b_sha256, "style": style, "analysis": ANALYSIS_VERSION,
         "render": RENDER_VERSION}
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
    ).where(jobs.c.workspace_id == workspace_id, jobs.c.type == kind,
            jobs.c.idempotency_key == key)
        .order_by(jobs.c.created_at.desc(), jobs.c.id.desc()).limit(1)).mappings().first()


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
        out["why"] = (job_row["error_detail"] or "").strip()[:240] or "It stopped part way."
    return out


def _objects(*keys: str | None) -> list[str]:
    return [key for key in keys if key]


class Work:
    """How this module makes jobs: `submit(spec)` returns (job id, None) or (None, why not)."""

    def __init__(self, store) -> None:
        self.store = store

    def submit(self, spec: JobSpec) -> tuple[str | None, str | None]:
        admission = self.store.admit(spec)
        if not admission.creates_job:
            return None, getattr(admission, "reason", None) or "Not admitted right now."
        made = self.store.enqueue(spec)
        return made.job.id, None


def _analysis_spec(workspace_id: str, song: dict, created_by: str | None, lane=Lane.STANDARD):
    key = original_key(workspace_id, song["id"])
    return JobSpec(
        workspace_id=workspace_id, type=ANALYSE, idempotency_key=analysis_hash(song["sha256"]),
        lane=lane, created_by=created_by,
        input_ref={"source_key": key, "source_sha256": song["sha256"], "objects": [key]},
    )


def prepare_songs(engine: Engine, work: Work, workspace_id: str, ids: Sequence[str] | None = None,
                  *, retry: bool = False, created_by: str | None = None) -> dict[str, int]:
    """Analysis jobs for stored songs that have none (module notes). Returns counts."""
    made = {"queued": 0, "ready": 0, "running": 0, "failed": 0, "refused": 0}
    with transaction(engine, workspace_id) as conn:
        songs = _songs(conn, workspace_id, ids)
        wanted = []
        for song in songs:
            digest = analysis_hash(song["sha256"])
            state = _state(_artifact(conn, workspace_id, "analysis", digest),
                           _latest_job(conn, workspace_id, ANALYSE, digest))["state"]
            if state == "ready" or state in ("queued", "running"):
                made["ready" if state == "ready" else "running"] += 1
            elif state == "failed" and not retry:
                made["failed"] += 1
            else:
                wanted.append(song)
    for song in wanted:
        _job, refused = work.submit(_analysis_spec(workspace_id, song, created_by))
        made["refused" if refused else "queued"] += 1
    return made


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


def songs_status(engine: Engine, workspace_id: str) -> dict[str, Any]:
    with transaction(engine, workspace_id) as conn:
        songs = _songs(conn, workspace_id)
        out = []
        for song in songs:
            digest = analysis_hash(song["sha256"])
            found = _artifact(conn, workspace_id, "analysis", digest)
            job = _latest_job(conn, workspace_id, ANALYSE, digest)
            state = _state(found, job)
            result = (job["result"] if job is not None else None) or {}
            if state["state"] == "ready":
                state.update({"bpm": result.get("bpm"), "camelot": result.get("camelot")})
            out.append({"asset_id": song["id"], "name": song["display_name"] or "Untitled",
                        "duration_s": song["duration_s"], "analysis": state})
        each = _measured(conn, workspace_id, ANALYSE)
    counts = {name: sum(1 for s in out if s["analysis"]["state"] == name)
              for name in ("ready", "running", "queued", "failed", "not_started")}
    left = counts["running"] + counts["queued"]
    return {"songs": out, "counts": counts, "seconds_each": round(each, 1),
            "estimate_s": round(left * each), "total": len(out)}


# --- server mixes --------------------------------------------------------------------------------


def _read_analysis(read_object: Callable[[str, Path], Path], key: str, folder: Path) -> Path:
    return read_object(key, folder / (hashlib.sha256(key.encode()).hexdigest()[:16] + ".npz"))


def plan_mix(engine: Engine, workspace_id: str, read_object: Callable[[str, Path], Path],
             ids: Sequence[str] | None = None, count: int = 12) -> list[dict[str, Any]]:
    """The local planner's order and moves for the analysed songs (module notes)."""
    from selecta.planner.beam import plan_set
    from selecta.workers.engine_handlers import song_from_analysis

    with transaction(engine, workspace_id) as conn:
        songs = _songs(conn, workspace_id, ids)
        ready = []
        for song in songs:
            row = _artifact(conn, workspace_id, "analysis", analysis_hash(song["sha256"]))
            key = _first_key(row["keys"]) if row is not None else None
            if key:
                ready.append((song, key))
    ready = ready[:MAX_PLAN_SONGS]
    if len(ready) < 2:
        return [{"asset_id": song["id"], "move": None} for song, _key in ready]
    infos, by_number = [], {}
    with tempfile.TemporaryDirectory(prefix="selecta-plan-") as folder:
        for number, (song, key) in enumerate(ready, start=1):
            name = song["display_name"] or "Untitled"
            artist, _, title = name.rpartition(" - ")
            side = {"title": Path(title or name).stem, "artist": artist or None}
            path = _read_analysis(read_object, key, Path(folder))
            infos.append(song_from_analysis(path, Path(song["original_key"]), number, side))
            by_number[number] = song["id"]
    planned = plan_set(infos, count=min(count, len(infos)), seed=None)
    return [{"asset_id": by_number[item.song.id], "move": item.transition} for item in planned]


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


def _seam_spec(workspace_id: str, a: dict, b: dict, move: str | None, lane, created_by):
    def side(song: dict, analysis_key: str) -> dict:
        name = song["display_name"] or "Untitled"
        artist, _, title = name.rpartition(" - ")
        return {"source_key": original_key(workspace_id, song["id"]),
                "source_sha256": song["sha256"], "analysis_key": analysis_key,
                "title": Path(title or name).stem[:120], "artist": (artist or None)}

    sa_, sb = side(a, a["analysis_key"]), side(b, b["analysis_key"])
    return JobSpec(
        workspace_id=workspace_id, type=SEAM, lane=lane, created_by=created_by,
        idempotency_key=f"hosted-seam:{seam_hash(a['sha256'], b['sha256'], move)}",
        input_ref={"style": move, "a": sa_, "b": sb, "objects": _objects(
            sa_["source_key"], sa_["analysis_key"], sb["source_key"], sb["analysis_key"])},
    )


def mix_state(engine: Engine, work: Work, workspace_id: str, order: Sequence[dict[str, Any]],
              *, client, buckets, created_by: str | None = None,
              retry: bool = False) -> dict[str, Any]:
    """Ask for what the mix needs and say where it stands (module notes)."""
    from selecta.work import proxies

    ids = [str(item["asset_id"]) for item in order]
    moves = [item.get("move") if isinstance(item.get("move"), str) else None for item in order]
    prepare_songs(engine, work, workspace_id, ids, retry=retry, created_by=created_by)
    playback = {p.asset_id: p for p in proxies.prepare(
        work.store, workspace_id, ids, need="mix", created_by=created_by)}
    with transaction(engine, workspace_id) as conn:
        by_id = {song["id"]: song for song in _songs(conn, workspace_id, ids)}
        songs = [by_id[i] for i in ids if i in by_id]
        for song in songs:
            row = _artifact(conn, workspace_id, "analysis", analysis_hash(song["sha256"]))
            song["analysis_key"] = _first_key(row["keys"]) if row is not None else None
        seams, wanted = [], []
        for index in range(len(songs) - 1):
            a, b, move = songs[index], songs[index + 1], moves[index + 1]
            digest = seam_hash(a["sha256"], b["sha256"], move)
            row = _artifact(conn, workspace_id, "seam", digest)
            job = _latest_job(conn, workspace_id, SEAM, f"hosted-seam:{digest}")
            state = _state(row, job)
            if row is None and not (a["analysis_key"] and b["analysis_key"]):
                state = {"state": "waiting_for_analysis"}
            elif state["state"] in ("not_started", "ready") or (
                retry and state["state"] == "failed"
            ):
                if row is None:
                    wanted.append((index, a, b, move))
                    state = {"state": "queued"}
            result = (job["result"] if job is not None else None) or {}
            seams.append({"index": index, "planned_move": move, **state, "row": row,
                          "move": result.get("move"), "passed": result.get("audit_passed"),
                          "fell_back": result.get("fell_back"), "checks": result.get("checks")})
        each_seam = _measured(conn, workspace_id, SEAM)
        each_analysis = _measured(conn, workspace_id, ANALYSE)
    for index, a, b, move in wanted:
        lane = Lane.INTERACTIVE if index < 2 else Lane.STANDARD
        _job, refused = work.submit(_seam_spec(workspace_id, a, b, move, lane, created_by))
        if refused:
            seams[index].update(state="refused", why=refused)
    return _timeline(workspace_id, songs, seams, playback, client, buckets,
                     each_seam, each_analysis)


def _timeline(workspace_id, songs, seams, playback, client, buckets, each_seam, each_analysis):
    parts: list[dict[str, Any]] = []
    start = 0.0
    for index, song in enumerate(songs):
        prepared = playback.get(song["id"])
        if prepared is not None and prepared.status == "direct":
            file_key = original_key(workspace_id, song["id"])
        elif prepared is not None and prepared.status == "ready":
            file_key = _first_key(prepared.keys)
        else:
            file_key = None
        seam = seams[index] if index < len(seams) else None
        cues = _cues(seam["row"]) if seam is not None and seam["state"] == "ready" else None
        end = float(song["duration_s"] or 0.0)
        if cues is not None and start < cues[0] <= end:
            end = cues[0]
        else:
            cues = None
        parts.append({"kind": "song", "asset_id": song["id"], "name": song["display_name"],
                      "from_s": round(start, 4), "seconds": round(max(0.0, end - start), 4),
                      "url": _sign(client, buckets, file_key, workspace_id) if file_key else None,
                      "file": "lossless" if file_key else "preparing"})
        if cues is not None:
            key = _first_key(seam["row"]["keys"])
            parts.append({"kind": "seam", "index": index, "from_s": 0.0,
                          "seconds": round(cues[2], 4), "move": seam.get("move"),
                          "url": _sign(client, buckets, key, workspace_id) if key else None})
            start = cues[1]
        else:
            start = 0.0
    public = [{k: v for k, v in seam.items() if k != "row"} for seam in seams]
    ready = sum(1 for seam in seams if seam["state"] == "ready")
    analysed = sum(1 for song in songs if song.get("analysis_key"))
    waiting = len(seams) - ready
    return {
        "parts": parts, "seams": public,
        "counts": {"seams_ready": ready, "seams": len(seams), "songs_analysed": analysed,
                   "songs": len(songs),
                   "files_ready": sum(1 for p in parts if p["kind"] == "song" and p["url"])},
        "estimate_s": round(waiting * each_seam + (len(songs) - analysed) * each_analysis),
        "complete": waiting == 0 and all(p["url"] for p in parts),
    }


def request_export(engine: Engine, work: Work, workspace_id: str, ids: Iterable[str],
                   created_by: str | None = None) -> dict[str, Any]:
    """One `export.render` job for these songs once all are analysed."""
    ids = list(ids)
    with transaction(engine, workspace_id) as conn:
        songs = _songs(conn, workspace_id, ids)
        sides = []
        for song in songs:
            row = _artifact(conn, workspace_id, "analysis", analysis_hash(song["sha256"]))
            if row is None:
                return {"state": "waiting_for_analysis"}
            name = song["display_name"] or "Untitled"
            artist, _, title = name.rpartition(" - ")
            sides.append({"source_key": original_key(workspace_id, song["id"]),
                          "source_sha256": song["sha256"], "analysis_key": _first_key(row["keys"]),
                          "title": Path(title or name).stem[:120], "artist": artist or None})
    if len(sides) < 2:
        return {"state": "refused", "why": "An export needs at least two songs."}
    objects = [key for side in sides for key in (side["source_key"], side["analysis_key"])]
    digest = _hash({"songs": [side["source_sha256"] for side in sides], "kind": "hosted-export"})
    job_id, refused = work.submit(JobSpec(
        workspace_id=workspace_id, type=EXPORT, idempotency_key=f"hosted-export:{digest}",
        lane=Lane.STANDARD, created_by=created_by, input_ref={"songs": sides, "objects": objects}))
    if refused:
        return {"state": "refused", "why": refused}
    return {"state": "queued", "job_id": job_id}


def export_status(engine: Engine, workspace_id: str, job_id: str, *, client,
                  buckets) -> dict[str, Any] | None:
    with transaction(engine, workspace_id) as conn:
        job = conn.execute(sa.select(jobs).where(
            jobs.c.workspace_id == workspace_id, jobs.c.id == job_id,
            jobs.c.type == EXPORT)).mappings().first()
        if job is None:
            return None
        each = _measured(conn, workspace_id, EXPORT)
        now = db_now(conn)
    state = _state(None, job)
    result = job["result"] or {}
    if str(job["state"]) == "succeeded":
        key = _first_key(result.get("keys"))
        return {"state": "ready", "url": _sign(client, buckets, key, workspace_id) if key else None,
                "size_bytes": result.get("size_bytes")}
    out = {**state, "progress": [job["progress_done"], job["progress_total"]]}
    if state["state"] == "running" and job["started_at"]:
        out["estimate_s"] = max(0, round(each - (now - float(job["started_at"]))))
    elif state["state"] == "queued":
        out["estimate_s"] = round(each)
    return out


__all__ = [
    "FLAG", "Work", "analysis_hash", "export_status", "mix_state", "on_upload_accepted",
    "plan_mix", "prepare_songs", "request_export", "seam_hash", "songs_status",
]
