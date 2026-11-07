"""Local-only API for Selecta's browser interface.

The browser never decodes an original file. It gets each song as the same samples analysis and
rendering used, at the level the mix uses, plus finished seams, and joins them on its audio clock.
"""

from __future__ import annotations

import asyncio
import threading
from collections import deque
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit

from fastapi import FastAPI, Response
from fastapi.responses import JSONResponse

from selecta import mix
from selecta.api_common import (
    LOCAL_HOSTS,
    OPERATIONS_KEPT,
    FreshFiles,
    _Background,
)
from selecta.config import Settings, load_settings
from selecta.routes.discover import add_routes as discover_routes
from selecta.routes.edit import add_routes as edit_routes
from selecta.routes.exports import add_routes as exports_routes
from selecta.routes.helpers import add_routes as helpers_routes
from selecta.routes.library import add_routes as library_routes
from selecta.routes.mixes import add_routes as mixes_routes
from selecta.routes.song_requests import add_routes as song_requests_routes
from selecta.routes.system import add_routes as system_routes
from selecta.seams import (
    SeamStore,
)

__all__ = ["FreshFiles", "_Background", "create_app", "serve"]


def create_app(
    settings: Settings | None = None, web_dir: Path | None = None, prepare_links: bool = False
) -> FastAPI:
    settings = settings or load_settings()

    settings.home.mkdir(parents=True, exist_ok=True)

    app = FastAPI(title="Selecta", docs_url="/api/docs")

    store = SeamStore(settings)

    store.forget_unfinished()  # no worker is running yet, so nothing can be under way

    background = _Background(settings.home)

    finished_operations: dict[str, tuple[int, bytes]] = {}

    running_operations: dict[str, asyncio.Event] = {}

    # what happened to the last few, for diagnostics: only the kind of thing, never what it named
    recent_operations: deque[dict] = deque(maxlen=20)

    ctx = SimpleNamespace(
        settings=settings,
        store=store,
        background=background,
        recent_operations=recent_operations,
    )
    helpers_routes(app, ctx)
    library_routes(app, ctx)
    mixes_routes(app, ctx)
    system_routes(app, ctx)
    # before edit's /api/exports/{name}, or that would answer for /api/exports/jobs
    exports_routes(app, ctx)
    edit_routes(app, ctx)
    song_requests_routes(app, ctx)
    discover_routes(app, ctx)
    connect = ctx.connect
    ranked_links = ctx.ranked_links
    watch_for_new_songs = ctx.watch_for_new_songs

    @app.middleware("http")
    async def same_operation_once(request, call_next):
        """Something important sent twice, because the first answer got lost, gets the first answer
        back instead of being done again."""
        operation = request.headers.get("x-operation-id")
        if not operation or request.method != "POST":
            return await call_next(request)
        if operation in running_operations:
            await running_operations[operation].wait()
        kind = operation.split("-", 1)[0]
        known = finished_operations.get(operation)
        if known is not None:
            recent_operations.append({"kind": kind, "status": known[0], "repeat": True})
            return Response(known[1], status_code=known[0], media_type="application/json")
        running_operations[operation] = asyncio.Event()
        try:
            response = await call_next(request)
            body = b"".join([chunk async for chunk in response.body_iterator])
            recent_operations.append(
                {"kind": kind, "status": response.status_code, "repeat": False}
            )
            if response.status_code < 500:
                finished_operations[operation] = (response.status_code, body)
                while len(finished_operations) > OPERATIONS_KEPT:
                    del finished_operations[next(iter(finished_operations))]
        finally:
            running_operations.pop(operation).set()
        return Response(
            body,
            status_code=response.status_code,
            headers={k: v for k, v in response.headers.items() if k.lower() != "content-length"},
        )

    @app.middleware("http")
    async def what_you_saw_is_what_you_change(request, call_next):
        """Most edits to a mix say which position they mean. If the mix has changed since the page
        last looked, that could be a different song, so it stops and says so."""
        order = request.headers.get("x-mix-order")
        if order is None or request.method == "GET":
            return await call_next(request)
        # Replaying an accepted operation must return its original result, even
        # though the first successful mutation changed the queue order.
        operation = request.headers.get("x-operation-id")
        if operation and (
            operation in finished_operations or operation in running_operations
        ):
            return await call_next(request)
        draft = request.query_params.get("draft")
        try:
            with connect() as conn:
                items = mix._items(conn, int(draft) if draft else None)
        except (ValueError, mix.NoSuchDraft):
            return await call_next(request)
        if order != ",".join(str(item[0]) for item in items):
            return JSONResponse(
                {
                    "detail": "This mix has just changed, so nothing was done.",
                    "code": "mix_changed",
                },
                status_code=409,
            )
        return await call_next(request)

    @app.middleware("http")
    async def local_only(request, call_next):
        host = request.headers.get("host", "").split(":")[0]
        if host not in LOCAL_HOSTS:
            return JSONResponse({"detail": "Selecta is local only"}, status_code=403)
        origin = request.headers.get("origin")
        if request.method not in {"GET", "HEAD", "OPTIONS"} and origin:
            if urlsplit(origin).hostname not in LOCAL_HOSTS:
                return JSONResponse({"detail": "Selecta is local only"}, status_code=403)
        return await call_next(request)

    if prepare_links:
        threading.Thread(target=watch_for_new_songs, daemon=True).start()

    if prepare_links:
        store.prepare_links = True
        store.start()

        def warm_up() -> None:
            """Load the library and lyric links now, so the first tap on a mix doesn't wait."""
            with connect() as conn:
                ranked_links(conn)

        threading.Thread(target=warm_up, daemon=True).start()

    root = web_dir or Path(__file__).parents[2] / "web" / "dist"

    if root.exists():
        app.mount("/", FreshFiles(directory=root, html=True), name="web")

    return app


def serve() -> FastAPI:
    """The app as `selecta web` runs it. Only this starts the worker, not importing the file."""
    from selecta.homes import gather_if_needed

    gather_if_needed(load_settings().home)
    return create_app(prepare_links=True)
