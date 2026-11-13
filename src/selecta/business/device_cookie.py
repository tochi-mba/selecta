"""One device cookie per workspace, so a browser in two workspaces never sends the wrong id.

ADR-0442 (BZ-0442-07): a person can use SelectaDJ in their personal workspace and in an
organisation from the same browser. Each workspace registers its own device row, so the HttpOnly
fallback cookie is named per workspace: `selecta_device_` plus the first 12 hex characters of
the SHA-256 of the workspace id. The id in a request body always wins over any cookie.

Browsers that registered before this change hold the legacy `selecta_device` cookie. It is read
only for a personal workspace, where it can only ever have come from; a business workspace never
reads it, so a personal device id can't be presented to an organisation.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping

LEGACY_COOKIE = "selecta_device"
HASH_CHARS = 12


def cookie_name(workspace_id: str) -> str:
    """The device cookie's name for this workspace."""
    digest = hashlib.sha256(workspace_id.encode("utf-8")).hexdigest()
    return f"{LEGACY_COOKIE}_{digest[:HASH_CHARS]}"


def read(
    cookies: Mapping[str, str],
    workspace_id: str,
    *,
    personal: bool,
    body_device_id: str | None = None,
) -> str | None:
    """The device id this request names: the body's, else this workspace's cookie, else (in a
    personal workspace only) the legacy cookie."""
    if body_device_id:
        return body_device_id
    found = cookies.get(cookie_name(workspace_id))
    if found:
        return found
    if personal:
        return cookies.get(LEGACY_COOKIE) or None
    return None


__all__ = ["HASH_CHARS", "LEGACY_COOKIE", "cookie_name", "read"]
