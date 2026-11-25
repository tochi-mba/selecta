"""Two rules of the hosted mix found on staging on 2026-11-25.

- One copy of a song per mix: the customer uploaded "Call on Me" twice and the plan used it at
  positions 1 and 4 (to-do T-20261125-ed08). `hosted_render.one_per_recording` keeps the first
  upload of each recording, by the local catalogue's duplicate rule (ADR-0469 amendment 2).
- An honest time left: the card said "Under a minute left" for several minutes while blends
  took 1.5 to 2 minutes each (to-do T-20261125-3985). `hosted_estimate.mix_estimate`.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from selecta import hosted_estimate, hosted_render


def _song(n: int, sha: str, name: str | None, duration: float | None = 200.0) -> dict:
    return {"id": f"asset-{n}", "sha256": sha * 64, "display_name": name, "duration_s": duration}


def _kept(songs: list[dict]) -> list[str]:
    return [song["id"] for song, _key in hosted_render.one_per_recording(
        [(song, f"key-{song['id']}") for song in songs])]


def test_two_copies_of_one_file_are_planned_once():
    songs = [_song(1, "a", "Eric Prydz - Call on Me.mp3"), _song(2, "b", "Other - Song.mp3"),
             _song(3, "a", "Eric Prydz - Call on Me (1).mp3")]
    assert _kept(songs) == ["asset-1", "asset-2"]


def test_another_file_of_the_same_recording_is_planned_once():
    """Same title and artist (case, spacing and track number aside), length within 3 s."""
    songs = [_song(1, "a", "001. Eric Prydz - Call on Me.mp3", 171.0),
             _song(2, "b", "eric prydz -  call on me.flac", 172.5),
             _song(3, "c", "016. Eric Prydz - Call on Me.mp3", None)]
    assert _kept(songs) == ["asset-1"]


def test_a_remix_or_extended_mix_of_another_length_is_its_own_song():
    songs = [_song(1, "a", "Eric Prydz - Call on Me.mp3", 171.0),
             _song(2, "b", "Eric Prydz - Call on Me.mp3", 330.0)]
    assert _kept(songs) == ["asset-1", "asset-2"]


def test_files_without_an_artist_in_their_name_are_never_grouped_by_name():
    songs = [_song(1, "a", "Untitled.mp3"), _song(2, "b", "Untitled.mp3"), _song(3, "c", None),
             _song(4, "d", None)]
    assert _kept(songs) == ["asset-1", "asset-2", "asset-3", "asset-4"]


def test_every_upload_names_the_first_upload_of_its_recording():
    """`songs_status` turns this into `same_recording_as`, so the Library can say so."""
    songs = [_song(1, "a", "A - One.mp3", 180.0), _song(2, "b", "A - One.flac", 181.0),
             _song(3, "a", "copy.mp3"), _song(4, "c", "A - One (Extended).mp3", 300.0)]
    assert hosted_render.recording_of(songs) == {
        "asset-1": "asset-1", "asset-2": "asset-1", "asset-3": "asset-1", "asset-4": "asset-4"}


def test_title_and_artist_are_read_from_the_file_name_as_an_import_reads_them():
    assert hosted_render.title_artist("001. Morgan Wallen - Last Night.mp3") == (
        "Last Night", "Morgan Wallen")
    assert hosted_render.title_artist("Last Night.mp3") == ("Last Night", "")


# --- the estimate ---------------------------------------------------------------------------


def _durations(by_type=None, by_style=None) -> hosted_estimate.Durations:
    found = object.__new__(hosted_estimate.Durations)
    found.first_guess = {"analyse.song": 20.0}
    found.by_type = by_type or {}
    found.by_style = by_style or {}
    return found


def _job(kind: str, state: str, *, style=None, created=0.0, started=None):
    return SimpleNamespace(type=kind, state=state, input_ref={"style": style}, created_at=created,
                           started_at=started)


@pytest.fixture
def live(monkeypatch):
    found: list = []
    monkeypatch.setattr(hosted_estimate, "live_jobs", lambda *_args: found)
    return found


def _estimate(durations, *, slots=1, now=1_000.0, later=()):
    return hosted_estimate.mix_estimate(None, "ws", durations, slots=slots, now=now,
                                        later_seams=later)


def test_transition_times_are_measured_per_planned_move(live):
    durations = _durations(by_type={"seam.render": [40.0, 40.0, 150.0, 160.0]},
                           by_style={"cut_on_one": [40.0, 40.0], "blend": [150.0, 160.0, 170.0]})
    assert durations.expected("seam.render", "blend") == 160.0
    assert durations.expected("seam.render", "cut_on_one") == 40.0
    # a move not seen here yet: this workspace's transitions in general
    assert durations.expected("seam.render", "echo_out") == 150.0
    # nothing measured yet: a first guess by kind, a cut far quicker than a blend
    fresh = _durations()
    assert fresh.expected("seam.render", "cut_on_one") < fresh.expected("seam.render", "blend")
    assert fresh.expected("analyse.song") == 20.0


def test_running_and_queued_jobs_are_laid_onto_the_workers_slots(live):
    durations = _durations(by_style={"blend": [120.0], "cut_on_one": [40.0]})
    live.extend([
        _job("seam.render", "running", style="blend", created=0.0, started=940.0),  # 60 s left
        _job("seam.render", "queued", style="blend", created=1.0),
        _job("seam.render", "queued", style="cut_on_one", created=2.0),
    ])
    one = _estimate(durations, slots=1)
    assert one == {"estimate_s": 60 + 120 + 40, "estimate_why": None,
                   "work": {"queued": 2, "running": 1, "slots": 1}}
    # two workers: the blend starts now, the cut when the running one ends
    assert _estimate(durations, slots=2)["estimate_s"] == 120
    # hand-offs still waiting for their analysis count as transitions to come
    assert _estimate(durations, slots=1, later=["cut_on_one"])["estimate_s"] == 260


def test_no_estimate_once_a_running_job_has_outrun_its_measured_time(live):
    """The staging case: a blend measured (or guessed) at 25 s still running minutes later."""
    live.append(_job("seam.render", "running", style="blend", started=1_000.0 - 200.0))
    found = _estimate(_durations(by_style={"blend": [120.0]}))
    assert (found["estimate_s"], found["estimate_why"]) == (None, "overrunning")


def test_no_estimate_without_a_worker_or_while_the_workers_are_on_other_work(live):
    live.append(_job("seam.render", "queued", style="cut_on_one", created=0.0))
    durations = _durations(by_style={"cut_on_one": [40.0]})
    assert _estimate(durations, slots=0)["estimate_why"] == "no_worker"
    # queued for 1,000 s with nothing of ours running: the 40 s guess is already wrong
    assert _estimate(durations, slots=1)["estimate_why"] == "busy"
    assert _estimate(durations, slots=1, now=60.0)["estimate_s"] == 40


def test_nothing_left_is_zero(live):
    assert _estimate(_durations())["estimate_s"] == 0
