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
from mutagen.id3 import APIC
from mutagen.oggvorbis import OggVorbis
from mutagen.wave import WAVE

from selecta import db, flags
from selecta.api import create_app
from selecta.config import Settings
from selecta.library import art


# Pictures are made here, header bytes by hand: only the header is ever read (T-20261125-4054).
def _jpeg_bytes(width: int = 64, height: int = 64, filler: bytes = b"front-cover") -> bytes:
    app0 = b"\xff\xe0" + (16).to_bytes(2, "big") + b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof = (b"\xff\xc0" + (17).to_bytes(2, "big") + b"\x08" + height.to_bytes(2, "big")
           + width.to_bytes(2, "big") + b"\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01")
    return b"\xff\xd8" + app0 + sof + filler * 20 + b"\xff\xd9"


def _chunk(kind: bytes, body: bytes) -> bytes:
    return len(body).to_bytes(4, "big") + kind + body + b"\x00\x00\x00\x00"


def _png_bytes(width: int = 64, height: int = 64, *, animated: bool = False) -> bytes:
    ihdr = width.to_bytes(4, "big") + height.to_bytes(4, "big") + b"\x08\x06\x00\x00\x00"
    actl = _chunk(b"acTL", (4).to_bytes(4, "big") + b"\x00" * 4) if animated else b""
    return (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + actl
            + _chunk(b"IDAT", b"png-cover" * 20) + _chunk(b"IEND", b""))


def _gif_bytes(frames: int) -> bytes:
    edge = (10).to_bytes(2, "little")
    frame = b"\x2c" + b"\x00" * 4 + edge + edge + b"\x00\x02\x02\x4c\x01\x00"
    return b"GIF89a" + edge + edge + b"\x00\x00\x00" + frame * frames + b"\x3b"


def _webp_bytes(*, animated: bool) -> bytes:
    edge = (63).to_bytes(3, "little")
    vp8x = b"VP8X" + (10).to_bytes(4, "little") + (b"\x02" if animated else b"\x00") \
        + b"\x00" * 3 + edge + edge
    anim = b"ANIM" + (6).to_bytes(4, "little") + b"\x00" * 6 if animated else b""
    body = b"WEBP" + vp8x + anim
    return b"RIFF" + len(body).to_bytes(4, "little") + body


JPEG = _jpeg_bytes()
BACK = _jpeg_bytes(filler=b"back-cover")
PNG = _png_bytes()
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
    # an ID3 tag in the WAV's own "id3 " chunk, where taggers put it (a tag written in front of
    # the RIFF header makes the file read as a broken MP3)
    audio = WAVE(path)
    audio.add_tags()
    # the tag says jpeg, the bytes are a png: the bytes are believed
    audio.tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="", data=PNG))
    audio.save()
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


def test_the_header_gives_size_and_motion_without_decoding():
    assert art.picture_header(JPEG) == art.Header(64, 64, False)
    assert art.picture_header(_jpeg_bytes(1200, 900)) == art.Header(1200, 900, False)
    assert art.picture_header(PNG) == art.Header(64, 64, False)
    assert art.picture_header(_png_bytes(animated=True)).animated is True
    assert art.picture_header(_gif_bytes(1)) == art.Header(10, 10, False)
    assert art.picture_header(_gif_bytes(3)).animated is True
    assert art.picture_header(_webp_bytes(animated=False)) == art.Header(64, 64, False)
    assert art.picture_header(_webp_bytes(animated=True)).animated is True
    assert art.picture_header(b"not a picture at all") is None
    assert art.picture_header(PNG[:20]) is None
    assert art.picture_header(_gif_bytes(1)[:-8]) is None, "cut short: frames unknown"


def test_a_giant_or_moving_picture_is_no_cover(tmp_path):
    giant = _jpeg_bytes(30_000, 30_000)
    assert len(giant) < 1024, "a tiny file declaring 900 megapixels"
    refused = {
        "giant.flac": giant,
        "giant-png.flac": _png_bytes(20_000, 20_000),
        "zero.flac": _jpeg_bytes(0, 0),
        "gif.flac": _gif_bytes(3),
        "apng.flac": _png_bytes(animated=True),
        "webp.flac": _webp_bytes(animated=True),
    }
    for name, data in refused.items():
        assert not art.servable(data), name
        assert art.read_picture(_flac(tmp_path, (3, data), name=name)) is None, name
    still = _gif_bytes(1)
    assert art.read_picture(_flac(tmp_path, (3, still), name="still.flac")) == (still, "image/gif")
    assert art.servable(_webp_bytes(animated=False))


def test_a_refused_picture_falls_back_to_the_next_one(tmp_path):
    path = _flac(tmp_path, (3, _gif_bytes(3)), (0, JPEG), name="two.flac")
    assert art.read_picture(path) == (JPEG, "image/jpeg")


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


def test_the_route_refuses_a_moving_picture_kept_before_the_rule(client, tmp_path):
    first = client.get("/api/songs/1/art")
    assert first.status_code == 200
    [kept] = list((tmp_path / "home" / "art" / "v1" / "pictures").iterdir())
    kept.write_bytes(_gif_bytes(3))
    again = client.get("/api/songs/1/art", headers={"If-None-Match": first.headers["etag"]})
    assert again.status_code == 204, "not a 304 that keeps the old picture looping"
    assert again.content == b""


def test_the_route_is_gone_with_the_flag_off(client):
    flags.use("-library.art_embedded")
    # the flag guard answers for the route before it runs, as for every flagged local route
    answer = client.get("/api/songs/1/art")
    assert answer.status_code == 403 and answer.json()["flag"] == "library.art_embedded"
