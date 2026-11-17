"""Scripted, repeatable no-audio-egress capture for gate 4 (BF-0466-04, BF-0457-07).

Method
------
Gate 4 of docs/verification/bf-gate-register.md needs an authenticated capture proving that a
default (no hosted grant) account's actions send zero audio bytes off the device. This script is
the repeatable half of that procedure:

1. It builds the real e2e cloud server app (``tests/e2e_cloud_server.py``: the production Cloud
   API over a fresh database with fake sign-in, storage and Stripe, seeded at start-up) and wraps
   it in an in-process recording ASGI middleware. The middleware sees every HTTP request exactly
   as the server receives it and writes one JSON line per request: method, path, request content
   type and body byte count, response status, response content type and body byte count.
2. It serves the wrapped app on 127.0.0.1 with uvicorn in a thread. It must really listen: the
   server's own test endpoints call back into it over HTTP.
3. It runs the scripted member actions for a fresh account WITHOUT the ``cloud.hosted_media``
   grant: sign in (onboarding), register metadata-only songs via ``POST /api/local-media/songs``
   (content-hash identities and display metadata, never paths or audio; ADR-0458), and read the
   account back.
4. It asserts over the recorded log: zero requests whose content type is ``audio/*`` or
   ``multipart/*``, and zero request bodies over the byte threshold. It writes the full JSONL
   log and a pass/fail artifact into ``--out`` and exits nonzero on failure.

The ``/api/local-media/songs`` route ships with BF-0458-03; until it exists the registration
step records its 404 in the artifact and the capture still stands, because the assertion is
about what the client sent, not about what the server implemented.

What a run proves, and what it never proves: a pass is evidence for exactly the scripted actions
against this build. The gate also needs the same capture over real import, analysis, play, mix
and export in a real browser (the register row says so), and two independent runs agreeing.
Archive each run's out directory as the evidence artifact.

Run (a procedure, not a test; CI never runs this file):

    uv run python tools/bf_egress_capture.py --out docs/verification/egress/run-<date>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))

import e2e_cloud_server  # noqa: E402  (the repo's own e2e server; pulls the repo's deps)
import uvicorn  # noqa: E402  (already a repo dependency; e2e_cloud_server serves with it)

from selecta import flags  # noqa: E402

# Metadata-only registrations are small JSON; anything near this is suspicious whatever it says
# in its content type.
DEFAULT_MAX_BODY = 256 * 1024
BAD_TYPES = ("audio/", "multipart/")


class RecordingASGI:
    """Wraps the app so every HTTP request is logged before anything else sees it: the capture
    happens below the routes, so no route can opt out of being recorded."""

    def __init__(self, app, log_path: Path) -> None:
        self.app = app
        self.log_path = log_path
        self.records: list[dict] = []
        self.lock = threading.Lock()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("", encoding="utf-8")

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", ())
        }
        entry = {
            "time": time.time(),
            "method": scope.get("method", ""),
            "path": scope.get("path", ""),
            "request_content_type": headers.get("content-type", ""),
            "request_bytes": 0,
            "status": None,
            "response_content_type": "",
            "response_bytes": 0,
        }

        async def counting_receive():
            message = await receive()
            if message["type"] == "http.request":
                entry["request_bytes"] += len(message.get("body", b""))
            return message

        async def counting_send(message):
            if message["type"] == "http.response.start":
                entry["status"] = message["status"]
                for key, value in message.get("headers", ()):
                    if key.decode("latin-1").lower() == "content-type":
                        entry["response_content_type"] = value.decode("latin-1")
            elif message["type"] == "http.response.body":
                entry["response_bytes"] += len(message.get("body", b""))
            await send(message)

        try:
            await self.app(scope, counting_receive, counting_send)
        finally:
            with self.lock:
                self.records.append(entry)
                with self.log_path.open("a", encoding="utf-8") as log:
                    log.write(json.dumps(entry) + "\n")


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def wait_until_up(base: str, timeout: float = 120.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{base}/api/status", timeout=5):
                return
        except (urllib.error.URLError, OSError):
            time.sleep(0.5)
    raise SystemExit(f"The capture server never came up at {base}.")


def call(base: str, method: str, path: str, token: str, payload: dict | None = None) -> dict:
    """One scripted request; returns what happened, for the artifact. Never raises on an HTTP
    error status: the capture records what the server said and moves on."""
    body = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(f"{base}{path}", data=body, method=method)
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("Origin", base)
    if body is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as answer:
            return {"method": method, "path": path, "status": answer.status}
    except urllib.error.HTTPError as refused:
        return {"method": method, "path": path, "status": refused.code}


def metadata_songs(count: int) -> list[dict]:
    """Metadata-only catalogue entries per ADR-0458: a content-hash identity plus display
    metadata. No path, no audio, nothing derived from audio."""
    songs = []
    for number in range(count):
        identity = hashlib.sha256(f"bf-egress-capture-song-{number}".encode()).hexdigest()
        songs.append(
            {
                "content_sha256": identity,
                "title": f"Capture song {number + 1}",
                "artist": "Egress Capture",
                "duration_s": 180.0 + number,
            }
        )
    return songs


def scripted_actions(base: str, songs: int) -> tuple[str, list[dict]]:
    """Sign in, register metadata songs, read the account: a fresh account that no rule grants
    `cloud.hosted_media` (the seeded server has no grant rules for it at all)."""
    stamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    account = f"egress-{stamp}"
    token = f"e2e:{account}"
    steps = [
        call(
            base,
            "POST",
            "/api/onboarding/complete",
            token,
            {"age_confirmed": True, "timezone": "Europe/London"},
        ),
        # The production cutover uses the same USERS rule. This test-only endpoint installs it
        # after onboarding, when the principal has an id.
        call(
            base,
            "POST",
            "/test/flags/off",
            token,
            {"user": account, "flags": ["cloud.hosted_media"]},
        ),
        call(base, "GET", "/api/account", token),
        call(base, "POST", "/api/local-media/songs", token, {"songs": metadata_songs(songs)}),
        call(base, "GET", "/api/account", token),
    ]
    return account, steps


def offending(records: list[dict], max_body: int) -> list[dict]:
    found = []
    for record in records:
        kind = record["request_content_type"].lower()
        if any(kind.startswith(bad) for bad in BAD_TYPES):
            found.append({**record, "why": f"request content type {kind!r}"})
        if record["request_bytes"] > max_body:
            found.append(
                {
                    **record,
                    "why": f"request body of {record['request_bytes']} bytes"
                    f" over the {max_body} byte threshold",
                }
            )
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", required=True, help="directory the run's artifacts go in")
    parser.add_argument("--port", type=int, default=0, help="server port (default: a free one)")
    parser.add_argument("--songs", type=int, default=8, help="metadata songs to register")
    parser.add_argument(
        "--max-body-bytes",
        type=int,
        default=DEFAULT_MAX_BODY,
        help=f"largest acceptable request body (default {DEFAULT_MAX_BODY})",
    )
    options = parser.parse_args()
    out = Path(options.out)
    out.mkdir(parents=True, exist_ok=True)
    port = options.port or free_port()
    base = f"http://127.0.0.1:{port}"

    # The metadata catalogue ships dark. Turn it on at the build layer for this isolated process;
    # the hosted-media grant is still revoked per account through the real rule layer below.
    flags.use("+cloud.local_media")
    print(f"Building the e2e cloud server (fresh database) for {base} ...")
    app = e2e_cloud_server.build(port)
    recorder = RecordingASGI(app, out / "egress-capture.jsonl")
    config = uvicorn.Config(recorder, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    wait_until_up(base)

    print("Running the scripted actions (sign in, register metadata songs, read account) ...")
    account, steps = scripted_actions(base, options.songs)
    time.sleep(1.0)  # let any trailing server-internal callbacks land in the log

    with recorder.lock:
        records = list(recorder.records)
    bad = offending(records, options.max_body_bytes)
    verdict = "PASS" if not bad else "FAIL"
    result = {
        "verdict": verdict,
        "gate": "4 (no audio egress), docs/verification/bf-gate-register.md",
        "ran_at": datetime.now(UTC).isoformat(),
        "account": account,
        "account_has_hosted_grant": False,
        "requests_recorded": len(records),
        "max_body_bytes": options.max_body_bytes,
        "banned_content_types": list(BAD_TYPES),
        "scripted_steps": steps,
        "notes": [
            "Server-internal test-seeding callbacks share the log; they are requests too.",
            "A 404 on /api/local-media/songs means the route is not implemented yet"
            " (BF-0458-03); the egress assertion still holds for what the client sent.",
            "Gate 4 needs two independent runs agreeing, plus the real-browser capture over"
            " import, analysis, play, mix and export.",
        ],
        "offending_requests": bad,
    }
    (out / "egress-capture-result.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )

    server.should_exit = True
    thread.join(timeout=15)

    print(f"{verdict}: {len(records)} requests recorded, {len(bad)} offending.")
    for record in bad:
        print(f"  {record['method']} {record['path']}: {record['why']}")
    print(f"Artifacts: {out / 'egress-capture.jsonl'} and {out / 'egress-capture-result.json'}")
    return 0 if verdict == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
