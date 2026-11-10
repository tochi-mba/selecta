"""Cleaning up names and types a browser sends, for showing back to the person.

These are display values only. They never go into an object key or a file path (keys are built
from ids in `keys.py`), so the cleaning is about showing them safely, not about escaping.
"""

from __future__ import annotations

import re
import unicodedata

MAX_DISPLAY_NAME = 200
UNTITLED = "Untitled"
DEFAULT_CONTENT_TYPE = "application/octet-stream"
CONTENT_TYPE = re.compile(r"^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$")


def display_name(raw: str | None) -> str:
    """A file name fit to show: Unicode NFC, folders dropped, control and formatting characters
    (including right-to-left overrides) removed, spaces collapsed, at most 200 characters."""
    text = unicodedata.normalize("NFC", raw or "")
    text = text.replace("\\", "/").rsplit("/", 1)[-1]
    text = "".join(ch for ch in text if unicodedata.category(ch)[0] != "C")
    text = " ".join(text.split())
    text = unicodedata.normalize("NFC", text[:MAX_DISPLAY_NAME]).strip()
    if not text or set(text) <= {"."}:
        return UNTITLED
    return text


def content_type(raw: str | None) -> str:
    """The browser's MIME type if it looks like one, else `application/octet-stream`. It's only
    a hint: the real format is found by probing the file during validation."""
    text = (raw or "").split(";", 1)[0].strip().lower()
    return text if CONTENT_TYPE.match(text) else DEFAULT_CONTENT_TYPE


def sha256_hex(raw: str | None) -> str | None:
    """A browser-computed SHA-256 as 64 lower-case hex digits, or None if it isn't one. It's
    optional and only used to spot duplicates, so a malformed one is dropped, not refused."""
    text = (raw or "").strip().lower()
    return text if re.fullmatch(r"[0-9a-f]{64}", text) else None
