"""One hand-off between two songs of the cloud library, rendered by the cloud studio
(`cloud.studio_seams`, two-places plan Phase 5).

`pair_state` is the seam half of `hosted_render.mix_state` for one pair named by catalogue song
ids. Each song is found by its cloud copy (`local_media.store.cloud_copies`: the oldest live
upload of any of the song's hashes), then the pair gets what a server mix asks for:

- each song's analysis (`hosted_render.prepare_songs`) and lossless playback file
  (`work.proxies.prepare`, the `play.proxy` the player uses): `prepared`;
- the seam's job, made by `_seam_spec` and found by `seam_hash`, its first job paid from the
  day's transition allowance (`hosted_caps`): `look` and `make`;
- the rendered seam kept in the engine store (`keep_in_store`).

`mix_state` runs the same steps over every pair of its order, so its jobs and hashes are the
ones it always made (`tests/test_hosted_pairs.py` holds it to a recorded run).

When the seam is ready the answer carries what the shared player needs to play it as a rendered
clip (web/src/dsp/seams.ts `RenderedClip`): the clip's signed link and cue points, the level each
song was rendered at, and each song's signed lossless file with its SHA-256. While it is queued
or running the answer already carries the levels it will be made at, so the player can start a
song at that level before its next transition is ready.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta import hosted_brain, hosted_caps, hosted_render, hosted_status
from selecta.config import SAMPLE_RATE
from selecta.persistence import transaction
from selecta.scheduling.policy import Lane
from selecta.storage.keys import original_key

FLAG = "cloud.studio_seams"
LANES = (Lane.INTERACTIVE, Lane.STANDARD)
NO_TIMING = "This transition's timing is missing, so it plays live."
NO_LEVEL = "The level this transition was made at is unknown, so it plays live."


class NoCloudCopy(LookupError):
    """A song of the pair has no live upload in this workspace's cloud library, or is not a song
    of this workspace: the two read alike."""

    def __init__(self, sides: Sequence[str]) -> None:
        super().__init__(", ".join(sides))
        self.sides = list(sides)


def assets_of(engine: Engine, workspace_id: str, song_ids: Sequence[int]) -> dict[int, str]:
    """Each live catalogue song's cloud copy (its oldest upload), by song id."""
    from selecta.local_media.schema import local_songs
    from selecta.local_media.store import cloud_copies

    wanted = [int(song_id) for song_id in song_ids]
    with transaction(engine, workspace_id) as conn:
        live = set(conn.execute(sa.select(local_songs.c.id).where(
            local_songs.c.workspace_id == workspace_id, local_songs.c.id.in_(wanted),
            local_songs.c.deleted_at.is_(None))).scalars())
        copies = cloud_copies(conn, workspace_id, [song_id for song_id in wanted
                                                   if song_id in live])
    return {song_id: str(found["asset_id"]) for song_id, found in copies.items()}


def prepared(engine: Engine, work, workspace_id: str, ids: Sequence[str], *,
             retry: bool = False, created_by: str | None = None):
    """What any hand-off of these uploads needs first: their analysis jobs, each side's facts
    for a planner-core seam, and their lossless playback files. Returns (facts or None,
    playback by asset id)."""
    from selecta.work import proxies

    hosted_render.prepare_songs(engine, work, workspace_id, ids, retry=retry,
                                created_by=created_by)
    with transaction(engine, workspace_id) as conn:
        # only this workspace's own live songs: anyone else's id reads as a missing song
        mine = hosted_render._songs(conn, workspace_id, ids)
    own = [song["id"] for song in mine]
    # cloud.hosted_brain: each seam is the planner core's, built from the engine store's facts
    brain = (hosted_brain.side_facts(engine, workspace_id, [s["sha256"] for s in mine])
             if hosted_brain.on() and mine else None)
    playback = {p.asset_id: p for p in proxies.prepare(
        work.store, workspace_id, own, need="mix", created_by=created_by)} if own else {}
    return brain, playback


def read_songs(conn: Connection, workspace_id: str, ids: Sequence[str], playback: dict,
               read_object: Callable[[str, Path], Path] | None):
    """The songs in order, each with its analysis key, loudness and playback file's SHA-256,
    and (hash, analysis key, audio id) of each analysed one, for `keep_in_store`."""
    render = hosted_render
    by_id = {song["id"]: song for song in render._songs(conn, workspace_id, ids)}
    songs = [by_id[i] for i in ids if i in by_id]
    analysed: list[tuple[str, str, str | None]] = []
    for song in songs:
        digest = render.analysis_hash(song["sha256"])
        row = render._artifact(conn, workspace_id, "analysis", digest)
        song["analysis_key"] = render._first_key(row["keys"]) if row is not None else None
        job = render._latest_job(conn, workspace_id, render.ANALYSE, digest)
        result = (job["result"] if job is not None else None) or {}
        song["loudness"] = render._loudness(result, song["analysis_key"], read_object)
        made = playback.get(song["id"])
        if made is not None and made.status == "ready":
            found = render._artifact(conn, workspace_id, "playback", made.input_hash)
            song["file_sha256"] = found["checksum"] if found is not None else None
        elif made is not None and made.status == "direct":
            song["file_sha256"] = song["sha256"]
        if song["analysis_key"]:
            analysed.append((song["sha256"], song["analysis_key"], result.get("audio_id")))
    return songs, analysed


def look(conn: Connection, workspace_id: str, index: int, a: dict, b: dict, move: str | None,
         brain: dict | None, retry: bool):
    """Where one hand-off stands: (its entry, what to make or None, the rendered seam for
    `keep_in_store` or None)."""
    render = hosted_render
    core, pair = render._core_part(brain, a, b)
    digest = render.seam_hash(a["sha256"], b["sha256"], move, core)
    row = render._artifact(conn, workspace_id, "seam", digest)
    rendered = None if row is None else {
        "a_sha256": a["sha256"], "b_sha256": b["sha256"], "digest": digest, "row": row}
    job = render._latest_job(conn, workspace_id, render.SEAM, f"hosted-seam:{digest}")
    state = render._state(row, job)
    # a failed transition is tried again only on Try again (it plays as a plain change
    # meanwhile); a job that can never publish, or was cancelled, is replaced at once
    why = hosted_status.needs_new(row is not None, job, render._output("seam", digest),
                                  retry=retry)
    wanted = None
    if row is None and not (a["analysis_key"] and b["analysis_key"]):
        state = {"state": "waiting_for_analysis"}
    elif why is not None:
        wanted = (index, a, b, move, job, pair)
        state = {"state": "queued"}
    result = (job["result"] if job is not None else None) or {}
    seam = {"index": index, "planned_move": move, **state, "row": row,
            "move": result.get("move"), "passed": result.get("audit_passed"),
            "fell_back": result.get("fell_back"), "checks": result.get("checks")}
    return seam, wanted, rendered


def make(engine: Engine, work, workspace_id: str, wanted: tuple, lane, created_by: str | None,
         durations) -> tuple[str | None, bool]:
    """`look`'s job for a hand-off. A first job takes this account's measured seconds for the
    move from today's transition allowance (`hosted_caps`); a renewal or Try again takes
    nothing. Returns (why it wasn't made, whether the allowance was the reason)."""
    _index, a, b, move, old, pair = wanted
    return hosted_render._make_paid(
        engine, work, hosted_render._seam_spec(workspace_id, a, b, move, lane, created_by, pair),
        old, hosted_caps.TRANSITIONS, durations.expected(hosted_render.SEAM, move))


def keep_in_store(engine, workspace_id, analysed, rendered, read_object, client, buckets):
    """The engine store's copy of what the workers made (`cloud.brain`): each analysed song's
    facts the first time (`hosted_facts.keep`, also the backfill for older uploads) and each
    rendered seam (`hosted_brain.keep_seams`). Never changes what the mix answers."""
    from selecta import flags, hosted_facts

    if not flags.on(hosted_facts.FLAG):
        return
    if client is not None and read_object is not None:
        from selecta.storage.artifacts import R2ArtifactStore

        hosted_facts.keep(engine, workspace_id, analysed, read_object,
                          R2ArtifactStore(client, buckets))
    hosted_brain.keep_seams(engine, workspace_id, rendered)


def file_key(workspace_id: str, song_id: str, made) -> str | None:
    """The stored lossless file a song plays from: the original when it already is one, else
    its playback file once made."""
    if made is not None and made.status == "direct":
        return original_key(workspace_id, song_id)
    if made is not None and made.status == "ready":
        return hosted_render._first_key(made.keys)
    return None


def pair_state(engine: Engine, work, workspace_id: str, a_song_id: int, b_song_id: int,
               move: str | None = None, lane: Lane = Lane.STANDARD, *, client, buckets,
               created_by: str | None = None, retry: bool = False,
               read_object: Callable[[str, Path], Path] | None = None) -> dict[str, Any]:
    """Ask for the hand-off from song `a` to song `b` and say where it stands (module notes).

    Raises `NoCloudCopy` naming the sides (`a`, `b`) with no cloud copy. Answers `state`
    (`ready`, `queued`, `running`, `waiting_for_analysis`, `failed` or `refused`, with `why`
    and, when refused, `code`: `allowance_used` or `not_admitted`), `planned_move`, `move`,
    `passed`, `fell_back`, `checks`, `files` ({a, b}, each `{url, sha256, sample_rate,
    seconds}` or null while preparing), `levels` when ready, queued or running (each song's
    loudness known) and, only when ready, `clip`.
    """
    from selecta import hosted_estimate

    found = assets_of(engine, workspace_id, [a_song_id, b_song_id])
    missing = [side for side, song_id in (("a", a_song_id), ("b", b_song_id))
               if song_id not in found]
    if missing:
        raise NoCloudCopy(missing)
    ids = [found[a_song_id], found[b_song_id]]
    brain, playback = prepared(engine, work, workspace_id, ids, retry=retry,
                               created_by=created_by)
    with transaction(engine, workspace_id) as conn:
        songs, analysed = read_songs(conn, workspace_id, ids, playback, read_object)
        if len(songs) < 2:  # its upload was deleted a moment ago
            have = {song["id"] for song in songs}
            raise NoCloudCopy([side for side, i in zip("ab", ids, strict=True) if i not in have])
        seam, wanted, rendered = look(conn, workspace_id, 0, songs[0], songs[1], move, brain,
                                      retry)
        durations = hosted_estimate.Durations(conn, workspace_id, hosted_render.FIRST_GUESS_S)
    keep_in_store(engine, workspace_id, analysed, [rendered] if rendered else [], read_object,
                  client, buckets)
    paused = None
    if wanted is not None:
        refused, by_allowance = make(engine, work, workspace_id, wanted, lane, created_by,
                                     durations)
        if refused:
            seam.update(state="refused", why=refused,
                        code="allowance_used" if by_allowance else "not_admitted")
        if by_allowance:
            with transaction(engine, workspace_id) as conn:
                paused = hosted_caps.used_up(conn, workspace_id, hosted_caps.TRANSITIONS,
                                             refused=True)
    return _answer(workspace_id, songs, seam, playback, client, buckets, paused)


def _answer(workspace_id, songs, seam, playback, client, buckets, paused) -> dict[str, Any]:
    row = seam.pop("row")
    seam.pop("index")
    answer: dict[str, Any] = {
        **seam, "clip": None, "levels": None,
        "files": {side: _file(workspace_id, song, playback, client, buckets)
                  for side, song in zip("ab", songs, strict=True)}}
    if seam["state"] == "ready":
        clip = _clip(workspace_id, row, client, buckets) if row is not None else None
        levels = _levels(row, *songs) if row is not None else None
        if row is None:
            answer["state"] = "running"  # its file isn't visible yet; asking again finds it
        elif clip is None:
            answer.update(state="failed", why=NO_TIMING)
        elif levels is None:
            answer.update(state="failed", why=NO_LEVEL)
        else:
            answer.update(clip=clip, levels=levels)
    elif seam["state"] in ("queued", "running"):
        # the level each song will be rendered at, so the player can start a song at it before
        # its transition is made (a song plays from its start, its next transition comes later)
        answer["levels"] = _song_levels(*songs)
    if paused:
        answer["allowance_used"] = paused
    return answer


def _file(workspace_id, song, playback, client, buckets) -> dict[str, Any] | None:
    key = file_key(workspace_id, song["id"], playback.get(song["id"]))
    url = hosted_render._sign(client, buckets, key, workspace_id) if key else None
    if not url or not song.get("file_sha256"):
        return None
    # a playback file keeps its original's rate (`play.proxy`); the clip is made at 44.1 kHz
    return {"url": url, "sha256": song["file_sha256"], "sample_rate": song["sample_rate"],
            "seconds": song["duration_s"]}


def _clip(workspace_id, row, client, buckets) -> dict[str, Any] | None:
    cues = hosted_render._cues(row)
    key = hosted_render._first_key(row["keys"])
    url = hosted_render._sign(client, buckets, key, workspace_id) if key else None
    if cues is None or not url:
        return None
    settings = (row["provenance"] or {}).get("settings") or {}
    switch_at = settings.get("switch_at")
    return {"url": url, "sha256": row["checksum"], "a_source_start": cues[0],
            "b_source_end": cues[1], "seconds": cues[2], "sample_rate": SAMPLE_RATE,
            # from the worker's record when it has them (older seams don't): null means the
            # player assumes a linear warp of B across the clip
            "switch_at": float(switch_at) if _finite(switch_at) else None,
            "b_warp": _warp(settings.get("b_warp"))}


def _levels(row, a: dict, b: dict) -> dict[str, float] | None:
    """The level each song was rendered at, in dB: the worker's own record of it when the seam
    has one, else worked out as the worker does (`SongInfo.gain_db`) from the same loudness."""
    said = ((row["provenance"] or {}).get("settings") or {}).get("levels") or {}
    if isinstance(said, dict) and _finite(said.get("a_gain_db")) and _finite(
            said.get("b_gain_db")):
        return {"a_gain_db": float(said["a_gain_db"]), "b_gain_db": float(said["b_gain_db"])}
    return _song_levels(a, b)


def _song_levels(a: dict, b: dict) -> dict[str, float] | None:
    """Each song's `SongInfo.gain_db` from its loudness, or None when either is unknown."""
    gains = [worker_gain_db(song.get("loudness")) for song in (a, b)]
    if None in gains:
        return None
    return {"a_gain_db": gains[0], "b_gain_db": gains[1]}


def worker_gain_db(loudness: tuple[float, float] | None) -> float | None:
    """`SongInfo.gain_db` for this loudness, exactly: the level a worker renders a song at
    (unlike `hosted_render.gain_db`, neither rounded nor held in an export's range)."""
    from selecta.analysis.song import PEAK_CEILING_DB, TARGET_LUFS

    if loudness is None:
        return None
    lufs, peak = loudness
    gain = float(min(TARGET_LUFS - lufs, PEAK_CEILING_DB - peak))
    return gain if math.isfinite(gain) else None


def _finite(value: Any) -> bool:
    return (isinstance(value, int | float) and not isinstance(value, bool)
            and math.isfinite(value))


def _warp(value: Any) -> dict[str, list[float]] | None:
    if not isinstance(value, dict):
        return None
    output, source = value.get("output"), value.get("source")
    if (not isinstance(output, list) or not isinstance(source, list) or len(output) < 2
            or len(output) != len(source) or not all(map(_finite, [*output, *source]))):
        return None
    return {"output": [float(t) for t in output], "source": [float(t) for t in source]}


__all__ = ["FLAG", "LANES", "NoCloudCopy", "assets_of", "file_key", "keep_in_store", "look",
           "make", "pair_state", "prepared", "read_songs", "worker_gain_db"]
