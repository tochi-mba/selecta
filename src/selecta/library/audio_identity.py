"""The audio id: a song's identity from its encoded audio only (docs/engineering/audio-identity.md).

A tag edit, new artwork or a rating another player writes changes a file's bytes but not its
audio, so it must not make a new song. `audio_id` hashes only the audio payload ranges each
container defines, never decoded samples, and answers None for anything it can't place exactly:
the whole-file hash then identifies the song, as before.

The browser has the same rules in `web/src/media/audioIdentity.ts`; both are checked against the
fixtures in `tests/fixtures/audio_identity/`. Standard library only. Headers are read with small
seeks; the payload is streamed, never held whole.
"""

from __future__ import annotations

import hashlib
import os
import re
from collections.abc import Callable
from pathlib import Path
from typing import BinaryIO

PREFIX = "a1:"
PATTERN = re.compile(r"^a1:[0-9a-f]{64}$")
CHUNK = 1024 * 1024

Ranges = list[tuple[int, int]]


class _Reader:
    """Small reads at any offset of a seekable file of known size."""

    def __init__(self, stream: BinaryIO, size: int) -> None:
        self.stream = stream
        self.size = size

    def read(self, offset: int, count: int) -> bytes:
        if offset < 0 or count <= 0 or offset >= self.size:
            return b""
        self.stream.seek(offset)
        return self.stream.read(min(count, self.size - offset))


def _le(data: bytes, at: int, width: int = 4) -> int:
    return int.from_bytes(data[at : at + width], "little")


def _be(data: bytes, at: int, width: int = 4) -> int:
    return int.from_bytes(data[at : at + width], "big")


def _syncsafe(data: bytes) -> int | None:
    if len(data) < 4 or any(byte >= 0x80 for byte in data[:4]):
        return None
    return (data[0] << 21) | (data[1] << 14) | (data[2] << 7) | data[3]


def _add(ranges: Ranges, start: int, end: int) -> None:
    # neighbours are joined, so a page or box boundary costs nothing
    if end <= start:
        return
    if ranges and ranges[-1][1] == start:
        ranges[-1] = (ranges[-1][0], end)
    else:
        ranges.append((start, end))


def _id3v2_tags(reader: _Reader) -> tuple[int, int] | None:
    """Where the leading ID3v2 tags end and how many there were; None if one runs past the end."""
    at, count = 0, 0
    while True:
        head = reader.read(at, 10)
        if len(head) < 10 or head[:3] != b"ID3" or head[3] not in (2, 3, 4) or head[4] == 0xFF:
            return at, count
        size = _syncsafe(head[6:10])
        if size is None:
            return at, count
        length = 10 + size + (10 if head[3] == 4 and head[5] & 0x10 else 0)
        if at + length > reader.size:
            return None
        at += length
        count += 1


def _frame_header(data: bytes) -> bool:
    return (
        len(data) >= 4
        and data[0] == 0xFF
        and data[1] & 0xE0 == 0xE0
        and (data[1] >> 3) & 3 != 1
        and (data[1] >> 1) & 3 != 0
        and data[2] >> 4 != 15
        and (data[2] >> 2) & 3 != 3
    )


def _mp3_end(reader: _Reader, start: int) -> int | None:
    end = reader.size
    if end - 128 >= start and reader.read(end - 128, 3) == b"TAG":
        end -= 128
        if end - 227 >= start and reader.read(end - 227, 4) == b"TAG+":
            end -= 227
    while True:
        if end - 32 >= start and reader.read(end - 32, 8) == b"APETAGEX":
            footer = reader.read(end - 32, 32)
            size, flags = _le(footer, 12), _le(footer, 20)
            if _le(footer, 8) not in (1000, 2000) or size < 32:
                return None
            total = size + (32 if flags & 0x80000000 else 0)
            if end - total < start:
                return None
            end -= total
            continue
        if end - 15 >= start and reader.read(end - 9, 9) == b"LYRICS200":
            digits = reader.read(end - 15, 6)
            if not (len(digits) == 6 and all(0x30 <= byte <= 0x39 for byte in digits)):
                return None
            total = int(digits) + 15
            if end - total < start or reader.read(end - total, 11) != b"LYRICSBEGIN":
                return None
            end -= total
            continue
        if end - 10 >= start:
            tail = reader.read(end - 10, 10)
            size = _syncsafe(tail[6:10])
            if tail[:3] == b"3DI" and tail[3] == 4 and size is not None:
                if end - (size + 20) < start:
                    return None
                end -= size + 20
                continue
        if end - 9 >= start and reader.read(end - 9, 9) == b"LYRICSEND":
            return None
        return end


def _first_frame(reader: _Reader, start: int, end: int, anywhere: bool) -> int | None:
    if not anywhere:
        return start if start + 4 <= end and _frame_header(reader.read(start, 4)) else None
    at = start
    while at + 4 <= end:
        window = reader.read(at, min(CHUNK, end - at))
        for index in range(max(0, len(window) - 3)):
            if window[index] == 0xFF and _frame_header(window[index : index + 4]):
                return at + index
        if len(window) < 4:
            return None
        at += len(window) - 3
    return None


def _mp3(reader: _Reader, start: int, tags: int) -> Ranges | None:
    end = _mp3_end(reader, start)
    if end is None:
        return None
    frame = _first_frame(reader, start, end, anywhere=tags > 0)
    if frame is None:
        return None
    return [(frame, end)]


def _flac(reader: _Reader, start: int) -> Ranges | None:
    at = start + 4
    first = True
    while True:
        head = reader.read(at, 4)
        if len(head) < 4:
            return None
        kind, length = head[0] & 0x7F, _be(head, 1, 3)
        if kind == 127 or (first and (kind != 0 or length != 34)):
            return None
        first = False
        at += 4 + length
        if at > reader.size:
            return None
        if head[0] & 0x80:
            break
    sync = reader.read(at, 2)
    if len(sync) < 2 or sync[0] != 0xFF or sync[1] not in (0xF8, 0xF9):
        return None
    end = reader.size
    if end - 128 >= at and reader.read(end - 128, 3) == b"TAG":
        end -= 128
    return [(at, end)]


def _mp4(reader: _Reader) -> Ranges | None:
    ranges: Ranges = []
    at, first, found = 0, True, False
    while at < reader.size:
        head = reader.read(at, 8)
        if len(head) < 8:
            return None
        size, kind, header = _be(head, 0), head[4:8], 8
        if size == 1:
            large = reader.read(at + 8, 8)
            if len(large) < 8:
                return None
            size, header = _be(large, 0, 8), 16
        elif size == 0:
            size = reader.size - at
        if size < header or at + size > reader.size:
            return None
        if first and kind != b"ftyp":
            return None
        first = False
        if kind == b"mdat":
            found = True
            _add(ranges, at + header, at + size)
        at += size
    return ranges if found else None


def _chunks(reader: _Reader, big_endian: bool, rf64: bool, wanted: bytes) -> Ranges | None:
    """The one `wanted` chunk of a RIFF, RF64 or AIFF file, as (data start, data end)."""
    number = _be if big_endian else _le
    head = reader.read(0, 12)
    area_end = 8 + number(head, 4)
    data_size = None
    if rf64:
        if number(head, 4) != 0xFFFFFFFF:
            return None
        ds64 = reader.read(12, 36)
        if len(ds64) < 36 or ds64[:4] != b"ds64" or _le(ds64, 4) < 28:
            return None
        area_end = 8 + _le(ds64, 8, 8)
        data_size = _le(ds64, 16, 8)
    if area_end > reader.size:
        return None
    found: Ranges = []
    at = 12
    while at + 8 <= area_end:
        chunk = reader.read(at, 8)
        kind, size = chunk[:4], number(chunk, 4)
        if rf64 and size == 0xFFFFFFFF:
            if kind != b"data" or data_size is None:
                return None
            size = data_size
        if at + 8 + size > area_end:
            return None
        if kind == wanted:
            found.append((at + 8, at + 8 + size))
        at += 8 + size + (size & 1)
    return found if len(found) == 1 else None


def _wav(reader: _Reader, rf64: bool) -> Ranges | None:
    return _chunks(reader, False, rf64, b"data")


def _aiff(reader: _Reader) -> Ranges | None:
    found = _chunks(reader, True, False, b"SSND")
    if found is None:
        return None
    start, end = found[0]
    if end - start < 8:
        return None
    offset = _be(reader.read(start, 4), 0)
    if offset > end - start - 8:
        return None
    return [(start + 8 + offset, end)]


def _prefix(reader: _Reader, ranges: Ranges, count: int) -> bytes:
    out = b""
    for start, end in ranges:
        if len(out) >= count:
            break
        out += reader.read(start, min(end - start, count - len(out)))
    return out


def _ogg(reader: _Reader) -> Ranges | None:
    ranges: Ranges = []
    heads: tuple[Ranges, Ranges] = ([], [])
    at, serial, ended, pending, packet = 0, None, False, False, 0
    while at < reader.size:
        head = reader.read(at, 27)
        if len(head) < 27 or head[:4] != b"OggS" or head[4] != 0:
            return None
        flags, page_serial, count = head[5], _le(head, 14), head[26]
        lacing = reader.read(at + 27, count)
        if len(lacing) < count:
            return None
        body = at + 27 + count
        after = body + sum(lacing)
        if after > reader.size:
            return None
        if serial is None:
            if not flags & 0x02:
                return None
            serial = page_serial
        if page_serial != serial:
            at = after
            continue
        if ended or bool(flags & 0x01) != pending:
            return None
        cursor = body
        for value in lacing:
            if packet != 1:
                _add(ranges, cursor, cursor + value)
            if packet < 2:
                _add(heads[packet], cursor, cursor + value)
            cursor += value
            pending = value == 255
            if not pending:
                packet += 1
        if flags & 0x04:
            ended = True
        at = after
    if serial is None or pending:
        return None
    first, second = _prefix(reader, heads[0], 8), _prefix(reader, heads[1], 8)
    if first[:7] == b"\x01vorbis" and second[:7] == b"\x03vorbis":
        return ranges
    if first == b"OpusHead" and second == b"OpusTags":
        return ranges
    return None


def payload_ranges(stream: BinaryIO, size: int) -> Ranges | None:
    """The byte ranges the audio id hashes, in file order, or None when the file has no audio id."""
    reader = _Reader(stream, size)
    head = reader.read(0, 12)
    if head[:4] in (b"RIFF", b"RF64") and head[8:12] == b"WAVE":
        ranges = _wav(reader, head[:4] == b"RF64")
    elif head[:4] == b"FORM" and head[8:12] in (b"AIFF", b"AIFC"):
        ranges = _aiff(reader)
    elif head[4:8] == b"ftyp":
        ranges = _mp4(reader)
    elif head[:4] == b"OggS":
        ranges = _ogg(reader)
    else:
        tags = _id3v2_tags(reader)
        if tags is None:
            return None
        start, count = tags
        if reader.read(start, 4) == b"fLaC":
            ranges = _flac(reader, start)
        else:
            ranges = _mp3(reader, start, count)
    if not ranges or sum(end - start for start, end in ranges) == 0:
        return None
    return ranges


def _id(hex_digest: str) -> str:
    return PREFIX + hex_digest


def audio_id_of(stream: BinaryIO, size: int | None = None) -> str | None:
    """The audio id of an open, seekable binary file, or None."""
    if size is None:
        stream.seek(0, os.SEEK_END)
        size = stream.tell()
    ranges = payload_ranges(stream, size)
    if ranges is None:
        return None
    digest = hashlib.sha256()
    for start, end in ranges:
        stream.seek(start)
        left = end - start
        while left > 0:
            block = stream.read(min(CHUNK, left))
            if not block:
                return None  # the file shrank while it was read
            digest.update(block)
            left -= len(block)
    return _id(digest.hexdigest())


def audio_id(path: Path | str) -> str | None:
    """The audio id of the file at `path`, or None (unknown format, malformed, or unreadable)."""
    try:
        with open(path, "rb") as stream:
            return audio_id_of(stream)
    except OSError:
        return None


def both_hashes(
    stream: BinaryIO, size: int, on_block: Callable[[bytes], None] | None = None
) -> tuple[str, str | None, int]:
    """The whole file's SHA-256 and its audio id from ONE sequential read (after a few small
    header peeks): (file hex digest, audio id or None, bytes read)."""
    ranges = payload_ranges(stream, size) or []
    whole, audio = hashlib.sha256(), hashlib.sha256()
    stream.seek(0)
    position, index = 0, 0
    while True:
        block = stream.read(CHUNK)
        if not block:
            break
        whole.update(block)
        if on_block is not None:
            on_block(block)
        end = position + len(block)
        while index < len(ranges) and ranges[index][0] < end:
            start, stop = ranges[index]
            low, high = max(start, position), min(stop, end)
            if high > low:
                audio.update(block[low - position : high - position])
            if stop <= end:
                index += 1
            else:
                break
        position = end
    complete = bool(ranges) and position == size and index == len(ranges)
    return whole.hexdigest(), (_id(audio.hexdigest()) if complete else None), position


__all__ = ["PATTERN", "PREFIX", "audio_id", "audio_id_of", "both_hashes", "payload_ranges"]
