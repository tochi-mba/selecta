"""Line-synced lyrics from LRCLIB.

Line timing is good enough to know where vocals are and to find wordplay candidates, without any
stem splitting. It isn't good enough to cut on a word: that gets verified by alignment later.

Only artist, title, album and duration leave this machine. LRCLIB asks for one request at a time
from identified clients, so this stays sequential and honours Retry-After.
"""

from __future__ import annotations

import re
import sqlite3
import time
from collections.abc import Callable
from dataclasses import dataclass

import httpx

from selecta import __version__, db, flags
from selecta.library.scan import _ARTIST_SPLIT, _FEAT_TAIL, _TITLE_NOISE

API = "https://lrclib.net/api"
USER_AGENT = f"selecta/{__version__} (https://github.com/tochi-mba/selecta)"
REQUEST_SPACING_SECONDS = 0.7
DURATION_TOLERANCE_SECONDS = 4.0

_LRC_LINE = re.compile(r"^\[(\d+):(\d+(?:\.\d+)?)\](.*)$")
_WORD = re.compile(r"[^\W_]+(?:['’][^\W_]+)?", re.UNICODE)

SECONDS_PER_WORD = 0.42
MIN_LINE_SECONDS = 1.2
MAX_LINE_SECONDS = 8.0


@dataclass(frozen=True)
class Line:
    start: float
    end: float
    text: str

    @property
    def words(self) -> list[str]:
        return _WORD.findall(self.text.lower())


def parse_lrc(text: str, song_duration: float | None = None) -> list[Line]:
    """Parse LRC into lines. End times are estimates, since LRC only times line starts."""
    stamps: list[tuple[float, str]] = []
    for raw in text.splitlines():
        match = _LRC_LINE.match(raw.strip())
        if match:
            minutes, seconds, words = match.groups()
            stamps.append((int(minutes) * 60 + float(seconds), words.strip()))
    stamps.sort(key=lambda s: s[0])

    lines: list[Line] = []
    for i, (start, words) in enumerate(stamps):
        if not words:
            continue
        following = stamps[i + 1][0] if i + 1 < len(stamps) else (song_duration or start + 4.0)
        estimate = max(MIN_LINE_SECONDS, len(_WORD.findall(words)) * SECONDS_PER_WORD)
        end = min(following, start + min(estimate, MAX_LINE_SECONDS))
        lines.append(Line(start, max(end, start + 0.2), words))
    return lines


def clean_title(title: str | None) -> str:
    return _FEAT_TAIL.sub("", _TITLE_NOISE.sub(" ", title or "")).strip(" -")


def clean_artist(artist: str | None) -> str:
    return _ARTIST_SPLIT.split(artist or "")[0].strip()


class LrcLib:
    def __init__(self, client: httpx.Client | None = None):
        self.client = client or httpx.Client(
            headers={"User-Agent": USER_AGENT}, timeout=20.0, follow_redirects=True
        )
        self._last_request = 0.0

    def _get(self, path: str, params: dict) -> httpx.Response:
        wait = REQUEST_SPACING_SECONDS - (time.monotonic() - self._last_request)
        if wait > 0:
            time.sleep(wait)
        for _ in range(5):
            self._last_request = time.monotonic()
            response = self.client.get(f"{API}{path}", params=params)
            if response.status_code != 429:
                return response
            time.sleep(float(response.headers.get("Retry-After", "10")))
        return response

    def lookup(self, artist: str, title: str, album: str | None, duration: float) -> dict | None:
        exact = {"artist_name": artist, "track_name": title, "duration": int(round(duration))}
        if album:
            exact["album_name"] = album
        response = self._get("/get", exact)
        if response.status_code == 200 and response.json().get("syncedLyrics"):
            return response.json()

        response = self._get("/search", {"artist_name": artist, "track_name": title})
        results = response.json() if response.status_code == 200 else []
        close = [
            r
            for r in results
            if r.get("duration") and abs(r["duration"] - duration) <= DURATION_TOLERANCE_SECONDS
        ]
        close.sort(key=lambda r: (not r.get("syncedLyrics"), abs(r["duration"] - duration)))
        return close[0] if close else None


def fetch_all(
    conn: sqlite3.Connection,
    limit: int = 0,
    on_progress: Callable[[int, int, str, str], None] | None = None,
) -> dict[str, int]:
    if not flags.on("lyrics.lookup"):
        return {}  # turned off in this build: nothing is sent to LRCLIB
    rows = conn.execute(
        "SELECT s.id, s.artist, s.title, s.album, s.duration FROM songs s "
        "LEFT JOIN lyrics l ON l.song_id = s.id "
        "LEFT JOIN analysis a ON a.song_id = s.id "
        "WHERE s.is_music = 1 AND s.duplicate_of IS NULL AND l.song_id IS NULL "
        "ORDER BY (a.song_id IS NOT NULL) DESC, s.id"
    ).fetchall()
    if limit:
        rows = rows[:limit]
    api = LrcLib()
    counts: dict[str, int] = {}
    for number, row in enumerate(rows, 1):
        artist, title = clean_artist(row["artist"]), clean_title(row["title"])
        try:
            found = api.lookup(artist, title, row["album"], row["duration"])
        except httpx.HTTPError:
            counts["network error"] = counts.get("network error", 0) + 1
            continue
        if found is None:
            status, synced, plain = "missing", None, None
        elif found.get("instrumental"):
            status, synced, plain = "instrumental", None, None
        elif found.get("syncedLyrics"):
            status, synced, plain = "synced", found["syncedLyrics"], found.get("plainLyrics")
        elif found.get("plainLyrics"):
            status, synced, plain = "plain", None, found["plainLyrics"]
        else:
            status, synced, plain = "missing", None, None
        db.save_lyrics(conn, row["id"], status, synced, plain)
        counts[status] = counts.get(status, 0) + 1
        if on_progress:
            on_progress(number, len(rows), status, f"{artist} - {title}")
    return counts
