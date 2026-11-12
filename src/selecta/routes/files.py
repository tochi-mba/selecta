"""Rendered audio, answered so that a browser already holding it doesn't fetch it again (r8d).

A transition, a preview, an audition step or a stem can be rendered again under the same address
(a retry, a corrected analysis), so nothing here is cached without asking: every answer says
`no-cache`, and a browser that sends back the tag it was given gets a bodyless 304 while the file
is unchanged. Before this, the files went out with a tag but no cache rule, so a browser could
reuse an old take by guesswork, or download an unchanged one in full every time.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import Request, Response
from fastapi.responses import FileResponse

REVALIDATE = "no-cache"


def _matches(header: str | None, etag: str) -> bool:
    """If-None-Match, compared weakly as RFC 9110 says a GET must be."""
    if not header:
        return False
    if header.strip() == "*":
        return True
    bare = etag.removeprefix("W/")
    return any(tag.strip().removeprefix("W/") == bare for tag in header.split(","))


def audio_file(
    request: Request | None,
    path: Path,
    media_type: str = "audio/flac",
    filename: str | None = None,
    etag: str | None = None,
) -> Response:
    """The file, or a 304 when the browser's copy is still this exact file. One stat serves both
    the tag and the response, rather than one each. A caller whose file is made from another one
    (r10: a decoded song) passes `etag` to tag it by its source instead of by the copy."""
    facts = path.stat()
    headers = {"Cache-Control": REVALIDATE}
    if etag is not None:
        headers["ETag"] = etag
    response = FileResponse(
        path,
        media_type=media_type,
        filename=filename,
        stat_result=facts,
        headers=headers,
    )
    etag = response.headers["etag"]
    if request is not None and _matches(request.headers.get("if-none-match"), etag):
        return Response(
            status_code=304,
            headers={
                "ETag": etag,
                "Last-Modified": response.headers["last-modified"],
                "Cache-Control": REVALIDATE,
            },
        )
    return response
