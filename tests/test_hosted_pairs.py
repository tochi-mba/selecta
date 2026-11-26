"""`hosted_pairs`: one hand-off between two cloud library songs (`cloud.studio_seams`), and
`hosted_render.mix_state` unchanged by the split that made it.

`tests/fixtures/hosted_mix_state_before.json` is `record(...)` below run with `mix_state` as it
was before the split (`hosted_render.py` at commit 98faf0fa, loaded from git). Today's code over
the same scenario must match it exactly: every job (type, key, lane, inputs), every allowance
charge, every seam kept in the engine store and every answer, with the planner core off and on.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from cloud_helpers import grant_hosted_media

from selecta import flags, hosted_caps, hosted_pairs, hosted_render
from selecta.admin.state import DbWorkControls
from selecta.business.weight import business_policy
from selecta.engine_store.schema import seam_attestations, seams
from selecta.identity.schema import users, workspaces
from selecta.local_media.schema import local_songs
from selecta.persistence import db_now, make_engine, migrate, transaction
from selecta.scheduling.policy import Lane
from selecta.storage.artifacts import Buckets
from selecta.storage.keys import derived_key, original_key
from selecta.storage.schema import assets
from selecta.usage import allowances
from selecta.usage.schema import allowance_counters
from selecta.work import proxies
from selecta.work.cloud_ports import CloudJobEntitlements
from selecta.work.schema import artifacts, jobs
from selecta.work.store import JobStore

GOLDEN = Path(__file__).parent / "fixtures" / "hosted_mix_state_before.json"
WS, USER = "ws-pairs", "user-pairs"
LOUD = {"a": (-9.5, -0.3), "b": (-12.0, -2.5), "c": (-15.0, -4.0), "d": (-8.0, -0.1)}


class Objects:
    """Signs a link per key, so an answer's links can be compared."""

    def presign_get(self, bucket, key, _ttl, *_rest, **_kw):
        return f"https://objects.test/{bucket}/{key}"


def sha(name: str) -> str:
    return hashlib.sha256(f"song {name}".encode()).hexdigest()


def asset(name: str) -> str:
    return f"asset-{name}"


def make_world(folder: Path, module=hosted_render):
    engine = make_engine(f"sqlite:///{folder / 'pairs.sqlite'}")
    migrate.upgrade(engine)
    with transaction(engine) as conn:
        conn.execute(users.insert().values(
            id=USER, auth_subject=f"auth|{USER}", email_verified=True, timezone="UTC",
            age_confirmed=True, created_at=0.0))
        conn.execute(workspaces.insert().values(
            id=WS, name="Mine", kind="personal", owner_user_id=USER, created_at=0.0))
    grant_hosted_media(engine)
    work = module.Work(JobStore(engine, business_policy(),
                                entitlements=CloudJobEntitlements(engine),
                                controls=DbWorkControls()))
    return engine, work


def add_song(engine, name: str, *, upload: bool = True, number: int = 1) -> int:
    """A catalogue song and, with `upload`, its upload (an MP3, so it needs a playback file)."""
    with transaction(engine, WS) as conn:
        if upload:
            conn.execute(assets.insert().values(
                id=asset(name), workspace_id=WS, original_key=original_key(WS, asset(name)),
                size=1000 + number, sha256=sha(name), format="mp3", duration_s=200.0,
                sample_rate=48_000, channels=2, created_at=float(number)))
        return int(conn.execute(sa.insert(local_songs).values(
            workspace_id=WS, content_sha256=sha(name), title=f"Song {name}",
            artist="Artist", duration_s=200.0, created_at=1.0, updated_at=1.0,
        ).returning(local_songs.c.id)).scalar_one())


def _artifact(conn, kind: str, input_hash: str, name: str, checksum: str, settings=None):
    conn.execute(artifacts.insert().values(
        id=f"art-{kind}-{input_hash[:12]}", workspace_id=WS, kind=kind, input_hash=input_hash,
        keys=[derived_key(WS, kind, input_hash, "att-1", name)], checksum=checksum,
        size_bytes=10, provenance={"inputs": {"a": "x"}, "settings": settings or {}},
        created_at=1.0, last_used_at=1.0))


def _finish(conn, kind: str, key: str, state: str, result=None, error_class=None):
    conn.execute(jobs.update().where(jobs.c.workspace_id == WS, jobs.c.type == kind,
                                     jobs.c.idempotency_key == key).values(
        state=state, result=result, error_class=error_class, error_detail="",
        finished_at=db_now(conn)))


def analysed(engine, *names: str) -> None:
    """Each song's analysis finished, its loudness in the job's result."""
    with transaction(engine, WS) as conn:
        for name in names:
            digest = hosted_render.analysis_hash(sha(name))
            _artifact(conn, "analysis", digest, "analysis.npz", "a" * 64)
            lufs, peak = LOUD[name]
            _finish(conn, "analyse.song", digest, "succeeded",
                    {"lufs": lufs, "peak_db": peak, "bpm": 120.0, "camelot": "8A"})


def played(engine, *names: str) -> None:
    """Each song's lossless playback file made."""
    with transaction(engine, WS) as conn:
        for name in names:
            _, digest = proxies.identity(sha(name), 48_000)
            _artifact(conn, "playback", digest, "playback.flac", f"{name}" * 64)


def seam_made(engine, digest: str, move: str, settings: dict | None = None) -> None:
    cues = {"a_source_start": 150.0, "b_source_end": 20.0, "seconds": 16.0}
    with transaction(engine, WS) as conn:
        _artifact(conn, "seam", digest, "seam.flac", "e" * 64,
                  {"cues": cues, "move": move, "passed": True, **(settings or {})})
        _finish(conn, "seam.render", f"hosted-seam:{digest}", "succeeded",
                {"move": move, "audit_passed": True, "fell_back": False, "checks": []})


class limited:
    """Today's transition allowance held at `seconds` (pytest's monkeypatch, without pytest)."""

    def __init__(self, seconds: float) -> None:
        self.seconds = seconds

    def __enter__(self):
        self.real = allowances.limit_for
        allowances.limit_for = lambda plan, kind: (
            self.seconds if kind == hosted_caps.TRANSITIONS else self.real(plan, kind))

    def __exit__(self, *_exc):
        allowances.limit_for = self.real


def used(engine, kind: str) -> float:
    with transaction(engine, WS) as conn:
        return float(conn.execute(sa.select(sa.func.sum(allowance_counters.c.used)).where(
            allowance_counters.c.workspace_id == WS,
            allowance_counters.c.kind == kind)).scalar() or 0.0)


def _plain(answer: dict, engine) -> dict:
    """The answer as JSON, each job named by its type and key (ids are new every run)."""
    found = json.loads(json.dumps(answer))
    if found.get("allowance_used"):
        found["allowance_used"].pop("resets_at", None)  # tomorrow's midnight moves
    with engine.connect() as conn:
        named = {row.id: f"{row.type}:{row.idempotency_key}" for row in conn.execute(
            sa.select(jobs.c.id, jobs.c.type, jobs.c.idempotency_key))}
    for seam in found.get("seams", []):
        if seam.get("job_id"):
            seam["job_id"] = named[seam["job_id"]]
    return found


def _state_of(engine) -> dict:
    with engine.connect() as conn:
        made = sorted(
            [{"type": r.type, "key": r.idempotency_key, "lane": r.lane, "urgency": r.urgency,
              "input_ref": r.input_ref, "created_by": r.created_by, "max_run_s": r.max_run_s,
              "state": r.state}
             for r in conn.execute(sa.select(jobs).where(jobs.c.workspace_id == WS))],
            key=lambda job: (job["type"], job["key"]))
        kept = [dict(row) for row in conn.execute(sa.select(
            seams.c.key, seams.c.status, seams.c.style, seams.c.a_source_start,
            seams.c.b_source_end).where(seams.c.workspace_id == WS).order_by(seams.c.key))
            .mappings()]
        attested = [dict(row) for row in conn.execute(sa.select(
            seam_attestations.c.key, seam_attestations.c.studio, seam_attestations.c.studio_id,
            seam_attestations.c.clip_sha256, seam_attestations.c.clip_seconds).where(
            seam_attestations.c.workspace_id == WS).order_by(seam_attestations.c.key))
            .mappings()]
    return {"jobs": json.loads(json.dumps(made)), "kept": kept, "attested": attested,
            "transition_seconds": used(engine, hosted_caps.TRANSITIONS),
            "analyses_paid": used(engine, hosted_caps.ANALYSIS)}


def record(module, folder: Path, core: bool) -> dict:
    """The scenario: three uploads mixed before, during and after their work is done, then a
    fourth hand-off the day's allowance can't pay for. Run with `module.mix_state`."""
    engine, work = make_world(folder, module)
    out: dict = {}
    try:
        with flags.bound({"cloud.hosted_brain": core}):
            for name, number in (("a", 1), ("b", 2), ("c", 3)):
                add_song(engine, name, number=number)
            order = [{"asset_id": asset("a"), "move": None},
                     {"asset_id": asset("b"), "move": "blend"},
                     {"asset_id": asset("c"), "move": None}]

            def mix(songs, **extra):
                return _plain(module.mix_state(engine, work, WS, songs, client=Objects(),
                                               buckets=Buckets(), created_by=USER, **extra),
                              engine)

            out["1 nothing done"] = mix(order)
            analysed(engine, "a", "b", "c")
            played(engine, "a", "b")
            out["2 analysed"] = mix(order)
            with engine.connect() as conn:
                made = {row.input_ref["style"]: row.idempotency_key for row in conn.execute(
                    sa.select(jobs.c.idempotency_key, jobs.c.input_ref).where(
                        jobs.c.type == "seam.render"))}
            first, second = made["blend"], made[None]
            seam_made(engine, first.removeprefix("hosted-seam:"), "blend")
            with transaction(engine, WS) as conn:
                _finish(conn, "seam.render", second, "failed", error_class="input_invalid")
            out["3 one seam ready"] = mix(order)
            out["3 with files"] = mix(order, files=True)
            add_song(engine, "d", number=4)
            analysed(engine, "d")
            with limited(used(engine, hosted_caps.TRANSITIONS) + 10.0):
                out["4 allowance used"] = mix(
                    [*order, {"asset_id": asset("d"), "move": "echo_out"}])
            out["state"] = _state_of(engine)
    finally:
        engine.dispose()
    return out


def test_mix_state_makes_the_jobs_hashes_and_timeline_it_made_before_the_split(tmp_path):
    before = json.loads(GOLDEN.read_text("utf-8"))
    for core in (False, True):
        folder = tmp_path / ("core" if core else "plain")
        folder.mkdir()
        now = record(hosted_render, folder, core)
        assert now == before["core" if core else "plain"]
    # the recording is of real work: jobs of every kind, charges, a seam kept and refused
    plain = before["plain"]
    assert {job["type"] for job in plain["state"]["jobs"]} == {
        "analyse.song", "play.proxy", "seam.render"}
    assert plain["state"]["transition_seconds"] > 0 and plain["state"]["kept"]
    assert plain["4 allowance used"]["seams"][2]["state"] == "refused"
    assert any(part["kind"] == "seam" for part in plain["3 one seam ready"]["parts"])
    assert any(job["input_ref"].get("brain") == "core" for job in before["core"]["state"]["jobs"])


# --- pair_state -------------------------------------------------------------------------------


@pytest.fixture
def pair(tmp_path):
    engine, work = make_world(tmp_path)
    ids = {name: add_song(engine, name, number=n) for n, name in enumerate("ab", start=1)}
    yield SimpleNamespace(engine=engine, work=work, ids=ids)
    engine.dispose()


def ask(world, a="a", b="b", move="blend", lane=Lane.INTERACTIVE, **extra):
    return hosted_pairs.pair_state(world.engine, world.work, WS, world.ids[a], world.ids[b],
                                   move, lane, client=Objects(), buckets=Buckets(),
                                   created_by=USER, **extra)


def seam_jobs(engine) -> list:
    with engine.connect() as conn:
        return conn.execute(sa.select(jobs.c.idempotency_key, jobs.c.lane).where(
            jobs.c.type == "seam.render")).all()


def test_a_pair_by_catalogue_ids_makes_the_mix_seam_and_pays_for_it_once(pair):
    first = ask(pair)
    assert first["state"] == "waiting_for_analysis" and first["clip"] is None
    assert first["files"] == {"a": None, "b": None}  # each playback file is being made
    analysed(pair.engine, "a", "b")
    asked = ask(pair)
    assert asked["state"] == "queued" and asked["planned_move"] == "blend"
    digest = hosted_render.seam_hash(sha("a"), sha("b"), "blend")
    assert seam_jobs(pair.engine) == [(f"hosted-seam:{digest}", "interactive")]
    paid = used(pair.engine, hosted_caps.TRANSITIONS)
    assert paid > 0
    # asked again (the next poll, another tab) and by a server mix of the same two songs: the
    # same job, paid once for its seam digest
    assert ask(pair)["state"] == "queued"
    mixed = hosted_render.mix_state(
        pair.engine, pair.work, WS, [{"asset_id": asset("a")}, {"asset_id": asset("b"),
                                                                "move": "blend"}],
        client=Objects(), buckets=Buckets(), created_by=USER)
    assert mixed["seams"][0]["state"] == "queued"
    assert len(seam_jobs(pair.engine)) == 1 and used(pair.engine, hosted_caps.TRANSITIONS) == paid


def test_a_ready_pair_answers_its_clip_levels_and_lossless_files(pair):
    analysed(pair.engine, "a", "b")
    played(pair.engine, "a", "b")
    assert ask(pair)["state"] == "queued"
    digest = hosted_render.seam_hash(sha("a"), sha("b"), "blend")
    seam_made(pair.engine, digest, "blend", {
        "levels": {"a_gain_db": -4.25, "b_gain_db": -1.5}, "switch_at": 8.0,
        "b_warp": {"output": [0.0, 16.0], "source": [4.0, 20.0]}})
    answer = ask(pair)
    assert answer["state"] == "ready" and answer["move"] == "blend" and answer["passed"]
    key = derived_key(WS, "seam", digest, "att-1", "seam.flac")
    assert answer["clip"] == {
        "url": f"https://objects.test/{Buckets().derived}/{key}", "sha256": "e" * 64,
        "a_source_start": 150.0, "b_source_end": 20.0, "seconds": 16.0, "sample_rate": 44_100,
        "switch_at": 8.0, "b_warp": {"output": [0.0, 16.0], "source": [4.0, 20.0]}}
    # the worker's own record of each song's level wins
    assert answer["levels"] == {"a_gain_db": -4.25, "b_gain_db": -1.5}
    for side in "ab":
        file = answer["files"][side]
        assert file["sha256"] == side * 64 and file["sample_rate"] == 48_000
        assert "/playback/" in file["url"] and file["seconds"] == 200.0
    assert "row" not in answer and "index" not in answer


def test_an_older_seam_gets_the_level_the_worker_rendered_at_and_a_linear_warp(pair):
    ask(pair)  # each analysis job, whose result holds the song's loudness
    analysed(pair.engine, "a", "b")
    ask(pair)
    seam_made(pair.engine, hosted_render.seam_hash(sha("a"), sha("b"), "blend"), "blend")
    answer = ask(pair)
    # SongInfo.gain_db, exactly: min(-14 - lufs, -1 - peak), neither rounded nor held
    assert answer["levels"] == {"a_gain_db": min(-14.0 + 9.5, -1.0 + 0.3),
                                "b_gain_db": min(-14.0 + 12.0, -1.0 + 2.5)}
    assert answer["clip"]["switch_at"] is None and answer["clip"]["b_warp"] is None
    # a silent file's level is no number, so the pair plays live rather than at a guess
    assert hosted_pairs.worker_gain_db((float("-inf"), float("-inf"))) is None


def test_a_song_with_no_cloud_copy_is_named_and_nothing_is_queued(pair):
    only_here = add_song(pair.engine, "c", upload=False, number=3)
    with pytest.raises(hosted_pairs.NoCloudCopy) as refused:
        hosted_pairs.pair_state(pair.engine, pair.work, WS, pair.ids["a"], only_here,
                                client=Objects(), buckets=Buckets())
    assert refused.value.sides == ["b"]
    with transaction(pair.engine, WS) as conn:  # a deleted catalogue song reads alike
        conn.execute(local_songs.update().where(local_songs.c.id == pair.ids["a"]).values(
            deleted_at=1.0))
    with pytest.raises(hosted_pairs.NoCloudCopy) as refused:
        ask(pair)
    assert refused.value.sides == ["a"]
    with pytest.raises(hosted_pairs.NoCloudCopy) as refused:  # no such song
        hosted_pairs.pair_state(pair.engine, pair.work, WS, 9_999, 9_998, client=Objects(),
                                buckets=Buckets())
    assert refused.value.sides == ["a", "b"]
    with pair.engine.connect() as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(jobs)).scalar_one() == 0


def test_a_used_up_allowance_is_refused_with_its_own_code_and_no_job(pair):
    analysed(pair.engine, "a", "b")
    with limited(10.0):
        answer = ask(pair)
    assert (answer["state"], answer["code"]) == ("refused", "allowance_used")
    assert answer["why"] == answer["allowance_used"]["why"]
    assert answer["allowance_used"]["kind"] == hosted_caps.TRANSITIONS
    assert seam_jobs(pair.engine) == [] and used(pair.engine, hosted_caps.TRANSITIONS) == 0


def test_the_worker_records_each_songs_level_the_switch_and_bs_warp():
    from selecta.workers.engine_handlers import MAX_WARP_POINTS, _played

    def script(gain_a, points):
        return SimpleNamespace(
            overlap=(4.0, 12.123456),
            a=SimpleNamespace(song=SimpleNamespace(gain_db=gain_a)),
            b=SimpleNamespace(song=SimpleNamespace(gain_db=-2.0), warp=SimpleNamespace(
                output=[i / 3 for i in range(points)], source=[10 + i / 3 for i in range(points)])))

    found = _played(script(-4.123456789, 3))
    assert found["levels"] == {"a_gain_db": -4.123456789, "b_gain_db": -2.0}
    assert found["switch_at"] == 12.1235
    assert found["b_warp"] == {"output": [0.0, 0.3333, 0.6667], "source": [10.0, 10.3333, 10.6667]}
    # a near-silent song's level is no number, and a very long warp is left out
    long = _played(script(float("inf"), MAX_WARP_POINTS + 1))
    assert "levels" not in long and "b_warp" not in long
