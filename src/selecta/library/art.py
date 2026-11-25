"""A song's own cover, read from its file for the local app (ADR-0478 FL-0478-02).

Behind `library.art_embedded`. The picture inside a file (ID3 `APIC` in MP3, WAV and AIFF, FLAC
`PICTURE`, MP4 `covr`, an Ogg `METADATA_BLOCK_PICTURE`) is copied once into the data home and
served by the local API; the front cover wins where a file holds several. Pillow is not a
dependency, so the picture's own bytes are kept, up to a size cap, and the browser scales them.

Two folders under `<home>/art/v1/`:

- `pictures/<sha256>.<ext>`: each distinct picture once, named by the hash of its bytes, so the
  twelve songs of one album share one copy.
- `files/<key>`: what one file holds, keyed by a hash of its path, size and modified time, so a
  file that changes is read again. It says `<sha256> <mime>`, or `-` for a file with no usable
  picture, so a library of untagged files is not read again on every request.

Reading a picture can never fail a scan or a request: anything wrong is simply no cover, and the
page draws the generated tile, as before.

**What is refused (T-20261125-4054).** Since the bytes are served as stored and the browser
decodes them, the picture's size and motion are read from its header first (`picture_header`;
no decoder, so no Pillow). A picture whose header does not read, that declares more than
`MAX_PICTURE_PIXELS`, or that moves (a GIF with more than one frame, an APNG, an animated WebP) is
no cover: a looping cover would ignore Still and reduced motion, where only the music may move.
The route checks the kept bytes again before serving, so a picture kept before this rule is
refused too.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

import mutagen
from mutagen._vorbis import VCommentDict
from mutagen.flac import Picture as FlacPicture
from mutagen.id3 import ID3
from mutagen.mp4 import MP4Tags

from selecta import longpaths

log = logging.getLogger(__name__)

VERSION = "v1"
MAX_PICTURE_BYTES = 4 * 1024 * 1024
"""A bigger picture is skipped: kept unscaled, it would be a slow cover on every Library row."""
MAX_PICTURE_PIXELS = 40_000_000
"""About 40 megapixels, as in Cloud: far past any real cover, short of a decode that can end the
tab. A small file can declare a far bigger picture than its bytes suggest."""
FRONT_COVER = 3
OTHER_PICTURE = 0
NO_PICTURE = "-"
EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
CACHE_CONTROL = "private, max-age=3600"
"""An hour, then a cheap 304: a file given a new cover and read again shows it within the hour."""


@dataclass(frozen=True)
class Cover:
    sha256: str
    mime: str
    path: Path


def sniff(data: bytes) -> str | None:
    """The picture's real type from its first bytes. A tag's own mime is often wrong or empty,
    and nothing that is not a picture is ever served as one."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


@dataclass(frozen=True)
class Header:
    width: int
    height: int
    animated: bool


def _u16be(data: bytes, at: int) -> int:
    return int.from_bytes(data[at:at + 2], "big")


def _u16le(data: bytes, at: int) -> int:
    return int.from_bytes(data[at:at + 2], "little")


def _jpeg(data: bytes) -> Header | None:
    at = 2
    while at + 3 < len(data):
        if data[at] != 0xFF:
            return None
        while at < len(data) and data[at] == 0xFF:  # fill bytes may sit before a marker
            at += 1
        if at >= len(data):
            return None
        marker = data[at]
        at += 1
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:  # standalone markers carry no length
            continue
        if marker in (0xD9, 0xDA):  # the image data began with no frame header
            return None
        if at + 1 >= len(data):
            return None
        length = _u16be(data, at)
        if length < 2:
            return None
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            if at + 7 > len(data):
                return None
            # a zero height means "given later" (DNL): unknown, so refused by the caller
            return Header(_u16be(data, at + 5), _u16be(data, at + 3), False)
        at += length
    return None


def _png(data: bytes) -> Header | None:
    if len(data) < 24 or data[12:16] != b"IHDR":
        return None
    width, height = int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    # an animated PNG says so with an acTL chunk before its first image data
    animated, at = False, 8
    while at + 8 <= len(data):
        length = int.from_bytes(data[at:at + 4], "big")
        kind = data[at + 4:at + 8]
        if kind == b"acTL":
            animated = True
            break
        if kind in (b"IDAT", b"IEND"):
            break
        at += 12 + length
    return Header(width, height, animated)


def _skip_sub_blocks(data: bytes, at: int) -> int:
    """The offset after a GIF's run of data sub-blocks, or -1 when the file is cut short."""
    while at < len(data):
        size = data[at]
        at += 1
        if size == 0:
            return at
        at += size
    return -1


def _gif(data: bytes) -> Header | None:
    if len(data) < 13:
        return None
    width, height = _u16le(data, 6), _u16le(data, 8)
    at = 13
    if data[10] & 0x80:
        at += 3 * (1 << ((data[10] & 0x07) + 1))
    frames = 0
    while at < len(data):
        block = data[at]
        if block == 0x3B:  # the trailer
            break
        if block == 0x21:
            at = _skip_sub_blocks(data, at + 2)
        elif block == 0x2C:
            if at + 10 > len(data):
                return None
            # a frame may declare itself larger than the screen; the decoder sizes for the larger
            width = max(width, _u16le(data, at + 1) + _u16le(data, at + 5))
            height = max(height, _u16le(data, at + 3) + _u16le(data, at + 7))
            flags_byte = data[at + 9]
            at += 10
            if flags_byte & 0x80:
                at += 3 * (1 << ((flags_byte & 0x07) + 1))
            at = _skip_sub_blocks(data, at + 1)  # past the LZW code size, then the image data
            frames += 1
            if frames > 1:
                break
        else:
            return None
        if at < 0:  # cut short: whether more frames follow is unknown, so it is refused
            return None
    if frames == 0:
        return None
    return Header(width, height, frames > 1)


def _webp(data: bytes) -> Header | None:
    if len(data) < 30:
        return None
    # any animation chunk anywhere in the file counts, whatever the flags claim
    animated, at = False, 12
    while at + 8 <= len(data):
        kind = data[at:at + 4]
        if kind in (b"ANIM", b"ANMF"):
            animated = True
            break
        size = int.from_bytes(data[at + 4:at + 8], "little")
        at += 8 + size + (size & 1)
    first = data[12:16]
    if first == b"VP8X":
        animated = animated or bool(data[20] & 0x02)
        width = int.from_bytes(data[24:27], "little") + 1
        height = int.from_bytes(data[27:30], "little") + 1
        return Header(width, height, animated)
    if first == b"VP8 ":
        if data[23:26] != b"\x9d\x01\x2a":
            return None
        return Header(_u16le(data, 26) & 0x3FFF, _u16le(data, 28) & 0x3FFF, animated)
    if first == b"VP8L":
        if data[20] != 0x2F:
            return None
        bits = int.from_bytes(data[21:25], "little")
        return Header((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1, animated)
    return None


def picture_header(data: bytes) -> Header | None:
    """The picture's declared size and whether it moves, read from its header bytes alone, or
    None when the header is not one this reads. Never raises and never decodes."""
    try:
        mime = sniff(data)
        if mime == "image/jpeg":
            return _jpeg(data)
        if mime == "image/png":
            return _png(data)
        if mime == "image/gif":
            return _gif(data)
        if mime == "image/webp":
            return _webp(data)
    except Exception:  # noqa: BLE001 - a header that does not read is no cover
        return None
    return None


def servable(data: bytes) -> bool:
    """Whether these picture bytes may be shown as a cover: a readable header, a still picture,
    and no more than `MAX_PICTURE_PIXELS` (module notes)."""
    if not data or len(data) > MAX_PICTURE_BYTES:
        return False
    header = picture_header(data)
    if header is None or header.animated or header.width < 1 or header.height < 1:
        return False
    return header.width * header.height <= MAX_PICTURE_PIXELS


def _rank(kind: object) -> int:
    """Front cover first, then an untyped picture, then anything else (a back cover, a booklet)."""
    if kind == FRONT_COVER:
        return 0
    if kind == OTHER_PICTURE:
        return 1
    return 2


def _candidates(audio) -> list[tuple[int, bytes]]:
    found: list[tuple[int, bytes]] = []
    for picture in getattr(audio, "pictures", None) or []:  # FLAC
        found.append((_rank(getattr(picture, "type", None)), bytes(picture.data)))
    tags = getattr(audio, "tags", None)
    if isinstance(tags, ID3):
        for frame in tags.getall("APIC"):
            found.append((_rank(getattr(frame, "type", None)), bytes(frame.data)))
    elif isinstance(tags, MP4Tags):
        # MP4 covers carry no kind; a file's covr is its front cover in practice
        found.extend((0, bytes(cover)) for cover in tags.get("covr") or [])
    elif isinstance(tags, VCommentDict) and "metadata_block_picture" in tags:
        for block in tags["metadata_block_picture"]:
            try:
                picture = FlacPicture(base64.b64decode(block))
            except Exception:  # noqa: BLE001 - one damaged block is skipped, not the file
                continue
            found.append((_rank(picture.type), bytes(picture.data)))
    return found


def _read(path: Path) -> tuple[bytes, str] | None:
    """The best picture in the file, or None when it has none. Raises when the file itself could
    not be opened, so a locked or vanishing file is not remembered as having no cover."""
    audio = mutagen.File(longpaths.os_path(path))
    if audio is None:
        return None
    try:
        candidates = sorted(_candidates(audio), key=lambda found: found[0])
    except Exception:  # noqa: BLE001 - a damaged tag is no cover
        return None
    for _, data in candidates:
        if not servable(data):
            continue
        mime = sniff(data)
        if mime is not None:
            return data, mime
    return None


def read_picture(path: Path | str) -> tuple[bytes, str] | None:
    """The best picture in the file and its type, or None. Never raises."""
    try:
        return _read(Path(path))
    except Exception:  # noqa: BLE001 - an unreadable file is no cover
        return None


def _root(home: Path) -> Path:
    return home / "art" / VERSION


def file_key(path: str, size: int, mtime: float) -> str:
    # surrogatepass: a Windows path can hold names Python keeps as lone surrogates
    return hashlib.sha256(f"{path}|{size}|{mtime!r}".encode("utf-8", "surrogatepass")).hexdigest()


def _write(target: Path, data: bytes) -> None:
    """Whole or not at all, so a reader in another thread never sees half a picture."""
    partial = target.with_name(f"{target.name}.{os.getpid()}.{threading.get_ident()}.part")
    try:
        partial.write_bytes(data)
        os.replace(partial, target)
    finally:
        partial.unlink(missing_ok=True)


def _kept(root: Path, text: str) -> Cover | None:
    sha, _, mime = text.partition(" ")
    extension = EXTENSIONS.get(mime)
    if len(sha) != 64 or extension is None:
        return None
    picture = root / "pictures" / f"{sha}.{extension}"
    return Cover(sha, mime, picture) if picture.is_file() else None


def _capture(root: Path, path: str, marker: Path) -> Cover | None:
    try:
        found = _read(Path(path))
    except Exception:  # noqa: BLE001 - not remembered: it may open next time
        return None
    try:
        marker.parent.mkdir(parents=True, exist_ok=True)
        if found is None:
            _write(marker, NO_PICTURE.encode("ascii"))
            return None
        data, mime = found
        sha = hashlib.sha256(data).hexdigest()
        picture = root / "pictures" / f"{sha}.{EXTENSIONS[mime]}"
        if not picture.is_file():
            picture.parent.mkdir(parents=True, exist_ok=True)
            _write(picture, data)
        _write(marker, f"{sha} {mime}".encode("ascii"))
        return Cover(sha, mime, picture)
    except OSError as problem:
        log.warning("A cover could not be kept: %s", type(problem).__name__)
        return None


def cover_for(home: Path, path: str) -> Cover | None:
    """The cover of the file at `path`: read from the file the first time it is asked for (or
    after the file changed), then from the data home. None when the file has no usable picture,
    is not there, or anything else goes wrong."""
    try:
        stat = longpaths.stat(Path(path))
    except OSError:
        return None
    root = _root(home)
    marker = root / "files" / file_key(path, stat.st_size, stat.st_mtime)
    try:
        text = marker.read_text("ascii").strip()
    except (OSError, UnicodeDecodeError):
        text = None
    if text == NO_PICTURE:
        return None
    if text is not None:
        kept = _kept(root, text)
        if kept is not None:
            return kept
        # the picture was cleared from the data home by hand: read the file again
    return _capture(root, path, marker)


def warm(home: Path, paths: Iterable[str], should_stop: Callable[[], bool] = lambda: False) -> int:
    """Read the covers of the files a scan has just read, so the Library has them at once rather
    than on first view. It runs after the scan has finished, stops when asked, and a file it
    cannot read is skipped. Returns how many files had a cover."""
    found = 0
    for path in paths:
        if should_stop():
            break
        try:
            if cover_for(home, path) is not None:
                found += 1
        except Exception:  # noqa: BLE001 - one bad picture never stops the rest
            continue
    return found


__all__ = [
    "CACHE_CONTROL",
    "MAX_PICTURE_BYTES",
    "MAX_PICTURE_PIXELS",
    "Cover",
    "Header",
    "cover_for",
    "file_key",
    "picture_header",
    "read_picture",
    "servable",
    "sniff",
    "warm",
]
