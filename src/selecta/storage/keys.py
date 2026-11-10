"""Object keys: where every stored file lives, built only from ids Selecta made (ADR-0397).

A key never holds a file name, a tag or anything else a person typed, so a listing of a bucket
reveals nothing about anyone's music and a crafted name can't climb out of its folder. There are
four layouts, one per bucket:

| Bucket | Key |
|---|---|
| originals | `w/{workspace}/a/{asset_id}` |
| derived | `w/{workspace}/{kind}/{input_hash}/attempts/{attempt_id}/{name}` |
| exports | `w/{workspace}/x/{export_id}.flac` |
| staging | `s/{upload_session_id}/object` |

Derived files are written under an attempt folder, so two workers finishing the same job never
overwrite each other; a manifest row elsewhere says which attempt won. The derived folder is
named by `input_hash`, so identical inputs (same song content, same engine versions, same
settings) land on the same key within one workspace and the finished work is reused. Hashes are
scoped to the workspace on purpose: there is no deduplication across accounts.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from enum import StrEnum
from typing import Any

MAX_KEY_LENGTH = 512
HASH_FORMAT = "selecta.artifact/1"

_ID = r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}"
# At least two characters, so a kind can never be `a` (originals) or `x` (exports).
_KIND = r"[a-z][a-z0-9_]{1,31}"
_HASH = r"[0-9a-f]{64}"
_NAME = r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:\.[A-Za-z0-9]{1,16}){0,2}"

ID = re.compile(_ID)
KIND = re.compile(_KIND)
HASH = re.compile(_HASH)
NAME = re.compile(_NAME)


class Bucket(StrEnum):
    ORIGINALS = "originals"
    DERIVED = "derived"
    EXPORTS = "exports"
    STAGING = "staging"


_LAYOUTS = (
    (Bucket.ORIGINALS, re.compile(rf"w/{_ID}/a/{_ID}")),
    (Bucket.EXPORTS, re.compile(rf"w/{_ID}/x/{_ID}\.flac")),
    (Bucket.DERIVED, re.compile(rf"w/{_ID}/{_KIND}/{_HASH}/attempts/{_ID}/{_NAME}")),
    (Bucket.STAGING, re.compile(rf"s/{_ID}/object")),
)


class UnsafeKey(ValueError):
    """A key, or a piece of one, that doesn't follow the layouts above."""


def _check(pattern: re.Pattern[str], value: str, what: str) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise UnsafeKey(f"{what} {value!r} can't go in an object key.")
    return value


def original_key(workspace_id: str, asset_id: str) -> str:
    """Where an accepted upload lives in the originals bucket."""
    return f"w/{_check(ID, workspace_id, 'Workspace id')}/a/{_check(ID, asset_id, 'Asset id')}"


def derived_key(workspace_id: str, kind: str, key: str, attempt_id: str, name: str) -> str:
    """Where one attempt writes one derived file. `key` is an `input_hash`; `name` is a fixed
    file name chosen by the code that makes the file, such as `features.npz`."""
    return (
        f"w/{_check(ID, workspace_id, 'Workspace id')}/{_check(KIND, kind, 'Kind')}"
        f"/{_check(HASH, key, 'Input hash')}/attempts/{_check(ID, attempt_id, 'Attempt id')}"
        f"/{_check(NAME, name, 'File name')}"
    )


def export_key(workspace_id: str, export_id: str) -> str:
    """Where a finished export lives in the exports bucket."""
    workspace = _check(ID, workspace_id, "Workspace id")
    return f"w/{workspace}/x/{_check(ID, export_id, 'Export id')}.flac"


def staging_key(upload_session_id: str) -> str:
    """Where an upload in progress lands, before it's checked and accepted."""
    return f"s/{_check(ID, upload_session_id, 'Upload session id')}/object"


def workspace_prefix(workspace_id: str) -> str:
    """Everything a workspace owns in a bucket starts with this, for account deletion."""
    return f"w/{_check(ID, workspace_id, 'Workspace id')}/"


def derived_prefix(workspace_id: str, kind: str, key: str) -> str:
    """Every attempt at one derived artifact starts with this."""
    return (
        f"w/{_check(ID, workspace_id, 'Workspace id')}/{_check(KIND, kind, 'Kind')}"
        f"/{_check(HASH, key, 'Input hash')}/"
    )


def validate_key(key: str) -> Bucket:
    """The bucket `key` belongs in, or `UnsafeKey` if it doesn't match one of the layouts exactly.

    Every store checks keys with this before touching a file or an object, so nothing outside
    the layouts (`..`, a leading `/`, a backslash, spaces, non-ASCII text, a file name someone
    typed) is ever read, written or signed.
    """
    if not isinstance(key, str) or not key.isascii() or len(key) > MAX_KEY_LENGTH:
        raise UnsafeKey(f"{key!r} isn't a Selecta object key.")
    for bucket, layout in _LAYOUTS:
        if layout.fullmatch(key):
            return bucket
    raise UnsafeKey(f"{key!r} isn't a Selecta object key.")


def is_safe_key(key: str) -> bool:
    try:
        validate_key(key)
    except UnsafeKey:
        return False
    return True


def workspace_of(key: str) -> str | None:
    """The workspace a key belongs to, or None for staging keys (they belong to a session)."""
    if validate_key(key) is Bucket.STAGING:
        return None
    return key.split("/", 2)[1]


def input_hash(workspace_id: str, kind: str, inputs: Mapping[str, Any]) -> str:
    """The derived-artifact key for these inputs: SHA-256 of canonical JSON, as 64 hex digits.

    `inputs` holds everything the output depends on: content hashes of the assets it reads, the
    versions of the code and models that make it, and the settings. At least one top-level entry
    must name a version (`analysis_version`, `versions`, ...), because a hash without one would
    keep handing out old results after an engine upgrade. Keys are sorted and the JSON is compact,
    so the same inputs always give the same hash, in any order. Values must be plain JSON
    (strings, numbers, booleans, None, lists and objects); anything else is refused rather than
    turned into text that might change between runs.
    """
    _check(ID, workspace_id, "Workspace id")
    _check(KIND, kind, "Kind")
    if not isinstance(inputs, Mapping):
        raise TypeError("inputs must be a mapping of names to plain JSON values")
    if not any("version" in str(name).lower() for name in inputs):
        raise ValueError(
            "inputs must include the versions the output depends on, "
            "for example {'analysis_version': 7, ...}"
        )
    document = {"format": HASH_FORMAT, "workspace": workspace_id, "kind": kind, "inputs": inputs}
    text = json.dumps(
        document, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
