"""Where the local stand-in pages may send a browser: only back to this machine's SelectaDJ site.

`safe_path` keeps a same-site path that starts with exactly one "/" (no "//host", no scheme such as
`javascript:`, no backslashes or control characters) and turns anything else into "/".
`site_target` accepts that, or a full URL whose origin is exactly one of the allowed site origins,
and always rebuilds the answer from the allow-listed origin rather than from the input.
"""

from __future__ import annotations

from collections.abc import Sequence
from urllib.parse import urlsplit

from fastapi.responses import RedirectResponse


def safe_path(value: object) -> str:
    if not isinstance(value, str) or len(value) > 2048:
        return "/"
    if not value.startswith("/") or value.startswith("//") or "\\" in value:
        return "/"
    if any(ord(char) < 0x20 or ord(char) == 0x7F for char in value):
        return "/"
    parts = urlsplit(value)
    if parts.scheme or parts.netloc:
        return "/"
    return (parts.path or "/") + (f"?{parts.query}" if parts.query else "")


def site_target(value: object, origins: Sequence[str]) -> str:
    """An absolute URL on one of `origins` (the first when `value` isn't acceptable)."""
    home = origins[0].rstrip("/")
    if not isinstance(value, str) or not value:
        return home + "/"
    if value.startswith("/"):
        return home + safe_path(value)
    parts = urlsplit(value)
    if "\\" in value or parts.username or parts.password:
        return home + "/"
    for origin in origins:
        if f"{parts.scheme}://{parts.netloc}" == origin.rstrip("/"):
            rest = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
            return origin.rstrip("/") + safe_path(rest)
    return home + "/"


class LocalPathRedirectResponse(RedirectResponse):
    """Keep local-development redirects on this server, even at the response boundary."""

    def __init__(self, destination: object, *, status_code: int = 303) -> None:
        super().__init__(safe_path(destination), status_code=status_code)


__all__ = ["LocalPathRedirectResponse", "safe_path", "site_target"]
