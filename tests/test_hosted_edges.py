"""Hosted mode's edge cases, settled against the code (to-do T-20261125-803e, walkthrough §10).

Each test names the case it proves: clipping (10), the duplicate rule's version markers (13), a
large library's planning pool (12), version bumps (4), a hostile file hanging ffmpeg (9), the
export allowance and over-quota storage (3, 5), two devices pressing Export at once (18) and the
hosted routes' own rate limits (3).
"""

from __future__ import annotations

import sys
import time

import pytest
import sqlalchemy as sa
from test_hosted_stuck_jobs import hosted, song  # noqa: F401 - the shared hosted fixture

from selecta import hosted_export, hosted_render, ratelimit
from selecta import jobs as engine_jobs
from selecta.analysis.song import PEAK_CEILING_DB
from selecta.persistence import transaction
from selecta.usage.schema import allowance_counters
from selecta.work.schema import jobs
from selecta.workers.context import run_tool
from selecta.workers.export_join import check_timeline

# --- (10) a quiet song given positive gain never clips; a silent one can still be exported ------


@pytest.mark.parametrize(("lufs", "peak"), [(-30.0, -12.0), (-20.0, -0.1), (-9.0, -0.5)])
def test_a_songs_level_never_lifts_its_loudest_sample_over_the_ceiling(lufs, peak):
    assert peak + hosted_render.gain_db((lufs, peak)) <= PEAK_CEILING_DB + 1e-9


@pytest.mark.parametrize("loudness", [(float("-inf"), -120.0), (-70.0, -60.0),
                                      (float("nan"), -3.0)])
def test_a_near_silent_or_unmeasured_song_gets_a_level_an_export_accepts(loudness):
    level = hosted_render.gain_db(loudness)
    low, high = hosted_render.GAIN_RANGE_DB
    assert low <= level <= high
    part = {"kind": "song", "key": "k", "sha256": "a" * 64, "from_s": 0.0, "seconds": 1.0,
            "gain_db": level}
    assert check_timeline([part, part])[0]["gain_db"] == level


# --- (13) version markers in a file name keep two versions apart -------------------------------


@pytest.mark.parametrize("marker", ["(Live)", "(Clean)", "(Explicit)", "(Remix)", "(Acoustic)",
                                    "(Instrumental)", "[Live]", "- Live"])
def test_a_marked_version_is_never_merged_with_the_plain_one(marker):
    songs = [{"id": "one", "sha256": "1" * 64, "duration_s": 200.0,
              "display_name": "Adele - Hello.mp3"},
             {"id": "two", "sha256": "2" * 64, "duration_s": 200.5,
              "display_name": f"Adele - Hello {marker}.mp3"}]
    assert hosted_render.recording_of(songs) == {"one": "one", "two": "two"}


# --- (12) a library over the planning limit is sampled, not cut at the first 60 uploads --------


def test_a_large_library_is_sampled_for_each_plan_in_upload_order():
    ready = [({"id": f"s{n}"}, None) for n in range(500)]
    pool = hosted_render.planning_pool(ready, pick=lambda numbers, k: list(numbers)[-k:])
    assert len(pool) == hosted_render.MAX_PLAN_SONGS
    assert [song_["id"] for song_, _ in pool] == [f"s{n}" for n in range(440, 500)]
    assert hosted_render.planning_pool(ready[:12]) == ready[:12]
    drawn = {song_["id"] for _ in range(5) for song_, _ in hosted_render.planning_pool(ready)}
    assert len(drawn) > hosted_render.MAX_PLAN_SONGS  # songs past the first 60 reach a plan


# --- (4) a version bump names new work; nothing stored under the old version is reused ---------


def test_an_engine_version_bump_changes_every_hosted_hash(monkeypatch):
    before = (hosted_render.analysis_hash("a" * 64),
              hosted_render.seam_hash("a" * 64, "b" * 64, "blend"))
    monkeypatch.setattr(hosted_render, "ANALYSIS_VERSION", hosted_render.ANALYSIS_VERSION + 1)
    assert hosted_render.analysis_hash("a" * 64) != before[0]
    assert hosted_render.seam_hash("a" * 64, "b" * 64, "blend") != before[1]
    monkeypatch.undo()
    monkeypatch.setattr(hosted_render, "RENDER_VERSION", hosted_render.RENDER_VERSION + 1)
    assert hosted_render.analysis_hash("a" * 64) == before[0]
    assert hosted_render.seam_hash("a" * 64, "b" * 64, "blend") != before[1]


# --- (9) a file that makes ffmpeg hang can't hold a worker past its job's limit ----------------


class TimesOut:
    """An attempt whose runtime limit passes after `after` check-ins."""

    def __init__(self, after: int) -> None:
        self.left = after

    def check_in(self) -> None:
        self.left -= 1
        if self.left < 0:
            raise engine_jobs.Interrupted


def test_a_program_that_hangs_is_stopped_when_the_attempt_runs_out_of_time():
    hang = [sys.executable, "-c", "import time; time.sleep(60)"]
    started = time.monotonic()
    with pytest.raises(engine_jobs.Interrupted):
        run_tool(hang, TimesOut(after=3), "never")
    assert time.monotonic() - started < 20


def test_a_program_that_fails_is_bad_input_in_plain_words():
    from selecta.workers.context import InputInvalid

    with pytest.raises(InputInvalid, match="could not be decoded"):
        run_tool([sys.executable, "-c", "raise SystemExit(3)"], TimesOut(after=10_000),
                 "The original could not be decoded.")


# --- (3, 5, 18) exports take the plan's allowance once; over-quota storage makes none ----------


def _used(engine, workspace: str) -> float:
    with transaction(engine, workspace) as conn:
        return float(conn.execute(sa.select(sa.func.sum(allowance_counters.c.used)).where(
            allowance_counters.c.workspace_id == workspace,
            allowance_counters.c.kind == "export")).scalar() or 0.0)


def test_a_free_plan_makes_its_three_exports_a_month_and_then_says_so(hosted):  # noqa: F811
    engine, _work, workspace = hosted
    for _ in range(3):
        why, taken = hosted_export.allow_export(engine, workspace, None)
        assert why is None and taken is not None
    why, taken = hosted_export.allow_export(engine, workspace, None)
    assert taken is None and why == hosted_export.USED_UP.format(limit=3)
    assert _used(engine, workspace) == 3


def test_no_export_is_made_while_storage_is_over_the_plans_limit(hosted, monkeypatch):  # noqa: F811
    from selecta.usage import quota

    engine, _work, workspace = hosted
    real = quota.usage

    class Over:
        read_only = True

    monkeypatch.setattr(quota, "usage", lambda conn, ws: Over() if ws == workspace else real(
        conn, ws))
    assert hosted_export.allow_export(engine, workspace, None) == (hosted_export.READ_ONLY, None)
    assert _used(engine, workspace) == 0


def _complete_mix(monkeypatch, workspace: str) -> None:
    parts = [{"kind": "song", "from_s": 0.0, "seconds": 30.0, "gain_db": -1.0,
              "_file": {"key": f"w/{workspace}/a/one", "sha256": "1" * 64}},
             {"kind": "song", "from_s": 0.0, "seconds": 30.0, "gain_db": 0.0,
              "_file": {"key": f"w/{workspace}/a/two", "sha256": "2" * 64}}]
    monkeypatch.setattr(hosted_export.hosted_render, "mix_state",
                        lambda *a, **k: {"parts": parts, "complete": True})


def test_two_devices_pressing_export_at_once_make_one_job_and_pay_once(hosted, monkeypatch):  # noqa: F811
    engine, work, workspace = hosted
    _complete_mix(monkeypatch, workspace)
    # both presses read "no export yet" before either made one
    monkeypatch.setattr(hosted_export, "_latest_job", lambda *a, **k: None)
    order = [{"asset_id": "one"}, {"asset_id": "two"}]
    first = hosted_export.request_export(engine, work, workspace, order, client=None, buckets=None)
    second = hosted_export.request_export(engine, work, workspace, order, client=None,
                                          buckets=None)
    assert first["state"] == second["state"] == "queued"
    assert first["job_id"] == second["job_id"]
    with transaction(engine, workspace) as conn:
        made = conn.execute(sa.select(sa.func.count()).where(
            jobs.c.workspace_id == workspace, jobs.c.type == "export.render")).scalar_one()
    assert made == 1 and _used(engine, workspace) == 1


def test_asking_again_for_a_queued_export_takes_nothing_more(hosted, monkeypatch):  # noqa: F811
    engine, work, workspace = hosted
    _complete_mix(monkeypatch, workspace)
    order = [{"asset_id": "one"}, {"asset_id": "two"}]
    first = hosted_export.request_export(engine, work, workspace, order, client=None, buckets=None)
    again = hosted_export.request_export(engine, work, workspace, order, client=None, buckets=None)
    assert again["job_id"] == first["job_id"] and _used(engine, workspace) == 1


# --- (14) a deleted song leaves the card and every mix at once ---------------------------------


def test_a_deleted_song_is_never_analysed_listed_or_planned_again(hosted):  # noqa: F811
    from selecta.storage.deletion import DeletionKind, tombstone

    engine, work, workspace = hosted
    kept, gone = song(engine, workspace, b"kept"), song(engine, workspace, b"gone")
    with transaction(engine, workspace) as conn:
        tombstone(conn, workspace, DeletionKind.SONG, gone["id"])
    assert hosted_render.prepare_songs(engine, work, workspace)["queued"] == 1
    listed = [entry["asset_id"] for entry in hosted_render.songs_status(engine,
                                                                         workspace)["songs"]]
    assert listed == [kept["id"]]
    with transaction(engine, workspace) as conn:
        own = [row["id"] for row in hosted_render._songs(conn, workspace,
                                                         [gone["id"], kept["id"]])]
    assert own == [kept["id"]]  # what mix_state and an export build their timeline from


# --- (3) the hosted routes have their own, stricter rate limits ---------------------------------


@pytest.mark.parametrize(("path", "bucket"), [
    ("/api/hosted/mixes/plan", "hosted_plan"),
    ("/api/hosted/mixes/render", "hosted_mix"),
    ("/api/hosted/mixes/export", "hosted_mix"),
    ("/api/hosted/songs/prepare", "hosted_prepare"),
    ("/api/hosted/songs/abc123/retry", "hosted_prepare"),
])
def test_each_hosted_route_that_makes_work_has_a_stricter_bucket(path, bucket):
    rule = ratelimit._strict(path, "POST")
    assert rule is not None and rule.name == bucket
    assert ratelimit._strict(path, "GET") is None


def test_the_mix_bucket_leaves_room_for_the_cards_three_second_poll_in_several_tabs():
    rule = ratelimit._strict("/api/hosted/mixes/render", "POST")
    assert rule.per_minute >= 3 * 20  # three tabs polling every 3 s
