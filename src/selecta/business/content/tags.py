"""The explicit flag from a file's own tags (ADR-0450, BZ-0450-02).

- MP4/M4A `rtng`: 1 explicit, 2 or 4 clean.
- ID3 `TXXX:ITUNESADVISORY`: 1 explicit, 2 clean.
- Vorbis comments (Ogg, FLAC): `ITUNESADVISORY` (1 explicit, 2 clean) or `EXPLICIT` (yes/no).

No reading, or readings that disagree, give `unknown`. A tag reading only ever fills in a flag
that no person chose: manual, bulk and import choices always stay (`merge_tag_reading`).
"""

from __future__ import annotations

import os
from pathlib import Path

HUMAN_SOURCES = frozenset({"manual", "bulk", "import"})
_ADVISORY = {"1": "explicit", "2": "clean"}
_RTNG = {1: "explicit", 2: "clean", 4: "clean"}
_YES = {"1", "yes", "true", "explicit", "y"}
_NO = {"0", "no", "false", "clean", "n"}


def _text(value) -> str:
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    return str(value).strip().casefold()


def _advisory(value) -> str | None:
    return _ADVISORY.get(_text(value))


def _explicit_word(value) -> str | None:
    text = _text(value)
    return "explicit" if text in _YES else "clean" if text in _NO else None


def _from_mp4(tags) -> set[str]:
    found = set()
    for value in tags.get("rtng", []) if tags is not None else []:
        try:
            reading = _RTNG.get(int(value))
        except (TypeError, ValueError):
            reading = None
        if reading:
            found.add(reading)
    return found


def _from_id3(tags) -> set[str]:
    found = set()
    for frame in tags.getall("TXXX") if tags is not None else []:
        if str(frame.desc).strip().casefold() == "itunesadvisory":
            found.update(r for r in (_advisory(text) for text in frame.text) if r)
    return found


def _from_vorbis(tags) -> set[str]:
    found = set()
    if tags is None:
        return found
    for key, value in tags.items():
        name = key.casefold()
        values = value if isinstance(value, list) else [value]
        if name == "itunesadvisory":
            found.update(r for r in (_advisory(v) for v in values) if r)
        elif name == "explicit":
            found.update(r for r in (_explicit_word(v) for v in values) if r)
    return found


def readings(path: os.PathLike | str) -> set[str]:
    """Every explicit or clean reading in the file's tags."""
    import mutagen
    from mutagen.id3 import ID3, ID3NoHeaderError
    from mutagen.mp4 import MP4

    path = Path(path)
    found: set[str] = set()
    try:
        audio = mutagen.File(path)
    except Exception:  # noqa: BLE001 - an unreadable file simply has no reading
        audio = None
    tags = getattr(audio, "tags", None)
    if isinstance(audio, MP4):
        found |= _from_mp4(tags)
    elif tags is not None and hasattr(tags, "getall"):
        found |= _from_id3(tags)
    elif tags is not None:
        found |= _from_vorbis(tags)
    if audio is None or not isinstance(tags, ID3):
        try:
            found |= _from_id3(ID3(path))
        except ID3NoHeaderError:
            pass
        except Exception:  # noqa: BLE001 - not an ID3 file either
            pass
    return found


def explicit_from_tags(path: os.PathLike | str) -> str:
    """`explicit`, `clean` or `unknown` (nothing found, or the tags disagree)."""
    found = readings(path)
    return found.pop() if len(found) == 1 else "unknown"


def merge_tag_reading(
    current: str | None, current_source: str | None, reading: str
) -> tuple[str, str] | None:
    """The (value, source) to store after reading tags, or None to leave the row alone."""
    if current_source in HUMAN_SOURCES:
        return None
    if current == reading and current_source == "tag":
        return None
    return reading, "tag"


__all__ = ["HUMAN_SOURCES", "explicit_from_tags", "merge_tag_reading", "readings"]
