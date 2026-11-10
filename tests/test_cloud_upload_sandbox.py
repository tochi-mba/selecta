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
