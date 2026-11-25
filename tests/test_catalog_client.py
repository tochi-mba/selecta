"""The MusicBrainz and Cover Art Archive client asks politely (ADR-0478).

Every answer is replayed through `httpx.MockTransport` (`catalog_kit.Replay`); nothing here
reaches the real services.
"""

from __future__ import annotations

import email.utils
import threading
import time

import httpx
import pytest
from catalog_kit import ALBUM, ISRC, RECORDING, Replay, cover, musicbrainz, tiny_jpeg

from selecta.catalog import client


class Clock:
    def __init__(self) -> None:
        self.now = 100.0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


class Bucket:
    """Stands in for the platform-wide `DbTokenBucket`."""

    def __init__(self) -> None:
        self.taken = 0

    def acquire(self, timeout: float | None = None) -> None:
        assert timeout is not None, "a token wait must be bounded"
        self.taken += 1


def test_every_request_names_selectadj_and_where_to_reach_us():
    replay = Replay({f"/ws/2/isrc/{ISRC}": "isrc_two_recordings"})
    with musicbrainz(replay) as mb:
        found = mb.recordings_by_isrc(ISRC)

    assert [r["id"] for r in found][0] == RECORDING
    sent = replay.requests[0]
    assert sent.headers["User-Agent"] == client.USER_AGENT
    assert client.USER_AGENT.startswith("selecta/") and "(https://" in client.USER_AGENT
    assert sent.url.params["fmt"] == "json" and sent.url.params["inc"] == "artists+releases"


def test_a_search_sends_only_the_quoted_title_and_artist():
    replay = Replay({"/ws/2/recording": "search_remasters"})
    with musicbrainz(replay) as mb:
        mb.search_recordings('Night "Harbour"', "Lanterns Over the Water")
        assert mb.search_recordings("", "No artist") == []

    params = replay.requests[0].url.params
    assert params["query"] == (
        'recording:"Lanterns Over the Water" AND artist:"Night \\"Harbour\\""'
    )
    assert set(params) == {"query", "limit", "fmt"}, "the length is compared here, not sent"
    assert len(replay.requests) == 1


def test_the_gate_spaces_requests_and_takes_a_token_only_for_musicbrainz():
    clock = Clock()
    gate = client.Gate(1.0, clock=clock, sleep=clock.sleep)
    gate.limiter = bucket = Bucket()
    replay = Replay({"/ws/2/recording/": "recording", "/release/": cover()})
    with musicbrainz(replay, gate=gate) as mb:
        assert mb.recording(RECORDING)["id"] == RECORDING
        assert mb.front_cover(ALBUM) == (tiny_jpeg(), "image/jpeg")
        assert mb.recording(RECORDING) is not None

    assert bucket.taken == 2, "the Cover Art Archive does not spend MusicBrainz tokens"
    assert clock.slept == [1.0, 1.0]


def test_only_one_request_is_in_flight_at_a_time_across_threads():
    lock = threading.Lock()
    flying, most = [0], [0]

    def slow(request: httpx.Request) -> httpx.Response:
        with lock:
            flying[0] += 1
            most[0] = max(most[0], flying[0])
        time.sleep(0.02)
        with lock:
            flying[0] -= 1
        return httpx.Response(200, json={"recordings": []})

    gate = client.Gate(0.0)
    with musicbrainz(Replay({"/ws/2/": slow}), gate=gate) as mb:
        threads = [threading.Thread(target=mb.recordings_by_isrc, args=(ISRC,)) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

    assert most[0] == 1


def busy_then_ok(status: int, retry_after: str | None, times: int = 1):
    calls = [0]

    def answer(_request: httpx.Request) -> httpx.Response:
        calls[0] += 1
        if calls[0] <= times:
            headers = {"Retry-After": retry_after} if retry_after is not None else {}
            return httpx.Response(status, headers=headers)
        return httpx.Response(200, json={"recordings": []})

    return answer


@pytest.mark.parametrize("status", [429, 503])
def test_a_busy_answer_waits_as_long_as_retry_after_says(status):
    slept: list[float] = []
    with musicbrainz(Replay({"/ws/2/": busy_then_ok(status, "7")}), slept=slept) as mb:
        assert mb.recordings_by_isrc(ISRC) == []

    assert slept == [7.0]


def test_retry_after_as_an_http_date_is_honoured():
    when = email.utils.formatdate(time.time() + 30, usegmt=True)
    slept: list[float] = []
    with musicbrainz(Replay({"/ws/2/": busy_then_ok(503, when)}), slept=slept) as mb:
        mb.recordings_by_isrc(ISRC)

    assert len(slept) == 1 and 25.0 <= slept[0] <= 30.0


@pytest.mark.parametrize(
    ("header", "expected"),
    [("3600", client.MAX_RETRY_AFTER_SECONDS), ("-5", 0.0), (None, 5.0), ("soon", 5.0)],
)
def test_retry_after_is_capped_and_defaults_when_missing_or_odd(header, expected):
    slept: list[float] = []
    with musicbrainz(Replay({"/ws/2/": busy_then_ok(429, header)}), slept=slept) as mb:
        mb.recordings_by_isrc(ISRC)

    assert slept == [expected]


def test_still_busy_after_every_try_is_unavailable():
    slept: list[float] = []
    replay = Replay({"/ws/2/": busy_then_ok(503, "1", times=99)})
    with musicbrainz(replay, slept=slept) as mb, pytest.raises(client.CatalogUnavailable):
        mb.recordings_by_isrc(ISRC)

    assert len(replay.requests) == client.MAX_ATTEMPTS


def test_a_transport_error_becomes_unavailable():
    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    with musicbrainz(Replay({"/": broken})) as mb:
        with pytest.raises(client.CatalogUnavailable, match="ConnectTimeout"):
            mb.recordings_by_isrc(ISRC)
        with pytest.raises(client.CatalogUnavailable):
            mb.front_cover(ALBUM)


def test_a_server_error_or_non_json_is_unavailable_and_404_is_nothing():
    with musicbrainz(Replay({"/ws/2/isrc/": httpx.Response(500)})) as mb:
        with pytest.raises(client.CatalogUnavailable):
            mb.recordings_by_isrc(ISRC)
    with musicbrainz(Replay({"/ws/2/isrc/": httpx.Response(200, text="<html>")})) as mb:
        with pytest.raises(client.CatalogUnavailable):
            mb.recordings_by_isrc(ISRC)
    with musicbrainz(Replay()) as mb:
        assert mb.recordings_by_isrc(ISRC) == []
        assert mb.recording(RECORDING) is None
        assert mb.front_cover(ALBUM) is None


def test_a_release_group_cover_uses_its_own_path():
    replay = Replay({"/release-group/": cover()})
    with musicbrainz(replay) as mb:
        assert mb.front_cover("cccccccc-0000-4000-8000-000000000002", release_group=True)

    assert replay.paths() == ["/release-group/cccccccc-0000-4000-8000-000000000002/front-500"]
    assert replay.requests[0].url.host == "coverartarchive.org"


@pytest.mark.parametrize(
    "answer",
    [
        cover(b"<html>not a picture</html>", "text/html"),
        cover(b"GIF89a", "image/gif"),
        cover(b"\xff" * (client.MAX_IMAGE_BYTES + 1)),
        cover(b""),
    ],
)
def test_a_cover_of_the_wrong_type_or_too_big_is_refused(answer):
    with musicbrainz(Replay({"/release/": answer})) as mb:
        assert mb.front_cover(ALBUM) is None


def test_a_cover_content_type_with_parameters_is_accepted():
    with musicbrainz(Replay({"/release/": cover(content_type="image/JPEG; charset=binary")})) as mb:
        assert mb.front_cover(ALBUM) == (tiny_jpeg(), "image/jpeg")


def test_a_negative_spacing_is_refused():
    with pytest.raises(ValueError):
        client.Gate(-1.0)
