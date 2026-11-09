"""Local-only API for Selecta's browser interface.

The browser never decodes an original file. It gets each song as the same samples analysis and
rendering used, at the level the mix uses, plus finished seams, and joins them on its audio clock.
"""

from __future__ import annotations

import asyncio
import hashlib
import threading
from collections import deque
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit

from fastapi import FastAPI, Response
from fastapi.responses import JSONResponse

from selecta import flags, mix
from selecta.api_common import (
    LOCAL_HOSTS,
    OPERATIONS_KEPT,
    FreshFiles,
    _Background,
)
from selecta.backup import BackupError, activate_pending_restore
from selecta.config import Settings, load_settings
from selecta.flags import guard as flag_guard
from selecta.routes.discover import add_routes as discover_routes
from selecta.routes.edit import add_routes as edit_routes
from selecta.routes.exports import add_routes as exports_routes
from selecta.routes.helpers import add_routes as helpers_routes
from selecta.routes.library import add_routes as library_routes
from selecta.routes.lucy import add_routes as lucy_routes
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
    flags.effective()  # a mistake in SELECTA_FLAGS stops the start, rather than a request later

    settings.home.mkdir(parents=True, exist_ok=True)
    restore_problem = None
    try:
        # Apply a validated restore only before database connections or
        # render/analysis workers start; never replace an active SQLite file.
        activate_pending_restore(settings)
    except (BackupError, OSError) as problem:
        restore_problem = str(problem)
        if not settings.db_path.exists():
            raise

    app = FastAPI(title="Selecta", docs_url="/api/docs")

    store = SeamStore(settings)

    store.forget_unfinished()  # no worker is running yet, so nothing can be under way

    background = _Background(settings.home)

    # Operation names are not permission to replay an unrelated command. Bind
    # each name to the exact route and body that first used it.
    finished_operations: dict[str, tuple[int, bytes, str]] = {}

    running_operations: dict[str, asyncio.Event] = {}
    active_fingerprints: dict[str, str] = {}

    # what happened to the last few, for diagnostics: only the kind of thing, never what it named
    recent_operations: deque[dict] = deque(maxlen=20)

    ctx = SimpleNamespace(
        settings=settings,
        store=store,
        background=background,
        recent_operations=recent_operations,
        restore_problem=restore_problem,
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
    lucy_routes(app, ctx)
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
        if len(operation) > 128:
            return JSONResponse({"detail": "Operation ID is too long."}, status_code=400)
        identity = b"\0".join((
            request.method.encode(),
            request.url.path.encode(),
            request.url.query.encode(),
            await request.body(),
        ))
        fingerprint = hashlib.sha256(identity).hexdigest()
        if operation in running_operations:
            if active_fingerprints.get(operation) != fingerprint:
                return JSONResponse(
                    {"detail": "That operation ID already belongs to a different action."},
                    status_code=409,
                )
            await running_operations[operation].wait()
        kind = operation.split("-", 1)[0]
        known = finished_operations.get(operation)
        if known is not None:
            if known[2] != fingerprint:
                return JSONResponse(
                    {"detail": "That operation ID already belongs to a different action."},
                    status_code=409,
                )
            recent_operations.append({"kind": kind, "status": known[0], "repeat": True})
            return Response(known[1], status_code=known[0], media_type="application/json")
        running_operations[operation] = asyncio.Event()
        active_fingerprints[operation] = fingerprint
        try:
            response = await call_next(request)
            body = b"".join([chunk async for chunk in response.body_iterator])
            recent_operations.append(
                {"kind": kind, "status": response.status_code, "repeat": False}
            )
            if response.status_code < 500:
                finished_operations[operation] = (response.status_code, body, fingerprint)
                while len(finished_operations) > OPERATIONS_KEPT:
                    del finished_operations[next(iter(finished_operations))]
        finally:
            running_operations.pop(operation).set()
            active_fingerprints.pop(operation, None)
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
        # Export jobs persist across server restarts. A retried operation that
        # already created a frozen job must recover that exact job even if the
        # audible mix changed since its original submission.
        if (
            operation and request.method == "POST"
            and request.url.path == "/api/exports/jobs"
            and ctx.has_export_operation(operation)
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

    # runs straight after local_only: middleware added later runs earlier
    flag_guard.install(app)

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
    """The app as `selecta web` runs it; only local mode starts local workers."""
    from selecta.modes import Mode, current_mode

    if current_mode() is Mode.CLOUD:
        from selecta.api_cloud import create_cloud_app

        return create_cloud_app()

    from selecta.homes import gather_if_needed

    gather_if_needed(load_settings().home)
    return create_app(prepare_links=True)
