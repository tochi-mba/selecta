"""The one check for ids that arrive in a request's path or body.

Ids are made by Selecta (`persistence.new_id`, a 36-character UUIDv7) and stored in 36-character
`Id` columns. A value that can't be one (empty, longer than 36 characters, non-ASCII, a NUL or
another control character, a separator) can't name anything, so routes refuse it with the same
404 a missing resource gets, before any database or storage call. That keeps a malformed id
indistinguishable from a missing one, and keeps NUL away from PostgreSQL, whose driver refuses
it with an error rather than finding nothing.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

MAX_ID_LENGTH = 36
_ID = re.compile(rf"[A-Za-z0-9][A-Za-z0-9_-]{{0,{MAX_ID_LENGTH - 1}}}")


def is_id(value: object) -> bool:
    """Whether `value` could be an id: 1 to 36 ASCII letters, digits, `-` or `_`, starting with
    a letter or digit."""
    return isinstance(value, str) and _ID.fullmatch(value) is not None


def require_id(value: Any, not_found: Mapping[str, Any]) -> str:
    """`value` if it could be an id; otherwise the route's own 404 (`not_found` is its detail),
    exactly as a missing resource would get it."""
    if not is_id(value):
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail=dict(not_found))
    return value


__all__ = ["MAX_ID_LENGTH", "is_id", "require_id"]
