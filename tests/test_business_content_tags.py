"""BZ-0450-02: the explicit flag from real files' tags, one generated file per container.

MP3 (ID3 `TXXX:ITUNESADVISORY`), FLAC and Ogg Vorbis (Vorbis comments `ITUNESADVISORY` or
`EXPLICIT`) are written by libsndfile and tagged with mutagen; the MP4 is a minimal hand-built
`ftyp` + `moov` that mutagen tags with `rtng`. Conflicting or missing tags give `unknown`, and a
tag reading never replaces a person's choice.
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest

from selecta.business.content.tags import explicit_from_tags, merge_tag_reading


def _audio(path: Path, fmt: str, subtype: str | None = None) -> Path:
    soundfile = pytest.importorskip("soundfile")
    soundfile.write(str(path), np.zeros((4410, 1), dtype="float32"), 44100, format=fmt,
                    subtype=subtype)
    return path


def mp3(tmp_path: Path, advisory: list[str] | None) -> Path:
    from mutagen.id3 import ID3, TXXX

    path = tmp_path / "song.mp3"
    path.write_bytes(b"\xff\xfb\x90\x00" + b"\x00" * 413)
    tags = ID3()
    if advisory:  # one frame per description; a conflict is two values in it
        tags.add(TXXX(encoding=3, desc="ITUNESADVISORY", text=advisory))
    tags.save(path)
    return path


def vorbis(tmp_path: Path, kind: str, comments: dict[str, str]) -> Path:
    from mutagen.flac import FLAC
    from mutagen.oggvorbis import OggVorbis

    if kind == "flac":
        path = _audio(tmp_path / "song.flac", "FLAC", "PCM_16")
        audio = FLAC(path)
    else:
        path = _audio(tmp_path / "song.ogg", "OGG", "VORBIS")
        audio = OggVorbis(path)
    for key, value in comments.items():
        audio[key] = value
    audio.save()
    return path


def mp4(tmp_path: Path, rtng: int | None) -> Path:
    from mutagen.mp4 import MP4

    def atom(name: bytes, body: bytes = b"") -> bytes:
        return struct.pack(">I", 8 + len(body)) + name + body

    mvhd = atom(b"mvhd", b"\x00" * 12 + struct.pack(">II", 1000, 0) + b"\x00" * 80)
    path = tmp_path / "song.m4a"
    path.write_bytes(atom(b"ftyp", b"M4A \x00\x00\x00\x00M4A mp42isom") + atom(b"moov", mvhd))
    if rtng is not None:
        audio = MP4(path)
        audio.add_tags()
        audio.tags["rtng"] = [rtng]
        audio.save()
    return path


@pytest.mark.parametrize(("advisory", "expected"), [
    (["1"], "explicit"), (["2"], "clean"), ([], "unknown"), (["1", "2"], "unknown"),
])
def test_id3_advisory(tmp_path, advisory, expected):
    assert explicit_from_tags(mp3(tmp_path, advisory)) == expected


@pytest.mark.parametrize("kind", ["flac", "ogg"])
@pytest.mark.parametrize(("comments", "expected"), [
    ({"ITUNESADVISORY": "1"}, "explicit"), ({"ITUNESADVISORY": "2"}, "clean"),
    ({"EXPLICIT": "yes"}, "explicit"), ({"EXPLICIT": "no"}, "clean"), ({}, "unknown"),
    ({"ITUNESADVISORY": "2", "EXPLICIT": "yes"}, "unknown"),
])
def test_vorbis_comments(tmp_path, kind, comments, expected):
    assert explicit_from_tags(vorbis(tmp_path, kind, comments)) == expected


@pytest.mark.parametrize(("rtng", "expected"), [
    (1, "explicit"), (2, "clean"), (4, "clean"), (0, "unknown"), (None, "unknown"),
])
def test_mp4_rating(tmp_path, rtng, expected):
    assert explicit_from_tags(mp4(tmp_path, rtng)) == expected


def test_a_file_that_is_not_audio_reads_unknown(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_text("hello")
    assert explicit_from_tags(path) == "unknown"


@pytest.mark.parametrize("source", ["manual", "bulk", "import"])
def test_a_tag_never_replaces_a_persons_choice(source):
    assert merge_tag_reading("clean", source, "explicit") is None


def test_a_tag_fills_in_or_updates_an_earlier_tag():
    assert merge_tag_reading(None, None, "explicit") == ("explicit", "tag")
    assert merge_tag_reading("clean", "tag", "explicit") == ("explicit", "tag")
    assert merge_tag_reading("explicit", "tag", "explicit") is None
