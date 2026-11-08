"""Lucy's read view of the library: eligible songs, names resolved honestly, rules as filters.

Everything comes from Selecta's own source of truth (`library_now`: analysed, non-duplicate
music the person hasn't ruled out). A name that matches several recordings is ambiguous and
says so with artist and version; a name that matches nothing is missing and says so. Unknown
values stay unknown: a song with no year is never treated as from the year 0 (LU-314-05/06).
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from typing import Any

from selecta.lucy.intent import Constraint
from selecta.lyrics.lrclib import clean_artist

LISTENING_WINDOW_DAYS = 180


@dataclass
class Library:
    songs: list[Any]
    traits: dict[int, Any]
    by_id: dict[int, Any]
    phrases: dict[tuple[int, int], str]
    memory: Any
    plays: dict[int, dict[str, int]] = field(default_factory=dict)
    history_enabled: bool = False
    years: dict[int, int | None] = field(default_factory=dict)

    def label(self, song_id: int) -> dict:
        song = self.by_id.get(song_id)
        if song is None:
            return {"id": song_id, "title": "Unavailable song", "artist": ""}
        return {"id": song_id, "title": song.title or "Untitled", "artist": song.artist or ""}


def load(conn: sqlite3.Connection, app: Any) -> Library:
    from selecta.lucy import memory as taste

    songs, traits = app.library_now(conn)
    store = app.store
    remembered = store.remembered().read_taste(songs)
    years: dict[int, int | None] = {}
    for row in conn.execute("SELECT id, year FROM songs"):
        text = str(row["year"] or "")[:4]
        years[row["id"]] = int(text) if text.isdigit() else None
    enabled = taste.history_enabled(conn)
    plays = taste.play_counts(conn, LISTENING_WINDOW_DAYS) if enabled else {}
    return Library(
        songs=list(songs),
        traits=traits,
        by_id={song.id: song for song in songs},
        phrases=app.phrases_of(conn),
        memory=remembered,
        plays=plays,
        history_enabled=enabled,
        years=years,
    )


def _norm(text: str | None) -> str:
    return " ".join((text or "").casefold().split())


def resolve(lib: Library, name: str, pool: list[Any] | None = None) -> dict:
    """What a name refers to among the songs: one song, an artist, several options, or nothing."""
    wanted = _norm(name).strip("\"'“”")
    songs = pool if pool is not None else lib.songs
    if not wanted:
        return {"status": "missing", "name": name, "ids": [], "options": []}
    titles = [song for song in songs if _norm(song.title) == wanted]
    if len(titles) == 1:
        return {"status": "song", "name": name, "ids": [titles[0].id], "options": []}
    if titles:
        return _ambiguous(lib, name, titles)
    by_artist = [song for song in songs if _norm(clean_artist(song.artist)) == wanted]
    if not by_artist:
        by_artist = [
            song
            for song in songs
            if f" {wanted} " in f" {_norm(song.artist).replace(',', ' ').replace('&', ' ')} "
        ]
    if by_artist:
        return {
            "status": "artist",
            "name": name,
            "ids": [song.id for song in by_artist],
            "options": [],
        }
    combined = [
        song
        for song in songs
        if wanted in f"{_norm(song.artist)} - {_norm(song.title)}" or
        _norm(song.title).startswith(wanted)
    ]
    if len(combined) == 1:
        return {"status": "song", "name": name, "ids": [combined[0].id], "options": []}
    if 1 < len(combined) <= 8:
        return _ambiguous(lib, name, combined)
    if combined:
        return {
            "status": "missing",
            "name": name,
            "ids": [],
            "options": [],
            "reason": f"“{name}” matches {len(combined)} songs; say the artist or full title.",
        }
    return {"status": "missing", "name": name, "ids": [], "options": []}


def _ambiguous(lib: Library, name: str, songs: list[Any]) -> dict:
    return {
        "status": "ambiguous",
        "name": name,
        "ids": [song.id for song in songs],
        "options": [
            {
                "id": song.id,
                "title": song.title,
                "artist": song.artist,
                "minutes": round(song.duration / 60, 1),
            }
            for song in songs[:8]
        ],
    }


@dataclass
class Pool:
    songs: list[Any]
    excluded: dict[str, int]
    problems: list[str]
    clarify: list[dict]
    anchors: dict[str, list[int]]
    required: list[int]
    belongs: dict[int, float]


def build_pool(lib: Library, rules: list[Constraint]) -> Pool:
    """Hard rules filter; soft rules only weigh. Every exclusion is counted, never hidden."""
    live = [rule for rule in rules if rule.status == "active"]
    keep = list(lib.songs)
    excluded: dict[str, int] = {}
    problems: list[str] = []
    clarify: list[dict] = []
    anchors: dict[str, list[int]] = {}
    required: list[int] = []

    def drop(reason: str, test) -> None:
        nonlocal keep
        before = len(keep)
        keep = [song for song in keep if not test(song)]
        if before - len(keep):
            excluded[reason] = excluded.get(reason, 0) + before - len(keep)

    for rule in live:
        if rule.kind in {"exclude_artist", "exclude_song"}:
            found = resolve(lib, str(rule.value))
            if found["status"] == "missing":
                continue  # nothing to leave out; not an error
            ids = set(found["ids"])
            drop(f"Ruled out: {rule.value}", lambda song, ids=ids: song.id in ids)
        elif rule.kind == "family_only":
            drop(
                f"Not {rule.value}",
                lambda song, family=rule.value: getattr(song, "family", None) != family,
            )
        elif rule.kind == "tempo_range":
            low, high = rule.value
            drop(
                f"Outside {round(low)}–{round(high)} BPM",
                lambda song, low=low, high=high: not (low <= float(song.bpm) <= high),
            )
    for rule in live:
        if rule.kind not in {"start_with", "end_with", "include_song"}:
            continue
        found = resolve(lib, str(rule.value), keep)
        if found["status"] == "missing":
            elsewhere = resolve(lib, str(rule.value))
            if elsewhere["status"] != "missing":
                problems.append(
                    f"“{rule.value}” is in your library, but another rule rules it out."
                )
            else:
                problems.append(
                    found.get("reason")
                    or f"I couldn't find “{rule.value}” among your mix-ready songs."
                )
        elif found["status"] == "ambiguous":
            clarify.append({"rule": rule.id, "name": rule.value, "options": found["options"]})
        else:
            anchors[rule.kind] = found["ids"]
            if rule.kind == "include_song":
                required.append(found["ids"][0])
    belongs = soft_scores(lib, keep, live)
    return Pool(keep, excluded, problems, clarify, anchors, required, belongs)


def soft_scores(lib: Library, songs: list[Any], rules: list[Constraint]) -> dict[int, float]:
    """How well each song suits the soft preferences, 0..1. With none, everything suits."""
    scores: dict[int, float] = {}
    families = [rule.value for rule in rules if rule.kind == "family"]
    artists = [_norm(str(rule.value)) for rule in rules if rule.kind == "include_artist"]
    near = next((rule.value for rule in rules if rule.kind == "tempo_near"), None)
    era = next((rule.value for rule in rules if rule.kind == "era"), None)
    familiarity = next((rule.value for rule in rules if rule.kind == "familiarity"), None)
    most = max((counts.get("completes", 0) for counts in lib.plays.values()), default=0)
    for song in songs:
        parts: list[float] = []
        if families:
            parts.append(1.0 if getattr(song, "family", None) in families else 0.0)
        if artists:
            parts.append(1.0 if any(name in _norm(song.artist) for name in artists) else 0.2)
        if near is not None:
            gaps = [abs(float(song.bpm) * factor - near) / near for factor in (0.5, 1.0, 2.0)]
            parts.append(max(0.0, 1.0 - min(gaps) * 6))
        if era is not None:
            year = lib.years.get(song.id)
            if isinstance(era, list):
                parts.append(0.5 if year is None else 1.0 if era[0] <= year <= era[1] else 0.0)
            elif era == "throwbacks":
                parts.append(0.5 if year is None else 1.0 if year <= 2012 else 0.1)
            else:
                parts.append(0.5 if year is None else 1.0 if year >= 2021 else 0.2)
        if familiarity is not None and lib.history_enabled and most:
            heard = lib.plays.get(song.id, {}).get("completes", 0) / most
            parts.append(heard if familiarity == "favourites" else 1.0 - heard)
        scores[song.id] = sum(parts) / len(parts) if parts else 0.5
    return scores
