"""Shared helpers for the catalogue tests (ADR-0478). This module holds no tests.

- `answers(name)`: a hand-written MusicBrainz answer from `tests/fixtures/catalog/`.
- `tiny_jpeg()`: a valid 1x1 grey baseline JPEG, built byte by byte (no image library needed).
- `Replay`: an `httpx.MockTransport` handler that serves those answers by URL and records every
  request, so no test ever reaches MusicBrainz or the Cover Art Archive.
- `musicbrainz(replay)`: a `client.MusicBrainz` over it, with an unspaced gate and no sleeping.
"""

from __future__ import annotations

import json
import struct
from collections.abc import Callable
from pathlib import Path

import httpx

from selecta.catalog import client

FIXTURES = Path(__file__).parent / "fixtures" / "catalog"
ISRC = "GBXYZ2400001"
RECORDING = "aaaaaaaa-0000-4000-8000-000000000001"
ALBUM = "bbbbbbbb-0000-4000-8000-000000000002"
SINGLE = "bbbbbbbb-0000-4000-8000-000000000001"


def answers(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def _segment(marker: int, body: bytes) -> bytes:
    return struct.pack(">HH", marker, len(body) + 2) + body


def tiny_jpeg() -> bytes:
    """One 8x8 block of mid grey: the DC difference is 0 and every AC is zero, so the scan is two
    one-bit codes ("0" for DC category 0, "0" for end of block) padded with ones."""
    one_code = bytes([1] + [0] * 15) + b"\x00"  # a single code of length 1, for symbol 0
    return b"".join([
        b"\xff\xd8",
        _segment(0xFFE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"),
        _segment(0xFFDB, b"\x00" + b"\x01" * 64),
        _segment(0xFFC0, b"\x08\x00\x01\x00\x01\x01\x01\x11\x00"),
        _segment(0xFFC4, b"\x00" + one_code),
        _segment(0xFFC4, b"\x10" + one_code),
        _segment(0xFFDA, b"\x01\x01\x00\x00\x3f\x00"),
        b"\x3f",
        b"\xff\xd9",
    ])


Route = Callable[[httpx.Request], httpx.Response]


class Replay:
    """Serves recorded-style answers. `routes` maps a path prefix (after the host) to a JSON
    fixture name, a `Route`, or an `httpx.Response`. Anything unlisted answers 404, as
    MusicBrainz and the archive do for an unknown id."""

    def __init__(self, routes: dict[str, str | Route | httpx.Response] | None = None) -> None:
        self.routes = dict(routes or {})
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        for prefix, answer in self.routes.items():
            if path.startswith(prefix):
                if isinstance(answer, str):
                    return httpx.Response(200, json=answers(answer))
                if isinstance(answer, httpx.Response):
                    return answer
                return answer(request)
        return httpx.Response(404, json={"error": "Not Found"})

    def paths(self, host: str | None = None) -> list[str]:
        return [r.url.path for r in self.requests if host is None or r.url.host == host]


def cover(data: bytes | None = None, content_type: str = "image/jpeg") -> httpx.Response:
    return httpx.Response(200, content=tiny_jpeg() if data is None else data,
                          headers={"Content-Type": content_type})


def add_song(engine, workspace_id: str, *, title: str = "Lanterns Over the Water",
             artist: str = "Night Harbour", seconds: float | None = 241.0,
             album: str | None = "Low Tide") -> int:
    """A song in the workspace's local media catalogue (only its tags, as in Cloud)."""
    import hashlib

    from selecta.local_media.schema import local_songs
    from selecta.persistence import db_now, new_id, transaction

    with transaction(engine, workspace_id) as conn:
        now = db_now(conn)
        return int(conn.execute(local_songs.insert().values(
            workspace_id=workspace_id, content_sha256=hashlib.sha256(new_id().encode()).hexdigest(),
            title=title, artist=artist, album=album, duration_s=seconds, created_at=now,
            updated_at=now,
        )).inserted_primary_key[0])


def isrc_replay(**extra) -> Replay:
    """MusicBrainz knows the ISRC and the recording; the archive has every front cover."""
    return Replay({
        f"/ws/2/isrc/{ISRC}": "isrc_two_recordings",
        "/ws/2/recording/": "recording",
        "/release/": cover(),
        **extra,
    })


def musicbrainz(replay: Replay, *, slept: list[float] | None = None,
                gate: client.Gate | None = None) -> client.MusicBrainz:
    sleeps = slept if slept is not None else []
    return client.MusicBrainz(
        httpx.Client(transport=httpx.MockTransport(replay)),
        gate=gate or client.Gate(0.0, sleep=sleeps.append),
        sleep=sleeps.append,
    )
