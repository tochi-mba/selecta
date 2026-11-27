"""One brain phase 2a: a script read back from JSON plays the same samples, names no files, and an
audit given vocal spans separates nothing."""

import json

import numpy as np
import pytest
import soundfile as sf
from helpers import song_from_track
from synth import SR, make_track

from selecta import audio as audio_io
from selecta.analysis import vocal_sense
from selecta.analysis.song import Cue
from selecta.audit import checks
from selecta.lyrics.align import Word
from selecta.render.engine import SongCache, in_context, render
from selecta.render.script import Curve
from selecta.render.script_json import ScriptJsonError, from_json, to_json
from selecta.render.sources import LocalFiles, SourceRef
from selecta.styles.blend import bass_swap_blend, filter_sweep
from selecta.styles.exits import cut_on_one, echo_out, reverb_wash
from selecta.styles.wordplay import Stem, word_cut

MAX_POINTS = 2000


def _cue(song, bar):
    return Cue(bar, song.bar_time(bar), "test", 0.8, 8)


@pytest.fixture
def pair(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=120, bars=48, seed=2, lead_in=0.31))
    a.id, b.id = 101, 202
    a.lufs = -17.5  # so the two sides carry different gains
    return a, b


class Library:
    """A resolver that knows songs only by id, as a cloud worker or browser would."""

    def __init__(self, songs, stems=None):
        self.songs = {song.id: audio_io.decode(song.path) for song in songs}
        self.stems = stems or {}

    def resolve(self, ref: SourceRef, local_path):
        assert local_path is None, "a script from JSON must not bring a local path"
        if ref.role == "mix":
            return self.songs[ref.song]
        return self.stems[(ref.song, ref.stem, ref.start, ref.duration)]


def _band_stem(tmp_path, song, origin, seconds):
    audio = audio_io.decode(song.path)
    lo = int(round(origin * SR))
    path = tmp_path / f"band_{song.id}.wav"
    sf.write(path, audio[lo : lo + int(round(seconds * SR))], SR, subtype="FLOAT")
    return Stem(str(path), origin, "band", seconds)


def _word_cut(tmp_path, a, b):
    cut_at = a.bar_time(24)
    enter = b.bar_time(8)
    stem = _band_stem(tmp_path, b, enter - 10.0, 20.0)
    script = word_cut(
        a,
        b,
        [Word("good", cut_at, cut_at + 0.4, 1.0)],
        [Word("good", enter, enter + 0.4, 1.0)],
        band_b=stem,
    )
    assert script is not None and script.extras and script.extras[0].stem == "band"
    return script, stem


def _scripts(tmp_path, a, b):
    yield bass_swap_blend(a, b, _cue(a, 24), _cue(b, 0), 8), {}
    yield filter_sweep(a, b, _cue(a, 24), _cue(b, 0), 8), {}
    yield cut_on_one(a, b, _cue(a, 24), _cue(b, 4)), {}
    yield echo_out(a, b, _cue(a, 24), _cue(b, 0), 2), {}
    yield reverb_wash(a, b, _cue(a, 24), _cue(b, 0), 2), {}
    script, stem = _word_cut(tmp_path, a, b)
    stems = {(b.id, "band", stem.origin, stem.duration): sf.read(stem.path, dtype="float32")[0]}
    yield script, stems


def _walk(value, found):
    if isinstance(value, dict):
        for item in value.values():
            _walk(item, found)
    elif isinstance(value, list):
        found["longest"] = max(found["longest"], len(value))
        for item in value:
            _walk(item, found)
    elif isinstance(value, str):
        found["strings"].append(value)


def test_every_recipe_family_renders_the_same_samples_after_a_round_trip(tmp_path, pair):
    a, b = pair
    for script, stems in _scripts(tmp_path, a, b):
        assert script is not None
        text = to_json(script)
        back = from_json(text)
        before = render(script)
        after = render(back, resolver=Library([a, b], stems))
        assert np.array_equal(before.audio, after.audio), script.style
        assert np.array_equal(before.a_dry, after.a_dry), script.style
        assert before.drift_ms == after.drift_ms
        assert to_json(back) == text, script.style

        data = json.loads(text)
        found = {"longest": 0, "strings": []}
        _walk(data, found)
        assert found["longest"] <= MAX_POINTS, script.style
        for value in found["strings"]:
            assert str(tmp_path.name) not in value
            assert "/" not in value and "\\" not in value and not value.endswith(".wav"), value


def test_in_context_from_json_matches_today(tmp_path, pair):
    a, b = pair
    script = cut_on_one(a, b, _cue(a, 24), _cue(b, 8))
    heard, at = in_context(render(script), 3.0, 3.0)
    back = from_json(to_json(script))
    library = Library([a, b])
    again, again_at = in_context(render(back, resolver=library), 3.0, 3.0, resolver=library)
    assert np.array_equal(heard, again) and at == again_at


def test_a_stem_part_is_named_by_song_stem_and_window(tmp_path, pair):
    a, b = pair
    script, stem = _word_cut(tmp_path, a, b)
    extra = json.loads(to_json(script))["extras"][0]
    assert extra["source"] == {
        "song": b.id,
        "role": "stem",
        "stem": "band",
        "window": {"start": stem.origin, "duration": stem.duration},
    }
    assert extra["facts"] == {"gain_db": b.gain_db}

    script.extras[0].stem = None
    with pytest.raises(ScriptJsonError, match="no stem name"):
        to_json(script)


def test_meta_curves_round_trip_and_unknown_values_raise(pair):
    a, b = pair
    script = bass_swap_blend(a, b, _cue(a, 24), _cue(b, 0), 8)
    script.meta["vocal_gains"] = {"a": Curve([(0.0, 1.0), (4.0, 0.0)]), "b": Curve.constant(0.5)}
    script.meta["arc"] = [np.float64(1.5), np.int64(2)]
    script.meta["shape"] = {"a": {"vocals": [1, 0]}}
    back = from_json(to_json(script))
    gains = back.meta["vocal_gains"]
    assert np.array_equal(gains["a"].times, [0.0, 4.0]) and np.array_equal(gains["b"].values, [0.5])
    assert back.meta["arc"] == [1.5, 2] and back.meta["shape"] == {"a": {"vocals": [1, 0]}}
    assert back.meta["swap"] == script.meta["swap"]

    script.meta["mystery"] = object()
    with pytest.raises(ScriptJsonError, match="mystery"):
        to_json(script)
    script.meta["mystery"] = np.zeros(3)
    with pytest.raises(ScriptJsonError, match="mystery"):
        to_json(script)


def test_the_default_resolver_reproduces_todays_audio(pair):
    a, b = pair
    script = echo_out(a, b, _cue(a, 24), _cue(b, 0), 2)
    assert np.array_equal(render(script).audio, render(script, SongCache(), LocalFiles()).audio)
    assert script.a.local_path == script.a.audio_path == a.path
    assert script.a.source == SourceRef(a.id)

    # a script from JSON names no file, so only a resolver that knows songs by id can play it
    with pytest.raises(LookupError):
        render(from_json(to_json(script)))


def test_audit_with_spans_separates_nothing_and_matches_sensing(monkeypatch, pair):
    a, b = pair
    a.vocals_known = b.vocals_known = False
    script = bass_swap_blend(a, b, _cue(a, 24), _cue(b, 0), 8)
    rendered = render(script)

    sensed = {}

    def fake_spans(settings, source, start, seconds):
        spans = [(start + 1.0, start + 9.0)]
        sensed[str(source)] = spans
        return spans

    monkeypatch.setattr(vocal_sense, "sense_on", lambda: True)
    monkeypatch.setattr(vocal_sense, "singing_spans", fake_spans)
    today = checks.audit(rendered)
    assert len(sensed) == 2

    def refuse(*args, **kwargs):
        raise AssertionError("the audit separated stems although spans were given")

    monkeypatch.setattr(vocal_sense, "singing_spans", refuse)
    monkeypatch.setattr("selecta.stems.separate_window", refuse)
    spans = {"a": sensed[a.path], "b": sensed[b.path]}
    given = checks.audit(rendered, vocal_spans=spans)
    assert [vars(c) for c in given.checks] == [vars(c) for c in today.checks]
    overlap = given.value("vocal overlap")
    assert overlap is not None and overlap > 0

def test_concrete_render_identity_uses_verified_sources_and_placement(pair):
    from selecta.render.cache_key import concrete_render_key

    a, b = pair
    hashes = {a.id: "a" * 64, b.id: "b" * 64}
    script = bass_swap_blend(a, b, _cue(a, 30), _cue(b, 8), 8)
    original = concrete_render_key(script, hashes, runtime_version="test-v1")
    assert original is not None
    assert concrete_render_key(script, {a.id: hashes[a.id]}, runtime_version="test-v1") is None
    assert concrete_render_key(script, hashes, runtime_version="test-v2") != original
    assert concrete_render_key(
        bass_swap_blend(a, b, _cue(a, 32), _cue(b, 8), 8), hashes, runtime_version="test-v1"
    ) != original
    assert concrete_render_key(
        script, {a.id: hashes[b.id], b.id: hashes[a.id]}, runtime_version="test-v1"
    ) != original

    remapped = {303: hashes[a.id], 404: hashes[b.id]}
    a.id, b.id = 303, 404
    remapped_script = bass_swap_blend(a, b, _cue(a, 30), _cue(b, 8), 8)
    assert concrete_render_key(remapped_script, remapped, runtime_version="test-v1") == original
