"""The upload validation sandbox against the hostile-file test set (ADR-0398, SC-0398-04).

Decode bombs, files that lie in their headers, fake extensions and cut-short files are each
refused with a stable code, inside the sandbox's limits, and through the API they leave nothing
behind: no asset, no staged object, no temporary folder and no bytes charged. Real files of
every format Cloud takes are kept. The sandbox's own limits (timeout, answer size, crashes,
memory and file caps on POSIX, a scrubbed environment) are tested with stand-in children.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time

import pytest
import sqlalchemy as sa
from test_cloud_upload_api import HEADERS, ClosingS3, _cloud_app, _plan, _send
from upload_hostile_files import GOOD, HOSTILE, flac, has_ffmpeg, m4a

from selecta.storage import api as upload_api
from selecta.storage import audio_check
from selecta.storage.audio_check import Limits, Rejected
from selecta.storage.sandbox import DEFAULT_LIMITS, probe_in_sandbox, run_child
from selecta.storage.schema import assets as assets_table
from selecta.usage import quota

WS = "workspace-a"
# Generous for a cold Python start on a loaded CI runner; the default limit is 120 s.
SLOW_START = 30.0


def _python(code: str) -> list[str]:
    return [sys.executable, "-I", "-c", code]


@pytest.mark.parametrize("name", list(HOSTILE))
def test_each_hostile_file_is_refused_with_its_code_within_the_limits(tmp_path, name):
    build, code = HOSTILE[name]
    path = build(tmp_path / "upload.bin")
    started = time.monotonic()
    with pytest.raises(Rejected) as refused:
        probe_in_sandbox(path)
    assert refused.value.code == code
    assert str(refused.value) == audio_check.MESSAGES[code]
    assert time.monotonic() - started < min(SLOW_START, DEFAULT_LIMITS.timeout_s)


@pytest.mark.parametrize("fmt", list(GOOD))
def test_real_files_of_every_format_are_kept(tmp_path, fmt):
    path = GOOD[fmt](tmp_path / "song.bin")
    found = probe_in_sandbox(path)
    assert found.format == fmt
    assert found.duration_s == pytest.approx(3.0, abs=0.1)
    assert found.sample_rate == 44_100 and found.size == path.stat().st_size


@pytest.mark.skipif(not has_ffmpeg(), reason="needs ffmpeg to make and decode AAC")
def test_a_real_m4a_is_decoded_by_ffmpeg_and_kept(tmp_path):
    found = probe_in_sandbox(m4a(tmp_path / "song.m4a"))
    assert found.format == "m4a" and found.duration_s == pytest.approx(3.0, abs=0.2)


def test_the_contents_decide_the_format_not_the_name(tmp_path):
    path = flac(tmp_path / "song.mp3")
    assert probe_in_sandbox(path).format == "flac"


def test_a_decode_bomb_is_stopped_part_way_not_decoded_to_the_end(tmp_path):
    # 30 one-second blocks claimed and present, but the budget allows only a few seconds' PCM.
    path = HOSTILE["five minutes of silence in a tiny FLAC"][0](tmp_path / "bomb.flac")
    limits = Limits(max_expansion=1.0, expansion_floor_bytes=1024 * 1024)
    budget = audio_check._Budget(path.stat().st_size, 300.0, 44_100, 2, limits)
    with pytest.raises(Rejected) as refused:
        audio_check._decode_soundfile(str(path), budget)
    assert refused.value.code == "decode_bomb"
    assert budget.frames * 4 <= limits.expansion_floor_bytes + audio_check.BLOCK_FRAMES * 4


def test_a_header_that_understates_the_audio_is_stopped_at_the_claim(tmp_path):
    path = GOOD["wav"](tmp_path / "song.wav")  # three seconds
    budget = audio_check._Budget(path.stat().st_size, 0.5, 44_100, 1, DEFAULT_LIMITS)
    with pytest.raises(Rejected) as refused:
        audio_check._decode_soundfile(str(path), budget)
    assert refused.value.code == "decode_bomb"


def test_sniffing_reads_magic_bytes_only():
    sniff = audio_check.sniff
    assert sniff(b"RIFF\0\0\0\0WAVEfmt ") == "wav"
    assert sniff(b"FORM\0\0\0\0AIFF") == "aiff"
    assert sniff(b"OggS\0\2") == "ogg"
    assert sniff(b"\0\0\0\x20ftypM4A ") == "m4a"
    assert sniff(b"fLaC\0\0\0\x22") == "flac"
    assert sniff(b"ID3\4\0\0\0\0\0\2xxfLaC") == "flac"
    assert sniff(b"\xff\xfb\x90\x64") == "mp3"
    assert sniff(b"\xff\xf1\x50\x80") == "aac"
    for junk in (b"", b"MZ\x90\0", b"PK\3\4", b"%PDF-1.7", b"<html>", b"\xff\xff\xff"):
        assert sniff(junk) is None


def test_a_hung_child_is_killed_at_the_timeout(tmp_path):
    path = GOOD["wav"](tmp_path / "song.wav")
    started = time.monotonic()
    with pytest.raises(Rejected) as refused:
        probe_in_sandbox(
            path, Limits(timeout_s=1.0), command=_python("import time; time.sleep(60)")
        )
    assert refused.value.code == "validation_timeout"
    assert time.monotonic() - started < 10


def test_a_child_that_answers_too_much_is_killed_and_refused(tmp_path):
    path = GOOD["wav"](tmp_path / "song.wav")
    flood = "import sys\nwhile True: sys.stdout.write('x' * 65536)"
    with pytest.raises(Rejected) as refused:
        probe_in_sandbox(path, Limits(timeout_s=SLOW_START), command=_python(flood))
    assert refused.value.code == "validation_failed"


@pytest.mark.parametrize(
    "code",
    [
        "import sys; sys.exit(3)",
        "print('not json')",
        "print('[1, 2]')",
        'print(\'{"ok": false, "code": "made_up_code"}\')',
        'print(\'{"ok": true, "format": "wav"}\')',
    ],
)
def test_a_crashed_or_garbled_child_refuses_the_file(tmp_path, code):
    path = GOOD["wav"](tmp_path / "song.wav")
    with pytest.raises(Rejected) as refused:
        probe_in_sandbox(path, command=_python(code))
    assert refused.value.code == "validation_failed"


def test_the_child_sees_no_secrets_from_the_api_process(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_R2_SECRET_ACCESS_KEY", "do-not-pass")
    monkeypatch.setenv("SELECTA_ROOMS_PEPPER", "do-not-pass-either")
    path = GOOD["wav"](tmp_path / "song.wav")
    show = "import json, os; print(json.dumps({'ok': False, 'env': sorted(os.environ)}))"
    answer = run_child(path, DEFAULT_LIMITS, _python(show))
    assert not [name for name in answer["env"] if name.startswith("SELECTA_")]
    assert {"OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS"} <= set(answer["env"])


@pytest.mark.skipif(
    os.name != "posix", reason="resource limits are POSIX; Windows uses the timeout"
)
def test_on_posix_the_child_caps_its_memory_cpu_and_writes(tmp_path):
    path = GOOD["wav"](tmp_path / "song.wav")
    answer = run_child(path, DEFAULT_LIMITS)
    assert answer["ok"] is True
    rlimits = answer["rlimits"]
    assert rlimits["RLIMIT_AS"] <= DEFAULT_LIMITS.memory_bytes
    assert rlimits["RLIMIT_FSIZE"] == 0
    assert rlimits["RLIMIT_CPU"] <= DEFAULT_LIMITS.timeout_s + 1


@pytest.mark.skipif(
    os.name != "posix", reason="resource limits are POSIX; Windows uses the timeout"
)
def test_on_posix_a_child_that_balloons_past_its_memory_cap_is_refused(tmp_path):
    path = GOOD["wav"](tmp_path / "song.wav")
    balloon = (
        "from selecta.storage.audio_check import Limits, apply_limits\n"
        "apply_limits(Limits(memory_bytes=512 * 1024 * 1024))\n"
        "hog = bytearray(4 * 1024 * 1024 * 1024)\n"
        "print('{\"ok\": true}')\n"
    )
    with pytest.raises(Rejected) as refused:
        probe_in_sandbox(path, command=_python(balloon))
    assert refused.value.code == "validation_failed"


# -- through the API: refused, and nothing left behind -------------------------------------------


def _upload(client, objects, data: bytes, name: str) -> dict:
    (planned,) = _plan(client, {"name": name, "size": len(data)})
    _send(objects, data)
    answer = client.post(f"/api/uploads/{planned['session']['id']}/complete", headers=HEADERS)
    assert answer.status_code == 200, answer.text
    return answer.json()


@pytest.fixture
def scratch(tmp_path, monkeypatch):
    """The API's temporary folders go here, so the test can see none are left."""
    folder = tmp_path / "temp"
    folder.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(folder))
    return folder


@pytest.mark.parametrize("name", list(HOSTILE))
def test_a_hostile_upload_is_rejected_with_its_code_and_leaves_nothing(
    cloud_engine, tmp_path, scratch, name
):
    build, code = HOSTILE[name]
    data = build(tmp_path / "upload.bin").read_bytes()
    if not data:
        pytest.skip("an empty file is refused at planning, before any upload exists")
    objects = ClosingS3()
    with _cloud_app(cloud_engine, objects, probe=upload_api._probe_audio) as client:
        body = _upload(client, objects, data, "song.mp3")
    assert body["status"] == "rejected" and body["asset_id"] is None
    assert body["rejection_code"] == code
    assert body["error"] == audio_check.MESSAGES[code]
    assert objects.objects == {} and objects.uploads == {}
    assert list(scratch.iterdir()) == []
    with cloud_engine.connect() as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(assets_table)).scalar() == 0
        usage = quota.usage(conn, WS)
        assert (usage.reserved_bytes, usage.committed_bytes) == (0, 0)


def test_a_zero_byte_upload_is_refused_before_any_bytes_are_reserved(cloud_engine):
    objects = ClosingS3()
    with _cloud_app(cloud_engine, objects, probe=upload_api._probe_audio) as client:
        answer = client.post(
            "/api/uploads/plan", headers=HEADERS, json={"files": [{"name": "a.mp3", "size": 0}]}
        )
    assert answer.status_code == 422
    assert objects.uploads == {}


def test_a_good_upload_after_hostile_ones_is_kept(cloud_engine, tmp_path, scratch):
    objects = ClosingS3()
    with _cloud_app(cloud_engine, objects, probe=upload_api._probe_audio) as client:
        bad = _upload(
            client, objects, HOSTILE["MP3 cut in half"][0](tmp_path / "a").read_bytes(), "a.mp3"
        )
        assert bad["rejection_code"] == "truncated"
        data = GOOD["flac"](tmp_path / "b.flac").read_bytes()
        good = _upload(client, objects, data, "b.flac")
    assert good["status"] == "accepted" and "rejection_code" not in good
    assert list(scratch.iterdir()) == []
    with cloud_engine.connect() as conn:
        row = conn.execute(sa.select(assets_table)).mappings().one()
        assert row["format"] == "flac" and row["channels"] == 2
        usage = quota.usage(conn, WS)
        assert (usage.reserved_bytes, usage.committed_bytes) == (0, len(data))


def test_the_child_answers_one_json_line(tmp_path):
    path = GOOD["wav"](tmp_path / "song.wav")
    answer = run_child(path, DEFAULT_LIMITS)
    assert json.loads(json.dumps(answer))["format"] == "wav"


# -- the child's checks, run in this process (so coverage sees them) ------------------------------


@pytest.mark.parametrize("name", list(HOSTILE))
def test_each_hostile_file_is_refused_by_the_checks_themselves(tmp_path, name):
    build, code = HOSTILE[name]
    path = build(tmp_path / "upload.bin")
    with pytest.raises(Rejected) as refused:
        audio_check.inspect(str(path), DEFAULT_LIMITS)
    assert refused.value.code == code


@pytest.mark.parametrize("fmt", list(GOOD))
def test_the_checks_keep_real_files(tmp_path, fmt):
    found = audio_check.inspect(str(GOOD[fmt](tmp_path / "song.bin")), DEFAULT_LIMITS)
    assert found["format"] == fmt and found["duration_s"] == pytest.approx(3.0, abs=0.1)


@pytest.mark.skipif(not has_ffmpeg(), reason="needs ffmpeg to make and decode AAC")
def test_the_checks_decode_m4a_with_ffmpeg(tmp_path):
    found = audio_check.inspect(str(m4a(tmp_path / "song.m4a")), DEFAULT_LIMITS)
    assert found["format"] == "m4a" and found["duration_s"] == pytest.approx(3.0, abs=0.2)


def test_without_ffmpeg_an_m4a_cannot_be_checked(tmp_path, monkeypatch):
    def missing(*_args, **_kwargs):
        raise FileNotFoundError("ffmpeg")

    monkeypatch.setattr(audio_check.subprocess, "Popen", missing)
    budget = audio_check._Budget(1000, 3.0, 44_100, 1, DEFAULT_LIMITS)
    with pytest.raises(Rejected) as refused:
        audio_check._decode_ffmpeg(str(tmp_path / "song.m4a"), budget)
    assert refused.value.code == "validation_failed"


def test_a_file_over_the_size_cap_is_refused_unread(tmp_path):
    path = GOOD["wav"](tmp_path / "song.wav")
    with pytest.raises(Rejected) as refused:
        audio_check.inspect(str(path), Limits(max_file_bytes=1024))
    assert refused.value.code == "file_too_large"
    with pytest.raises(Rejected) as refused:
        probe_in_sandbox(path, Limits(max_file_bytes=1024))
    assert refused.value.code == "file_too_large"


def test_a_slow_decode_stops_at_the_deadline(tmp_path):
    path = GOOD["flac"](tmp_path / "song.flac")
    budget = audio_check._Budget(path.stat().st_size, 3.0, 44_100, 2, Limits(timeout_s=-1.0))
    with pytest.raises(Rejected) as refused:
        audio_check._decode_soundfile(str(path), budget)
    assert refused.value.code == "validation_timeout"


def test_a_decoder_that_disagrees_with_the_header_is_a_mismatch(tmp_path):
    path = GOOD["wav"](tmp_path / "song.wav")
    budget = audio_check._Budget(path.stat().st_size, 3.0, 48_000, 1, DEFAULT_LIMITS)
    with pytest.raises(Rejected) as refused:
        audio_check._decode_soundfile(str(path), budget)
    assert refused.value.code == "format_mismatch"


def test_a_reader_of_another_format_is_a_mismatch(tmp_path, monkeypatch):
    found = type("FLAC", (), {"info": object()})()
    monkeypatch.setattr("mutagen.File", lambda *_a, **_k: found)
    with pytest.raises(Rejected) as refused:
        audio_check._header(str(tmp_path / "x"), "mp3")
    assert refused.value.code == "format_mismatch"


def test_header_numbers_that_are_not_numbers_are_a_bad_header(tmp_path, monkeypatch):
    info = type("Info", (), {"length": "forever", "sample_rate": 1, "channels": 1})()
    found = type("MP3", (), {"info": info})()
    monkeypatch.setattr("mutagen.File", lambda *_a, **_k: found)
    with pytest.raises(Rejected) as refused:
        audio_check._header(str(tmp_path / "x"), "mp3")
    assert refused.value.code == "bad_header"


@pytest.mark.parametrize(
    ("head", "code"),
    [
        (b"RIFF\0\0\0\0WAVEjunk\4\0\0\0abcd", "corrupt"),  # no data chunk at all
        (b"RIFF\0\0\0\0WAVEdata\4\0\0\0abcd", "bad_header"),  # data before any format
    ],
)
def test_a_wav_without_its_chunks_is_refused(head, code):
    with pytest.raises(Rejected) as refused:
        audio_check._check_wav_claim(head, len(head), DEFAULT_LIMITS)
    assert refused.value.code == code


def test_an_infinite_length_is_a_bad_header():
    with pytest.raises(Rejected) as refused:
        audio_check._check_header("ogg", 100, float("inf"), 44_100, 2, 0, DEFAULT_LIMITS)
    assert refused.value.code == "bad_header"


def _main(monkeypatch, request: str) -> dict:
    import io

    out = io.StringIO()
    monkeypatch.setattr(sys, "stdin", io.StringIO(request))
    monkeypatch.setattr(sys, "stdout", out)
    monkeypatch.setattr(audio_check, "apply_limits", lambda _limits: {"RLIMIT_AS": 1})
    assert audio_check.main() == 0
    return json.loads(out.getvalue())


def test_the_child_entry_point_answers_in_json(tmp_path, monkeypatch):
    good = GOOD["wav"](tmp_path / "song.wav")
    answer = _main(monkeypatch, json.dumps({"path": str(good), "limits": {"timeout_s": 30}}))
    assert answer["ok"] is True and answer["format"] == "wav" and answer["rlimits"]
    bad = HOSTILE["text renamed .flac"][0](tmp_path / "bad")
    answer = _main(monkeypatch, json.dumps({"path": str(bad)}))
    assert answer == {"ok": False, "code": "not_audio"}
    assert _main(monkeypatch, "not json") == {"ok": False, "code": "corrupt"}


def test_the_child_entry_point_turns_running_out_of_memory_into_a_refusal(tmp_path, monkeypatch):
    def balloon(_path, _limits):
        raise MemoryError

    monkeypatch.setattr(audio_check, "inspect", balloon)
    answer = _main(monkeypatch, json.dumps({"path": "x"}))
    assert answer == {"ok": False, "code": "validation_failed"}


def test_apply_limits_sets_every_cap_within_the_hard_limits(monkeypatch):
    import types

    calls: dict[int, tuple[int, int]] = {}
    fake = types.SimpleNamespace(
        RLIM_INFINITY=-1,
        RLIMIT_AS=1,
        RLIMIT_CPU=2,
        RLIMIT_FSIZE=3,
        RLIMIT_NOFILE=4,
        getrlimit=lambda which: (0, 32 if which == 4 else -1),
        setrlimit=lambda which, pair: calls.__setitem__(which, pair),
    )
    monkeypatch.setitem(sys.modules, "resource", fake)
    applied = audio_check.apply_limits(Limits(timeout_s=10, memory_bytes=1 << 30))
    assert applied == {
        "RLIMIT_AS": 1 << 30,
        "RLIMIT_CPU": 11,
        "RLIMIT_FSIZE": 0,
        "RLIMIT_NOFILE": 32,  # never above the hard limit already set
    }
    assert calls[1] == (1 << 30, 1 << 30) and 5 not in calls  # no RLIMIT_CORE on this fake


def test_apply_limits_does_nothing_where_there_are_no_resource_limits(monkeypatch):
    monkeypatch.setitem(sys.modules, "resource", None)
    assert audio_check.apply_limits(DEFAULT_LIMITS) == {}
