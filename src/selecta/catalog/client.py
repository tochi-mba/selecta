"""MusicBrainz and the Cover Art Archive, asked politely (ADR-0478).

Shaped like `selecta.lyrics.lrclib`: an identified client (`User-Agent` names SelectaDJ and where
to reach us), one request at a time per process, `Retry-After` honoured on a 429 or 503, and
timeouts on every request.

MusicBrainz allows one request a second per IP. Every MusicBrainz request also takes a token from
the platform-wide bucket `musicbrainz` in the database (`usage/rate_limit.py`) once the caller
has installed it with `use_global_limit(engine)`, so all API instances and workers together stay
under `SELECTA_MUSICBRAINZ_RATE_PER_S` (default 1.0, burst `SELECTA_MUSICBRAINZ_BURST`, default
1). The Cover Art Archive states no rate limit; its requests share the process gate (one at a
time, spaced) but not the MusicBrainz bucket.

Only an ISRC, or an artist and title, leave this server; the length is compared here, not sent.

Tests hand `MusicBrainz` an `httpx.Client` over `httpx.MockTransport` that replays recorded
answers, so no test ever reaches the real services.
"""

from __future__ import annotations

import email.utils
import os
import threading
import time
from collections.abc import Callable
from typing import Any

import httpx

from selecta import __version__

API = "https://musicbrainz.org/ws/2"
COVERS = "https://coverartarchive.org"
USER_AGENT = f"selecta/{__version__} (https://github.com/tochi-mba/selecta)"
TIMEOUT = httpx.Timeout(15.0, connect=5.0)
REQUEST_SPACING_SECONDS = 1.0
MAX_ATTEMPTS = 4
MAX_RETRY_AFTER_SECONDS = 60.0
DEFAULT_RETRY_AFTER_SECONDS = 5.0
MAX_IMAGE_BYTES = 4 * 1024 * 1024
COVER_SIZE = 500
SEARCH_LIMIT = 15
IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp")
_LUCENE_PHRASE_ESCAPE = str.maketrans({"\\": "\\\\", '"': '\\"'})


class CatalogUnavailable(RuntimeError):
    """A source did not answer usefully after the retries. Retryable later."""


class Gate:
    """One request at a time in this process, spaced, and optionally behind a shared bucket.

    The lock covers the wait and the call, so every thread and account in the process shares
    both the spacing and the single request in flight (as `lrclib.LookupQueue` does).
    """

    def __init__(
        self,
        spacing_s: float = REQUEST_SPACING_SECONDS,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if spacing_s < 0:
            raise ValueError("request spacing cannot be negative")
        self.spacing_s = spacing_s
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        self._last: float | None = None
        self.limiter = None
        """A `usage.rate_limit.DbTokenBucket` for MusicBrainz, or None."""

    def run(self, request: Callable[[], httpx.Response], *, limited: bool) -> httpx.Response:
        with self._lock:
            if self._last is not None:
                wait = self.spacing_s - (self._clock() - self._last)
                if wait > 0:
                    self._sleep(wait)
            if limited and self.limiter is not None:
                self.limiter.acquire(timeout=120.0)
            self._last = self._clock()
            return request()


_gate = Gate()


def process_gate() -> Gate:
    return _gate


def use_gate(gate: Gate) -> None:
    """Replace the process gate in tests or a worker bootstrap before lookups begin."""
    global _gate
    _gate = gate


def global_limit(engine, *, rate_per_s: float | None = None, burst: float | None = None):
    """The platform-wide MusicBrainz bucket on `engine`, at the configured rate."""
    from selecta.usage.rate_limit import DbTokenBucket

    if rate_per_s is None:
        rate_per_s = float(os.environ.get("SELECTA_MUSICBRAINZ_RATE_PER_S", "1.0"))
    if burst is None:
        burst = float(os.environ.get("SELECTA_MUSICBRAINZ_BURST", "1"))
    return DbTokenBucket(engine, "musicbrainz", rate_per_s, burst)


def use_global_limit(engine) -> None:
    """Put the shared bucket behind the process gate once (a no-op when already there)."""
    if _gate.limiter is None:
        _gate.limiter = global_limit(engine)


def _retry_after(response: httpx.Response) -> float:
    raw = (response.headers.get("Retry-After") or "").strip()
    if not raw:
        return DEFAULT_RETRY_AFTER_SECONDS
    try:
        seconds = float(raw)
    except ValueError:
        try:
            when = email.utils.parsedate_to_datetime(raw)
        except (TypeError, ValueError):
            return DEFAULT_RETRY_AFTER_SECONDS
        seconds = when.timestamp() - time.time()
    return min(max(seconds, 0.0), MAX_RETRY_AFTER_SECONDS)


def phrase(text: str) -> str:
    """A Lucene phrase for a MusicBrainz search: quoted, with quotes and backslashes escaped."""
    return '"' + " ".join(text.split()).translate(_LUCENE_PHRASE_ESCAPE) + '"'


class MusicBrainz:
    """Search and lookup on MusicBrainz, and front covers from the Cover Art Archive."""

    def __init__(
        self,
        client: httpx.Client | None = None,
        *,
        gate: Gate | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._own = client is None
        self.client = client or httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=TIMEOUT,
            follow_redirects=True,
        )
        self._gate = gate
        self._sleep = sleep

    def close(self) -> None:
        if self._own:
            self.client.close()

    def __enter__(self) -> MusicBrainz:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def _get(self, url: str, params: dict[str, Any] | None, *, limited: bool) -> httpx.Response:
        gate = self._gate or _gate
        response: httpx.Response | None = None
        for _ in range(MAX_ATTEMPTS):
            try:
                response = gate.run(
                    lambda: self.client.get(
                        url, params=params, headers={"User-Agent": USER_AGENT}
                    ),
                    limited=limited,
                )
            except httpx.HTTPError as error:
                raise CatalogUnavailable(
                    f"{type(error).__name__} asking {url.split('?')[0]}"
                ) from error
            # MusicBrainz answers 503 when a client goes over its rate
            if response.status_code not in (429, 503):
                return response
            self._sleep(_retry_after(response))
        assert response is not None
        raise CatalogUnavailable(f"still {response.status_code} after {MAX_ATTEMPTS} tries")

    def _json(self, path: str, params: dict[str, Any]) -> dict[str, Any] | None:
        response = self._get(f"{API}{path}", {**params, "fmt": "json"}, limited=True)
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise CatalogUnavailable(f"MusicBrainz answered {response.status_code}")
        try:
            body = response.json()
        except ValueError as error:
            raise CatalogUnavailable("MusicBrainz answered with something other than JSON") from (
                error
            )
        return body if isinstance(body, dict) else None

    # --- MusicBrainz ---

    def recordings_by_isrc(self, isrc: str) -> list[dict[str, Any]]:
        """Every recording carrying this ISRC, with its releases and artist credit."""
        body = self._json(f"/isrc/{isrc}", {"inc": "artists+releases"})
        recordings = (body or {}).get("recordings") or []
        return [r for r in recordings if isinstance(r, dict)]

    def search_recordings(
        self, artist: str, title: str, *, limit: int = SEARCH_LIMIT
    ) -> list[dict[str, Any]]:
        """Recordings whose title and artist match, as MusicBrainz's search ranks them."""
        if not artist.strip() or not title.strip():
            return []
        query = f"recording:{phrase(title)} AND artist:{phrase(artist)}"
        body = self._json("/recording", {"query": query, "limit": max(1, min(limit, 25))})
        recordings = (body or {}).get("recordings") or []
        return [r for r in recordings if isinstance(r, dict)]

    def recording(self, recording_id: str) -> dict[str, Any] | None:
        """One recording with its releases, their release groups, the credit and the ISRCs."""
        return self._json(
            f"/recording/{recording_id}",
            {"inc": "artists+releases+release-groups+isrcs"},
        )

    # --- Cover Art Archive ---

    def front_cover(
        self, mbid: str, *, release_group: bool = False, size: int = COVER_SIZE
    ) -> tuple[bytes, str] | None:
        """The front cover at `size` px for a release (or a release group), with its content
        type, or None when the archive has none. Refuses anything that isn't a small image."""
        kind = "release-group" if release_group else "release"
        response = self._get(f"{COVERS}/{kind}/{mbid}/front-{size}", None, limited=False)
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise CatalogUnavailable(f"The Cover Art Archive answered {response.status_code}")
        content_type = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
        data = response.content
        if content_type not in IMAGE_TYPES or not data or len(data) > MAX_IMAGE_BYTES:
            return None
        return data, content_type


__all__ = [
    "API",
    "COVERS",
    "COVER_SIZE",
    "USER_AGENT",
    "CatalogUnavailable",
    "Gate",
    "MusicBrainz",
    "global_limit",
    "phrase",
    "process_gate",
    "use_gate",
    "use_global_limit",
]
