"""The audio id (`library.audio_identity`, docs/engineering/audio-identity.md) on the shared
fixtures: every file gives the id in the manifest, each group shares one id, malformed files give
none, and reading in tiny pieces gives the same answer. The browser runs the same manifest in
`web/src/media/audioIdentity.test.ts`. Synthetic files only (tools/audio_identity_fixtures.py).
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
from pathlib import Path

import pytest

from selecta.library import audio_identity
from selecta.library.audio_identity import PATTERN, audio_id, audio_id_of, both_hashes

FOLDER = Path(__file__).parent / "fixtures" / "audio_identity"
MANIFEST = json.loads((FOLDER / "manifest.json").read_text(encoding="utf-8"))
ENTRIES = MANIFEST["files"]


def _bytes(entry) -> bytes:
    """A fixture's bytes. They travel in the manifest: the repo ignores audio file names."""
    return base64.b64decode(entry["bytes"])


@pytest.fixture
def on_disk(tmp_path):
    def write(entry) -> Path:
        path = tmp_path / entry["file"]
        path.write_bytes(_bytes(entry))
        return path

    return write


def test_the_manifest_is_the_a1_rules_and_covers_every_format():
    assert MANIFEST["version"] == "a1"
    prefixes = {entry["file"].split("-")[0] for entry in ENTRIES}
    assert {"mp3", "flac", "mp4", "wav", "aiff", "ogg"} <= prefixes
    assert all(PATTERN.fullmatch(entry["audio_id"]) for entry in ENTRIES if entry["audio_id"])


@pytest.mark.parametrize("entry", ENTRIES, ids=[entry["file"] for entry in ENTRIES])
def test_each_fixture_has_its_manifest_id(entry, on_disk):
    path = on_disk(entry)
    assert path.stat().st_size == entry["size"]
    assert audio_id(path) == entry["audio_id"]


def test_the_files_of_a_group_share_one_id_and_groups_differ():
    groups: dict[str, set[str | None]] = {}
    for entry in ENTRIES:
        if entry["group"]:
            groups.setdefault(entry["group"], set()).add(entry["audio_id"])
    assert all(len(ids) == 1 and None not in ids for ids in groups.values())
    firsts = [next(iter(ids)) for ids in groups.values()]
    assert len(set(firsts)) == len(firsts)


def test_malformed_and_unknown_files_have_no_id(on_disk):
    bad = [entry for entry in ENTRIES if "-bad-" in entry["file"]]
    assert bad
    assert all(entry["audio_id"] is None and entry["group"] is None for entry in bad)
    for entry in bad:
        assert audio_id(on_disk(entry)) is None


@pytest.mark.parametrize("entry", ENTRIES, ids=[entry["file"] for entry in ENTRIES])
def test_tiny_pieces_give_the_same_ids(entry, monkeypatch):
    data = _bytes(entry)
    monkeypatch.setattr(audio_identity, "CHUNK", 7)
    assert audio_id_of(io.BytesIO(data)) == entry["audio_id"]
    whole, audio, read = both_hashes(io.BytesIO(data), len(data))
    assert whole == hashlib.sha256(data).hexdigest()
    assert audio == entry["audio_id"]
    assert read == len(data)


def test_both_hashes_reads_the_file_once_from_the_start():
    entry = next(entry for entry in ENTRIES if entry["file"] == "mp4-a-split.m4b")
    data = _bytes(entry)
    seen: list[bytes] = []
    whole, audio, _read = both_hashes(io.BytesIO(data), len(data), on_block=seen.append)
    assert b"".join(seen) == data
    assert (whole, audio) == (hashlib.sha256(data).hexdigest(), entry["audio_id"])


def test_a_file_that_cannot_be_opened_has_no_id(tmp_path):
    assert audio_id(tmp_path / "gone.mp3") is None
