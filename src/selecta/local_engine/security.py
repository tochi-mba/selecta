"""ASGI perimeter for installed loopback UI, including WS, CSRF and DNS rebinding."""

from __future__ import annotations

import hmac
from urllib.parse import urlsplit

from selecta.local_engine.config import access_token


def _host_port(value: str) -> tuple[str, int | None] | None:
    try:
        url = urlsplit("//" + value)
        if url.username or url.password or url.path or url.query or url.fragment:
            return None
        host = (url.hostname or "").lower()
        if host not in ("127.0.0.1", "localhost", "::1"):
            return None
        return host, url.port
    except ValueError:
        return None


def allowed_request(
    headers: dict[str, str], method: str, expected_port: int,
    *, websocket: bool = False, credential: str | None = None,
) -> bool:
    host = _host_port(headers.get("host", ""))
    if host is None or host[1] != expected_port:
        return False
    if headers.get("sec-fetch-site", "").lower() in ("cross-site", "same-site"):
        return False
    origin = headers.get("origin")
    if origin is not None:
        url = urlsplit(origin)
        origin_host = _host_port(url.netloc)
        if (
            url.scheme != "http" or url.path or url.query or url.fragment
            or origin_host != host
        ):
            return False
    if websocket and origin is None:
        return False
    if method.upper() not in ("GET", "HEAD", "OPTIONS") and origin is None:
        supplied = headers.get("x-selecta-local-token", "")
        if credential is None or not hmac.compare_digest(supplied, credential):
            return False
    if method.upper() == "OPTIONS" and origin is None:
        return False
    return True


class LoopbackGuard:
    """Apply before legacy routes: browser same-origin or authenticated headless writes."""

    def __init__(self, app, *, port: int, state_dir) -> None:
        self.app = app
        self.port = port
        self.state_dir = state_dir

    async def __call__(self, scope, receive, send):
        kind = scope["type"]
        if kind not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        headers = {
            key.decode("latin1").lower(): value.decode("latin1")
            for key, value in scope.get("headers", [])
        }
        try:
            credential = access_token(self.state_dir)
        except (OSError, ValueError):
            credential = None
        allowed = (
            scope.get("server", ("127.0.0.1", self.port))[1] == self.port
            and allowed_request(
                headers, scope.get("method", "GET"), self.port,
                websocket=kind == "websocket", credential=credential,
            )
        )
        if not allowed:
            if kind == "websocket":
                await send({"type": "websocket.close", "code": 1008})
            else:
                body = b'{"detail":"Local origin or access credential rejected"}'
                await send({
                    "type": "http.response.start",
                    "status": 403,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode()),
                                (b"cache-control", b"no-store")],
                })
                await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)
