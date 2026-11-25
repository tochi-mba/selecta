"""ADR-0478 FL-0478-02: the local app shows the picture inside a song's own file.

Files are written here with soundfile and tagged with mutagen, so nothing leaves this machine.
These prove the front cover is chosen, a picture is kept once by its own hash, a file with no
picture or a damaged one is simply no cover, the route answers with sensible cache headers and a
304, and the route is gone while `library.art_embedded` is off.
"""

from __future__ import annotations

import base64
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, ID3
from mutagen.oggvorbis import OggVorbis

from selecta import db, flags
from selecta.api import create_app
from selecta.config import Settings
from selecta.library import art

JPEG = b"\xff\xd8\xff\xe0" + b"front-cover" * 20
BACK = b"\xff\xd8\xff\xe0" + b"back-cover" * 20
PNG = b"\x89PNG\r\n\x1a\n" + b"png-cover" * 20
RATE = 22_050


def _tone(path: Path, kind: str | None = None) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, np.zeros(RATE, np.float32), RATE, format=kind)
    return path


def _flac(tmp_path: Path, *pictures: tuple[int, bytes], name: str = "song.flac") -> Path:
    path = _tone(tmp_path / "music" / name)
    audio = FLAC(path)
    for kind, data in pictures:
        picture = Picture()
        picture.type = kind
        picture.mime = "image/jpeg"
        picture.data = data
        audio.add_picture(picture)
    audio.save()
    return path


@pytest.fixture(autouse=True)
def _flags():
    flags.use(None)
    yield
    flags.use(None)


def test_the_front_cover_wins_over_a_back_cover(tmp_path):
    path = _flac(tmp_path, (4, BACK), (3, JPEG))
    assert art.read_picture(path) == (JPEG, "image/jpeg")


def test_an_id3_picture_is_read_and_its_real_type_sniffed(tmp_path):
    path = _tone(tmp_path / "music" / "song.wav")
    tags = ID3()
    # the tag says jpeg, the bytes are a png: the bytes are believed
    tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="", data=PNG))
    tags.save(path)
    assert art.read_picture(path) == (PNG, "image/png")


def test_an_ogg_picture_block_is_read(tmp_path):
    path = _tone(tmp_path / "music" / "song.ogg", "OGG")
    picture = Picture()
    picture.type = 3
    picture.mime = "image/jpeg"
    picture.data = JPEG
    audio = OggVorbis(path)
    audio["metadata_block_picture"] = [base64.b64encode(picture.write()).decode("ascii")]
    audio.save()
    assert art.read_picture(path) == (JPEG, "image/jpeg")


def test_no_picture_a_damaged_file_or_a_non_picture_is_no_cover(tmp_path):
    plain = _tone(tmp_path / "music" / "plain.flac")
    junk = tmp_path / "music" / "junk.mp3"
    junk.write_bytes(b"not audio at all")
    not_a_picture = _flac(tmp_path, (3, b"<svg>nope</svg>"), name="svg.flac")
    assert art.read_picture(plain) is None
    assert art.read_picture(junk) is None
    assert art.read_picture(not_a_picture) is None
    assert art.read_picture(tmp_path / "gone.flac") is None


def test_a_picture_past_the_cap_is_skipped(tmp_path, monkeypatch):
    monkeypatch.setattr(art, "MAX_PICTURE_BYTES", 64)
    path = _flac(tmp_path, (3, JPEG))
    assert art.read_picture(path) is None


def test_one_album_keeps_its_cover_once_and_a_file_is_read_once(tmp_path, monkeypatch):
    home = tmp_path / "home"
    first = _flac(tmp_path, (3, JPEG), name="one.flac")
    second = _flac(tmp_path, (3, JPEG), name="two.flac")
    assert art.warm(home, [str(first), str(second)]) == 2
    pictures = list((home / "art" / "v1" / "pictures").iterdir())
    assert len(pictures) == 1
    assert pictures[0].read_bytes() == JPEG

    def no_reading(_path):
        raise AssertionError("read the file again")

    monkeypatch.setattr(art, "_read", no_reading)
    cover = art.cover_for(home, str(first))
    assert cover is not None and cover.mime == "image/jpeg"


def test_a_file_with_no_picture_is_remembered_until_it_changes(tmp_path, monkeypatch):
    home = tmp_path / "home"
    path = _tone(tmp_path / "music" / "plain.flac")
    assert art.cover_for(home, str(path)) is None
    reads: list[Path] = []
    real = art._read

    def counted(target):
        reads.append(target)
        return real(target)

    monkeypatch.setattr(art, "_read", counted)
    assert art.cover_for(home, str(path)) is None
    assert reads == []


def test_warming_stops_when_asked_and_never_raises(tmp_path):
    home = tmp_path / "home"
    good = _flac(tmp_path, (3, JPEG))
    assert art.warm(home, [str(good)], should_stop=lambda: True) == 0
    assert art.warm(home, [str(tmp_path / "gone.flac"), str(good)]) == 1


def test_a_scan_lists_the_files_it_read_for_their_covers(tmp_path):
    from selecta.library.scan import scan_folder

    settings = Settings(tmp_path / "home")
    settings.ensure_dirs()
    path = _flac(tmp_path, (3, JPEG))
    conn = db.connect(settings.db_path)
    try:
        report = scan_folder(conn, path.parent)
        assert report.fresh == [str(path.resolve())]
        again = scan_folder(conn, path.parent)
        assert again.fresh == []
    finally:
        conn.close()


@pytest.fixture
def client(tmp_path):
    settings = Settings(tmp_path / "home")
    settings.ensure_dirs()
    covered = _flac(tmp_path, (3, JPEG), name="covered.flac")
    plain = _tone(tmp_path / "music" / "plain.flac")
    conn = db.connect(settings.db_path)
    for path in (covered, plain):
        conn.execute(
            "INSERT INTO songs(path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,?,?,?,?,?,1)",
            (str(path), ".", 1, 1.0, 1.0, "Artist", path.stem),
        )
    conn.commit()
    conn.close()
    return TestClient(create_app(settings, tmp_path / "no-web"))


def test_the_route_serves_the_cover_with_a_tag_and_a_304(client):
    first = client.get("/api/songs/1/art")
    assert first.status_code == 200
    assert first.content == JPEG
    assert first.headers["content-type"] == "image/jpeg"
    assert first.headers["cache-control"] == art.CACHE_CONTROL
    assert first.headers["x-content-type-options"] == "nosniff"
    again = client.get("/api/songs/1/art", headers={"If-None-Match": first.headers["etag"]})
    assert again.status_code == 304


def test_the_route_says_no_content_for_a_file_with_no_cover_and_404_for_no_song(client):
    plain = client.get("/api/songs/2/art")
    assert plain.status_code == 204
    assert plain.content == b""
    assert client.get("/api/songs/99/art").status_code == 404


def test_the_route_is_gone_with_the_flag_off(client):
    flags.use("-library.art_embedded")
    assert client.get("/api/songs/1/art").status_code == 404
