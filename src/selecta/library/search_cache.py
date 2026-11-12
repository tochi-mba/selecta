"""S4-0111-05: a search asked again over a library whose names haven't changed is answered from
memory, not by ranking all 20,000 songs again.

The same search comes back often: the page asks once as it is typed, again for a filter, again for
each refresh of what is on screen and again when the page is reloaded. Ranking costs a few hundred
milliseconds at 20,000 songs on a loaded laptop; checking the names costs one SQLite aggregate.

The check is exact, not a guess: every searchable fact (each listed song's id, artist and title) is
read into one length-prefixed string, and a cached ranking is only used while that string is
identical. Any rename, new song, removal or duplicate marking, by this process or another one (a
command-line scan, say), changes it, and the next search ranks afresh. Nothing is held open
between requests, so a library file can still be replaced or deleted.
"""

from __future__ import annotations

import sqlite3
import threading
from collections import OrderedDict

from selecta.library.relevance import rank_songs

# The rows rank_songs reads, in id order, each as "id artist-length artist title-length title", so
# no two different libraries can read the same. NULL and '' rank the same, so they read the same.
NAMES = (
    "SELECT group_concat(printf('%d %d %s%d %s', id, length(coalesce(artist,'')),"
    " coalesce(artist,''), length(coalesce(title,'')), coalesce(title,'')), char(10))"
    " FROM (SELECT id,artist,title FROM songs WHERE duplicate_of IS NULL ORDER BY id)"
)
SONGS = "SELECT id,artist,title FROM songs WHERE duplicate_of IS NULL"


class RankedSearches:
    """The rankings of the last few searches, valid for one exact set of names."""

    def __init__(self, keep: int = 16) -> None:
        self._keep = keep
        self._lock = threading.Lock()
        self._names: str | None = None
        self._songs: list[tuple[int, str | None, str | None]] | None = None
        self._ranked: OrderedDict[str, dict[int, int]] = OrderedDict()
        self.ranked_afresh = 0

    def rank(self, conn: sqlite3.Connection, query: str) -> dict[int, int]:
        """``{song id: rank}`` for each match, as rank_songs gives it. Callers only read it."""
        names = conn.execute(NAMES).fetchone()[0] or ""
        with self._lock:
            if names != self._names:
                self._names = names
                self._songs = None
                self._ranked.clear()
            found = self._ranked.get(query)
            if found is not None:
                self._ranked.move_to_end(query)
                return found
            if self._songs is None:
                cursor = conn.cursor()
                cursor.row_factory = None  # plain tuples: 20,000 named rows cost far more
                self._songs = cursor.execute(SONGS).fetchall()
            found = rank_songs(query, self._songs)
            self.ranked_afresh += 1
            self._ranked[query] = found
            while len(self._ranked) > self._keep:
                self._ranked.popitem(last=False)
            return found
