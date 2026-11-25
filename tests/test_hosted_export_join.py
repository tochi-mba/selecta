"""The hosted export joins the parts the player plays, sample for sample (workers.export_join).

On staging a 5-song, 8-minute export still ran after 15 minutes: the old handler re-planned and
re-rendered every transition (`render.setmix`), so it was slow and could differ from what played.
The new one cuts and levels each part exactly as `web/src/cloud/hosted/timelinePlayer.ts` and
`partReader.ts` do. These tests build tiny 24-bit files and check the exported samples against
the player's own arithmetic, computed here independently in integers.
"""

from __future__ import annotations

import contextlib
import hashlib
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

from selecta.workers import export_join
from selecta.workers.context import InputInvalid

RATE = 44_100


def _flac(path: Path, steps: np.ndarray, rate: int = RATE) -> Path:
    """A 24-bit FLAC of these integer steps (frames x channels)."""
    sf.write(str(path), (steps.astype(np.int32) << 8), rate, subtype="PCM_24", format="FLAC")
    return path


def _noise(seed: int, frames: int, channels: int = 2) -> np.ndarray:
    return np.random.default_rng(seed).integers(-(1 << 22), 1 << 22, (frames, channels))


class World:
    def __init__(self, tmp_path: Path):
        self.tmp = tmp_path
        self.files: dict[str, Path] = {}
        self.progress: list[tuple[float, float]] = []
        self.published: dict = {}
        scratch = tmp_path / "scratch"
        scratch.mkdir()
        self.ctx = SimpleNamespace(scratch=scratch, store=object(), check_in=lambda: None,
                                   progress=lambda d, t=None: self.progress.append((d, t)),
                                   open_input=self.open_input, publish=self.publish)

    def add(self, key: str, steps: np.ndarray, rate: int = RATE) -> dict:
        path = _flac(self.tmp / f"{key}.flac", steps, rate)
        self.files[key] = path
        return {"key": key, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}

    @contextlib.contextmanager
    def open_input(self, key):
        yield self.files[key]

    def publish(self, kind, input_hash, source, name, provenance=None):
        self.published = {"kind": kind, "input_hash": input_hash, "path": Path(source),
                          "provenance": provenance}
        return SimpleNamespace(keys=[f"w/ws/{kind}/{input_hash}/attempts/a/{name}"],
                               checksum="c" * 64, size_bytes=Path(source).stat().st_size)

    def export(self, timeline):
        job = SimpleNamespace(input_ref={"timeline": timeline})
        result = export_join.render_export(job, self.ctx)
        audio, rate = sf.read(str(self.published["path"]), dtype="int32", always_2d=True)
        assert rate == RATE
        return result, audio >> 8


def _player(steps: np.ndarray, gain_db: float | None) -> np.ndarray:
    """What the player sends out for these steps, as 24-bit steps: decode to float32 (step /
    2^23), a float32 GainNode at 10 ** (gain_db / 20), then rounded to the nearest step."""
    decoded = steps.astype(np.float32) / np.float32(1 << 23)
    gain = np.float32(1.0 if gain_db is None else 10.0 ** (gain_db / 20.0))
    out = np.rint((decoded * gain).astype(np.float64) * (1 << 23))
    return np.clip(out, -(1 << 23), (1 << 23) - 1).astype(np.int64)


def _cut(from_s: float, seconds: float, frames: int) -> slice:
    begin = int(np.floor(from_s * RATE + 0.5))
    return slice(begin, min(frames, begin + int(np.floor(seconds * RATE + 0.5))))


def test_the_export_is_the_player_output_sample_for_sample_at_every_join(tmp_path):
    world = World(tmp_path)
    a, seam, b = _noise(1, RATE * 3), _noise(2, RATE), _noise(3, RATE * 3)
    timeline = [
        {"kind": "song", **world.add("a", a), "from_s": 0.0, "seconds": 2.1234, "gain_db": -3.51},
        {"kind": "seam", **world.add("seam", seam), "from_s": 0.0, "seconds": 0.9876,
         "gain_db": 0.0},
        {"kind": "song", **world.add("b", b), "from_s": 0.4321, "seconds": 2.5, "gain_db": 1.25},
    ]
    result, out = world.export(timeline)

    expected = np.concatenate([
        _player(a[_cut(0.0, 2.1234, len(a))], -3.51),
        _player(seam[_cut(0.0, 0.9876, len(seam))], None),
        _player(b[_cut(0.4321, 2.5, len(b))], 1.25),
    ])
    assert out.shape == expected.shape
    assert np.array_equal(out, expected)
    # the transition clip is copied bit for bit: its level is built in
    first = _cut(0.0, 2.1234, len(a)).stop
    assert np.array_equal(out[first:first + 100], seam[:100])
    assert result["parts"] == 3 and result["songs"] == 2
    assert result["input_hash"] == export_join.export_hash(timeline)
    assert world.published["kind"] == "export"
    assert world.published["input_hash"] == export_join.export_hash(timeline)


def test_a_failed_transition_exports_as_the_straight_change_it_plays_as(tmp_path):
    """The timeline of a failed hand-off is the first song to its end and the next from its
    start, with no clip between: so is the export."""
    world = World(tmp_path)
    a, b = _noise(4, RATE * 2), _noise(5, RATE * 2)
    timeline = [
        {"kind": "song", **world.add("a", a), "from_s": 0.5, "seconds": 1.5, "gain_db": 0.0},
        {"kind": "song", **world.add("b", b), "from_s": 0.0, "seconds": 2.0, "gain_db": 0.0},
    ]
    _, out = world.export(timeline)
    assert np.array_equal(out, np.concatenate([a[int(0.5 * RATE):], b]))


def test_cuts_round_half_up_like_javascript_and_stop_at_the_files_last_sample(tmp_path):
    assert [export_join.js_round(x) for x in (0.5, 1.5, 2.5, 2.4999)] == [1, 2, 3, 2]
    # a clip a sample or two shorter than its `seconds` (rounded to 4 decimals) plays its real
    # last sample and no more
    assert export_join.span({"from_s": 0.0, "seconds": 1.00005}, RATE, RATE) == (0, RATE)
    world = World(tmp_path)
    clip = _noise(6, RATE - 2)
    timeline = [
        {"kind": "seam", **world.add("clip", clip), "from_s": 0.0, "seconds": 1.0},
        {"kind": "song", **world.add("s", _noise(7, RATE)), "from_s": 0.0, "seconds": 0.5,
         "gain_db": 0.0},
    ]
    _, out = world.export(timeline)
    assert len(out) == RATE - 2 + RATE // 2


def test_a_mono_playback_file_plays_on_both_channels(tmp_path):
    world = World(tmp_path)
    mono = _noise(8, RATE, channels=1)
    timeline = [
        {"kind": "song", **world.add("m", mono), "from_s": 0.0, "seconds": 1.0, "gain_db": 0.0},
        {"kind": "song", **world.add("s", _noise(9, RATE)), "from_s": 0.0, "seconds": 0.1,
         "gain_db": 0.0},
    ]
    _, out = world.export(timeline)
    assert np.array_equal(out[:RATE, 0], mono[:, 0]) and np.array_equal(out[:RATE, 1], mono[:, 0])


def test_progress_counts_parts_written_and_the_upload(tmp_path):
    world = World(tmp_path)
    timeline = [
        {"kind": "song", **world.add(f"s{n}", _noise(10 + n, RATE // 4)), "from_s": 0.0,
         "seconds": 0.25, "gain_db": 0.0}
        for n in range(3)
    ]
    world.export(timeline)
    assert world.progress == [(0, 4), (1, 4), (2, 4), (3, 4), (4, 4)]


def test_a_part_that_does_not_match_its_checksum_is_refused(tmp_path):
    world = World(tmp_path)
    timeline = [
        {"kind": "song", **world.add("a", _noise(20, RATE)), "from_s": 0.0, "seconds": 1.0},
        {"kind": "song", **world.add("b", _noise(21, RATE)), "from_s": 0.0, "seconds": 1.0},
    ]
    timeline[1]["sha256"] = "0" * 64
    with pytest.raises(InputInvalid, match="checksum"):
        world.export(timeline)
    assert not world.published


@pytest.mark.parametrize("ref, words", [
    ({"songs": [{"source_sha256": "a" * 64}] * 2}, "Ask for the export again"),
    ({"timeline": [{"kind": "song", "key": "k", "sha256": "a" * 64, "from_s": 0,
                    "seconds": 1}]}, "two to"),
    ({"timeline": [{"kind": "loop", "key": "k", "sha256": "a" * 64, "from_s": 0,
                    "seconds": 1}] * 2}, "song or a transition"),
    ({"timeline": [{"kind": "song", "key": "k", "sha256": "a" * 64, "from_s": -1,
                    "seconds": 1}] * 2}, "impossible"),
    ({"timeline": [{"kind": "seam", "key": "k", "sha256": "a" * 64, "from_s": 0,
                    "seconds": 1}] * 2}, "at least one song"),
])
def test_bad_or_old_export_inputs_are_refused_in_plain_words(tmp_path, ref, words):
    world = World(tmp_path)
    with pytest.raises(InputInvalid, match=words):
        export_join.render_export(SimpleNamespace(input_ref=ref), world.ctx)


def test_the_export_hash_follows_the_timeline_content_not_its_object_keys():
    part = {"kind": "song", "key": "w/ws/playback/x/attempts/1/playback.flac",
            "sha256": "a" * 64, "from_s": 1.0, "seconds": 90.0, "gain_db": -2.0}
    seam = {"kind": "seam", "key": "w/ws/seam/y/attempts/1/seam.flac", "sha256": "b" * 64,
            "from_s": 0.0, "seconds": 16.0}
    base = export_join.export_hash([part, seam])
    assert export_join.export_hash([{**part, "key": "elsewhere"}, seam]) == base
    for change in ({"from_s": 1.5}, {"seconds": 91.0}, {"gain_db": -1.0}, {"sha256": "c" * 64}):
        assert export_join.export_hash([{**part, **change}, seam]) != base
