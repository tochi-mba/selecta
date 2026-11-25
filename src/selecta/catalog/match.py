"""Matching one song to a MusicBrainz recording, and choosing the release whose cover it shows.

Pure: no network, no database. The rule (ADR-0478 "Matching"):

1. **ISRC first.** When the file's tags carry a valid ISRC, the recordings MusicBrainz lists for
   it are the candidates. One recording (or one group of the same song, below) whose length is
   within `DURATION_TOLERANCE_S` of ours is a match with method `isrc`, confidence 1.0; with no
   length to compare, 0.95. An ISRC whose recordings disagree with our length falls through to
   the search.
2. **Otherwise the search.** Each candidate is scored on the normalised title (weight 0.5), the
   normalised lead artist or full credit, whichever is closer (0.35), and the length (0.15,
   falling linearly to 0 at four seconds apart). A candidate needs a title similarity of at least
   `MIN_TITLE`, an artist similarity of at least `MIN_ARTIST` and a length within four seconds of
   ours (both lengths must be known), or it is dropped. A candidate whose title names a version
   ours does not ("(Live)", "[Acoustic]", "- Radio Remix") is dropped too: on a long title the
   similarity alone would let it through.
3. **A single clear winner.** MusicBrainz often holds the same song as several recordings (a
   remaster, the same track on a single and an album). Candidates with the same normalised title
   and artist whose lengths are within `SAME_SONG_S` of each other form one group, and groups
   compete, not recordings. The best group must score at least `MIN_SCORE` and beat the next
   group by at least `MARGIN` (0.08); otherwise the answer is `ambiguous` and no match. With no
   candidate left the answer is `no_match`.

The cover comes from the winning group's releases, best first (`rank_releases`): the earliest
official album with no secondary type (not a compilation, live album, soundtrack or remix), then
official EPs, official singles, other official releases, and anything else last.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any

from selecta.library.scan import _ARTIST_SPLIT, _FEAT_TAIL, _TITLE_NOISE

KEY_VERSION = "v1"
DURATION_TOLERANCE_S = 4.0
SAME_SONG_S = 2.0
MIN_TITLE = 0.9
MIN_ARTIST = 0.8
MIN_SCORE = 0.88
MARGIN = 0.08
ISRC_CONFIDENCE = 1.0
ISRC_NO_LENGTH_CONFIDENCE = 0.95
W_TITLE, W_ARTIST, W_LENGTH = 0.5, 0.35, 0.15
MAX_CANDIDATES_KEPT = 10

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_DATE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")
# "(Live)", "[Acoustic]", "- Radio Remix": a different version of the song, not the song
_VERSION_PART = re.compile(r"[\(\[]([^\)\]]*)[\)\]]|\s[-–]\s(.+)$")
_VERSION_WORD = re.compile(
    r"\b(live|remix|acoustic|instrumental|demo|karaoke|unplugged)\b", re.IGNORECASE
)


def versions(title: str | None) -> set[str]:
    """The version words ("live", "remix" and so on) in a title's brackets or dash suffix."""
    found: set[str] = set()
    for part in _VERSION_PART.finditer(title or ""):
        found.update(w.lower() for w in _VERSION_WORD.findall(part.group(1) or part.group(2) or ""))
    return found


def _fold(text: str) -> str:
    plain = "".join(
        c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)
    )
    return _NON_ALNUM.sub(" ", plain.lower()).strip()


def normalise_title(title: str | None) -> str:
    """The title without featuring credits, "(Official Video)" and the like, folded."""
    return _fold(_FEAT_TAIL.sub("", _TITLE_NOISE.sub(" ", title or "")))


def normalise_artist(artist: str | None) -> str:
    """The lead artist only (before "feat.", "&", "," and so on), folded."""
    return _fold(_ARTIST_SPLIT.split(artist or "")[0])


def normalise_full_artist(artist: str | None) -> str:
    return _fold(artist or "")


@dataclass(frozen=True)
class Query:
    """What is known about the song: only these leave the server (ADR-0478)."""

    artist: str
    title: str
    album: str | None = None
    duration_s: float | None = None
    isrc: str | None = None

    def sent(self) -> dict[str, Any]:
        """The query as stored on the lookup row and searched with: the lead artist and the
        title without featuring credits or "(Official Video)", case and punctuation kept."""
        return {
            "artist": _ARTIST_SPLIT.split(self.artist or "")[0].strip()[:200],
            "title": _FEAT_TAIL.sub("", _TITLE_NOISE.sub(" ", self.title or "")).strip(" -")[:200],
            "album": (self.album or "").strip()[:200] or None,
            "duration_s": round(self.duration_s) if self.duration_s else None,
            "isrc": self.isrc,
        }


def lookup_key(query: Query) -> str:
    """One key per normalised song, shared by every workspace: an ISRC alone when there is one,
    otherwise the lead artist, the title and the length to the second."""
    if query.isrc:
        raw = f"{KEY_VERSION}|isrc|{query.isrc}"
    else:
        length = round(query.duration_s) if query.duration_s else ""
        raw = (
            f"{KEY_VERSION}|q|{normalise_artist(query.artist)}|{normalise_title(query.title)}"
            f"|{length}"
        )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def credit(recording: dict[str, Any]) -> str:
    """The artist credit as MusicBrainz prints it ("A feat. B")."""
    parts = recording.get("artist-credit") or []
    text = "".join(
        f"{p.get('name') or (p.get('artist') or {}).get('name') or ''}{p.get('joinphrase') or ''}"
        for p in parts
        if isinstance(p, dict)
    )
    return text.strip()


def length_s(recording: dict[str, Any]) -> float | None:
    value = recording.get("length")
    return float(value) / 1000.0 if isinstance(value, int | float) and value > 0 else None


@dataclass(frozen=True)
class Candidate:
    recording_id: str
    title: str
    artist: str
    length_s: float | None
    score: float
    releases: tuple[dict[str, Any], ...] = ()

    def to_dict(self) -> dict[str, Any]:
        best = rank_releases(list(self.releases))
        return {
            "recording_id": self.recording_id,
            "release_id": best[0]["id"] if best else None,
            "title": self.title,
            "artist": self.artist,
            "length_s": self.length_s,
            "score": round(self.score, 3),
        }


@dataclass(frozen=True)
class Outcome:
    """`matched`, `no_match` or `ambiguous`. A match names the recording, the method, the
    confidence and the release ids best first."""

    status: str
    method: str | None = None
    confidence: float | None = None
    recording_id: str | None = None
    release_ids: tuple[str, ...] = ()
    candidates: tuple[Candidate, ...] = field(default_factory=tuple)

    @property
    def matched(self) -> bool:
        return self.status == "matched"


def score(query: Query, recording: dict[str, Any]) -> float | None:
    """The candidate's score, or None when it fails a hard requirement (module notes)."""
    ours, theirs = query.duration_s, length_s(recording)
    if not ours or theirs is None:
        return None
    delta = abs(ours - theirs)
    if delta > DURATION_TOLERANCE_S:
        return None
    if versions(recording.get("title")) - versions(query.title):
        return None
    title = similarity(normalise_title(query.title), normalise_title(recording.get("title")))
    full = credit(recording)
    artist = max(
        similarity(normalise_artist(query.artist), normalise_artist(full)),
        similarity(normalise_full_artist(query.artist), normalise_full_artist(full)),
    )
    if title < MIN_TITLE or artist < MIN_ARTIST:
        return None
    return W_TITLE * title + W_ARTIST * artist + W_LENGTH * (1 - delta / DURATION_TOLERANCE_S)


def _candidate(recording: dict[str, Any], value: float) -> Candidate:
    releases = tuple(r for r in recording.get("releases") or [] if isinstance(r, dict))
    return Candidate(
        recording_id=str(recording.get("id")),
        title=str(recording.get("title") or ""),
        artist=credit(recording),
        length_s=length_s(recording),
        score=value,
        releases=releases,
    )


def _groups(candidates: list[Candidate]) -> list[list[Candidate]]:
    """Candidates of the same song (module notes, rule 3), best group first."""
    groups: list[list[Candidate]] = []
    for item in sorted(candidates, key=lambda c: -c.score):
        name = (normalise_title(item.title), normalise_artist(item.artist))
        for group in groups:
            lead = group[0]
            if (
                (normalise_title(lead.title), normalise_artist(lead.artist)) == name
                and lead.length_s is not None
                and item.length_s is not None
                and abs(lead.length_s - item.length_s) <= SAME_SONG_S
            ):
                group.append(item)
                break
        else:
            groups.append([item])
    return groups


def _winner(group: list[Candidate], method: str, confidence: float, kept) -> Outcome:
    releases = [r for c in group for r in c.releases]
    ranked = rank_releases(releases)
    owner = group[0].recording_id
    if ranked:
        best = ranked[0]["id"]
        owner = next(c.recording_id for c in group if any(r.get("id") == best for r in c.releases))
    seen: list[str] = []
    for release in ranked:
        if release["id"] not in seen:
            seen.append(release["id"])
    return Outcome(
        "matched", method, round(confidence, 3), owner, tuple(seen), tuple(kept)
    )


def choose(query: Query, recordings: list[dict[str, Any]]) -> Outcome:
    """Search matching (rules 2 and 3)."""
    scored = [
        _candidate(r, s)
        for r in recordings
        if r.get("id") and (s := score(query, r)) is not None
    ]
    kept = sorted(scored, key=lambda c: -c.score)[:MAX_CANDIDATES_KEPT]
    if not scored:
        return Outcome("no_match")
    groups = _groups(scored)
    best = groups[0][0].score
    if best < MIN_SCORE:
        return Outcome("no_match", candidates=tuple(kept))
    if len(groups) > 1 and best - groups[1][0].score < MARGIN:
        return Outcome("ambiguous", candidates=tuple(kept))
    return _winner(groups[0], "search", best, kept)


def by_isrc(query: Query, recordings: list[dict[str, Any]]) -> Outcome:
    """ISRC matching (rule 1). `no_match` here means "fall through to the search"."""
    found = [r for r in recordings if isinstance(r, dict) and r.get("id")]
    if not found:
        return Outcome("no_match")
    if query.duration_s:
        close = [
            r for r in found
            if (n := length_s(r)) is not None
            and abs(n - query.duration_s) <= DURATION_TOLERANCE_S
        ]
        confidence = ISRC_CONFIDENCE
    else:
        close, confidence = found, ISRC_NO_LENGTH_CONFIDENCE
    if not close:
        return Outcome("no_match")
    candidates = [_candidate(r, confidence) for r in close]
    groups = _groups(candidates) if query.duration_s else [candidates]
    if len(groups) > 1:
        return Outcome("ambiguous", candidates=tuple(candidates[:MAX_CANDIDATES_KEPT]))
    return _winner(groups[0], "isrc", confidence, candidates[:MAX_CANDIDATES_KEPT])


def _date_key(date: str | None) -> str:
    if not date or not _DATE.match(date):
        return "9999-99-99"
    return (date + "-99-99")[:10]


def _tier(release: dict[str, Any]) -> int:
    group = release.get("release-group") or {}
    primary = (group.get("primary-type") or "").lower()
    secondary = [s.lower() for s in group.get("secondary-types") or [] if isinstance(s, str)]
    official = (release.get("status") or "").lower() == "official"
    if not official:
        return 5
    if primary == "album" and not secondary:
        return 0
    if primary == "ep" and not secondary:
        return 1
    if primary == "single" and not secondary:
        return 2
    if primary == "album":
        return 3
    return 4


def rank_releases(releases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Releases best cover first: tier (module notes), then earliest date, then id for a stable
    order. Repeats of one release are kept once."""
    unique: dict[str, dict[str, Any]] = {}
    for release in releases:
        if isinstance(release, dict) and release.get("id"):
            unique.setdefault(str(release["id"]), release)
    return sorted(
        unique.values(), key=lambda r: (_tier(r), _date_key(r.get("date")), str(r["id"]))
    )


def release_facts(release: dict[str, Any]) -> dict[str, Any]:
    """The columns of `catalog_releases` from a MusicBrainz release."""
    group = release.get("release-group") or {}
    date = release.get("date") if _DATE.match(release.get("date") or "") else None
    return {
        "id": str(release["id"]),
        "title": str(release.get("title") or "")[:512],
        "artist": (credit(release) or None) and credit(release)[:512],
        "date": date,
        "year": int(date[:4]) if date else None,
        "country": (release.get("country") or None) and str(release["country"])[:8],
        "status": (release.get("status") or None) and str(release["status"])[:32],
        "release_group_id": group.get("id"),
        "primary_type": (group.get("primary-type") or None) and str(group["primary-type"])[:32],
        "secondary_types": [s for s in group.get("secondary-types") or [] if isinstance(s, str)],
    }


def recording_facts(recording: dict[str, Any], release_ids: list[str]) -> dict[str, Any]:
    """The columns of `catalog_recordings` from a MusicBrainz recording."""
    first = recording.get("first-release-date")
    return {
        "id": str(recording["id"]),
        "title": str(recording.get("title") or "")[:512],
        "artist": credit(recording)[:512],
        "length_s": length_s(recording),
        "isrcs": [i for i in recording.get("isrcs") or [] if isinstance(i, str)],
        "release_ids": release_ids,
        "first_release_date": first if _DATE.match(first or "") else None,
    }


def candidates_json(outcome: Outcome) -> list[dict[str, Any]]:
    return json.loads(json.dumps([c.to_dict() for c in outcome.candidates]))


__all__ = [
    "DURATION_TOLERANCE_S",
    "MARGIN",
    "MIN_SCORE",
    "Candidate",
    "Outcome",
    "Query",
    "by_isrc",
    "candidates_json",
    "choose",
    "credit",
    "lookup_key",
    "normalise_artist",
    "normalise_title",
    "rank_releases",
    "recording_facts",
    "release_facts",
    "score",
]
