"""A real Selecta Cloud for every cloud browser test in web/e2e-cloud (playwright.cloud.config.ts).

The cloud API runs exactly as in production, with these stand-ins and nothing else changed:

- tokens are checked by `E2EVerifier`: `e2e:<name>` signs in a listener called <name> (the site's
  build swaps AuthKit for web/e2e-cloud/fakeAuthKit.tsx, which sends that token), and the bare
  tokens `alice`, `bob` and `carol` are the three people the Rooms and devices tests use, made at
  start-up (Alice and Bob on Premium, Carol on Free);
- Rooms get a synthetic song library (`FakeSongCatalog`) and planner, since Cloud has no analysed
  library yet, and quiet synthesized audio per song at `/e2e/audio/{index}.wav`;
- WorkOS is absent, so onboarding trusts the token's claims (the test settings don't require it);
- object storage is `E2EObjects`, the in-memory R2 from the storage tests, whose signed URLs
  point back at this server's `/fake-r2/...`, so the browser really uploads parts and fetches
  audio over HTTP, and expired links really answer 403;
- Stripe is `E2EStripe`: Checkout and the portal are small pages on this server, and paying
  updates the entitlement snapshot after a delay, as a webhook would.

The guest page (`/r/{code}`), the display (`/display`) and the test harness that mounts the room
and device panels without AuthKit (`/harness?as=alice`) are served from the same build.

The database is a fresh schema on the test PostgreSQL when `SELECTA_TEST_POSTGRES_URL` is set (as
for the cloud unit tests), else a fresh migrated SQLite file. SQLite works for a short run, but
every open tab's event stream takes the one write lock, so a long run can hit "database is locked".

Test controls live under `/test/...`, outside `/api`, and the built site
(web/dist-cloud-e2e) is served for every other address. Never part of the real app.

At `http://localhost:<port>` (rather than 127.0.0.1) the same server serves the site built with
the real AuthKit library (web/dist-cloud-e2e-authkit), whose sign-in goes to the fake AuthKit in
`e2e_cloud_authkit.py` (the sign-in redirect test, SC-0400-05).

Run: `python tests/e2e_cloud_server.py 8812`.
"""

from __future__ import annotations

import atexit
import hashlib
import io
import itertools
import json
import os
import sys
import threading
import time
from html import escape
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).parent))

import cloud_db  # noqa: E402
import e2e_cloud_authkit  # noqa: E402
import e2e_cloud_flags  # noqa: E402
import e2e_cloud_staff  # noqa: E402
import httpx  # noqa: E402
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import uvicorn  # noqa: E402
from cloud_world import CloudObjects, add_asset, add_playback_file  # noqa: E402
from e2e_home import make_home  # noqa: E402
from fastapi import Body, Request  # noqa: E402
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from test_cloud_rooms_fakes import (  # noqa: E402
    PEPPER,
    FakeNowPlaying,
    FakeRequestPlanner,
    FakeSongCatalog,
)

from selecta.api_cloud import CloudSettings, create_cloud_app  # noqa: E402
from selecta.billing import api as billing_api  # noqa: E402
from selecta.billing import stripe_sync  # noqa: E402
from selecta.billing.plans import plan_for  # noqa: E402
from selecta.identity.tokens import BadSignature, Claims  # noqa: E402
from selecta.persistence import db_now, make_engine, migrate, transaction  # noqa: E402
from selecta.playback.schema import playback_sessions  # noqa: E402
from selecta.rooms.cloud_ports import RoomPorts  # noqa: E402
from selecta.storage import api as storage_api  # noqa: E402
from selecta.usage import allowances, quota  # noqa: E402
from selecta.work import outbox  # noqa: E402

# SELECTA_CLOUD_E2E_DIST names another build folder, so parallel runs never share one.
DIST = ROOT / "web" / os.environ.get("SELECTA_CLOUD_E2E_DIST", "dist-cloud-e2e")
# The same site with the real AuthKit library, served at http://localhost:<port> for the sign-in
# redirect test (e2e_cloud_authkit.py).
DIST_AUTHKIT = DIST.with_name(DIST.name + "-authkit")
# The Rooms and devices tests' people, by bearer token: True is on Premium.
PEOPLE = {"alice": True, "bob": True, "carol": False}
CONSENT = "terms-e2e-2026-11"
PRICES = {
    "price_standard_month": {"plan": "standard", "version": 1, "interval": "month"},
    "price_standard_year": {"plan": "standard", "version": 1, "interval": "year"},
    "price_premium_month": {"plan": "premium", "version": 1, "interval": "month"},
    "price_premium_year": {"plan": "premium", "version": 1, "interval": "year"},
}



def same_server(url: str) -> str:
    """Only the path and query of a return URL, so the fake Stripe pages can only send the
    browser back to this server (the app gives https URLs; this server speaks http)."""
    parts = urlsplit(url)
    path = "/" + parts.path.lstrip("/\\")
    return path + (f"?{parts.query}" if parts.query else "")


def wav(seconds: float, *, tone: float = 220.0, rate: int = 44_100) -> bytes:
    """A short stereo sine, as a real WAV file the server's probe accepts."""
    t = np.arange(int(seconds * rate)) / rate
    left = 0.2 * np.sin(2 * np.pi * tone * t)
    audio = np.stack([left, left], axis=1).astype(np.float32)
    out = io.BytesIO()
    sf.write(out, audio, rate, format="WAV", subtype="PCM_16")
    return out.getvalue()


def playback_flac(source: bytes) -> bytes:
    """Encode the exact decoded source samples as the production 24-bit lossless proxy does."""
    audio, rate = sf.read(io.BytesIO(source), dtype="float32", always_2d=True)
    out = io.BytesIO()
    sf.write(out, audio, rate, format="FLAC", subtype="PCM_24")
    return out.getvalue()


def quiet_song(index: int, seconds: float = 8.0, rate: int = 8000) -> bytes:
    """A soft mono tone, different per song, for the Rooms speaker; the tests run muted anyway."""
    t = np.arange(int(seconds * rate)) / rate
    tone = (800 / 32768) * np.sin(2 * np.pi * 220.0 * (1 + (index % 5) / 4) * t)
    out = io.BytesIO()
    sf.write(out, tone.astype(np.float32), rate, format="WAV", subtype="PCM_16")
    return out.getvalue()


class E2EVerifier:
    """`e2e:<name>` is a valid token for the listener <name>, valid for an hour from now; the
    bare tokens in `PEOPLE` are the Rooms tests' people; and the fake AuthKit's tokens are its
    signed-in people."""

    def __init__(self, authkit: e2e_cloud_authkit.FakeAuthKit | None = None) -> None:
        self.authkit = authkit

    def verify(self, token: str) -> Claims:
        if self.authkit is not None and token in self.authkit.tokens:
            return self.authkit.tokens[token]
        if token in PEOPLE:
            return Claims(
                subject=f"user_{token}",
                issued_at=1_000,
                expires_at=4_000_000_000,
                email=f"{token}@example.test",
                email_verified=True,
            )
        if not token.startswith("e2e:") or len(token) < 5:
            raise BadSignature("not an e2e token")
        # From the staff organization, so a person given a role can enter the admin console.
        return e2e_cloud_staff.claims_for(token[4:])


class E2EObjects(CloudObjects):
    """The storage tests' in-memory R2, with signed URLs this server answers. Each URL carries a
    serial number, so `/test/expire-urls` can make every URL issued so far answer 403."""

    def __init__(self, base: str) -> None:
        super().__init__()
        self.base = base
        self.serial = itertools.count(1)
        self.expired_through = 0
        self.failing_parts: set[int] = set()
        self.log: list[dict] = []
        self.lock = threading.Lock()

    def _url(self, method: str, bucket: str, key: str, ttl: int, extra: str = "") -> str:
        url = f"{self.base}/fake-r2/{bucket}/{key}?{extra}serial={next(self.serial)}&ttl={ttl}"
        self.presigned.append(url)
        return url


def build(port: int):
    base = f"http://127.0.0.1:{port}"
    home = make_home("selecta-cloud-e2e-")
    server = cloud_db.postgres_url()
    if server:
        # A fresh schema and non-superuser role on the test PostgreSQL, so row-level security
        # applies as in production; dropped when the server stops.
        engine, schema = cloud_db.postgres_migrated(server)
        atexit.register(cloud_db.drop_postgres_schema, server, schema)
        url = engine.url.render_as_string(hide_password=False)
    else:
        url = f"sqlite:///{home / 'cloud.sqlite'}"
        engine = make_engine(url)
        migrate.upgrade(engine)

    objects = E2EObjects(base)
    for name in ("ACCOUNT_ID", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"):
        os.environ[f"SELECTA_R2_{name}"] = "e2e"
    storage_api.R2Client = lambda *_args, **_kwargs: objects  # type: ignore[assignment]

    checkouts: dict[str, dict] = {}
    state = {"checkout_delay": 3.0}

    class E2EStripe:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def create_customer(self, **fields):
            return {"id": f"cus_{fields['workspace_id'][:12]}", "object": "customer"}

        def create_checkout_session(self, **fields):
            session_id = f"cs_{len(checkouts) + 1}"
            checkouts[session_id] = fields
            return {"id": session_id, "url": f"{base}/fake-stripe/checkout/{session_id}"}

        def create_portal_session(self, **fields):
            back = fields["return_url"]
            return {"id": "bps_e2e", "url": f"{base}/fake-stripe/portal?back={back}"}

    billing_api.HttpStripeClient = E2EStripe  # type: ignore[assignment,misc]
    os.environ["SELECTA_STRIPE_SECRET_KEY"] = "sk_test_e2e"
    os.environ["SELECTA_STRIPE_PRICES"] = json.dumps(PRICES)
    os.environ["SELECTA_CHECKOUT_CONSENT_VERSION"] = CONSENT

    settings = CloudSettings(
        database_url=url,
        workos_client_id="client_e2e",
        issuer="https://auth.e2e.test",
        audience="selecta-e2e",
        allowed_hosts=("127.0.0.1", "localhost"),
        allowed_origins=(base, f"http://localhost:{port}"),
        staff_organization_id=e2e_cloud_staff.STAFF_ORG,
    )
    ports = RoomPorts(
        pepper=PEPPER,
        catalog=FakeSongCatalog(40),
        planner=FakeRequestPlanner(),
        now_playing=FakeNowPlaying(),
    )
    authkit = e2e_cloud_authkit.FakeAuthKit(f"http://localhost:{port}")
    app = create_cloud_app(
        settings, engine=engine, verifier=E2EVerifier(authkit), room_ports=ports
    )
    with TestClient(app, base_url=base) as client:
        for token, premium in PEOPLE.items():
            made = client.post(
                "/api/onboarding/complete",
                headers={"Authorization": f"Bearer {token}"},
                json={"age_confirmed": True},
            )
            made.raise_for_status()
            if premium:
                with transaction(engine) as conn:
                    stripe_sync.grant_override(
                        conn,
                        workspace_id=made.json()["workspace_id"],
                        plan_id="premium",
                        reason="browser tests",
                        actor="e2e",
                        expires_at=db_now(conn) + 86_400,
                    )
    songs = {index: quiet_song(index) for index in range(6)}
    source_audio: dict[str, bytes] = {}

    def account_of(user: str) -> dict:
        # Legacy Rooms harnesses use bare tokens (e.g. "bob"), while the cloud
        # account tests use e2e:<name>; they represent distinct test principals.
        token = user if user in PEOPLE else f"e2e:{user}"
        answer = httpx.get(f"{base}/api/account", headers={"Authorization": f"Bearer {token}"})
        answer.raise_for_status()
        return answer.json()

    def workspace_of(user: str) -> str:
        return account_of(user)["workspace"]["id"]

    # -- test controls ------------------------------------------------------------------------

    e2e_cloud_staff.install(app, engine)
    e2e_cloud_authkit.install(app, authkit)
    e2e_cloud_flags.install(app, engine, lambda user: account_of(user)["user"]["id"])

    @app.post("/test/seed")
    def seed(body: dict = Body(default={})):  # noqa: B008
        """Sign up `user` and give them `songs` ready-to-play songs of `seconds` each, on
        `plan` (free unless it names a paid plan, given as an expiring override)."""
        user = str(body["user"])
        auth = {"Authorization": f"Bearer e2e:{user}", "Origin": base}
        made = httpx.post(
            f"{base}/api/onboarding/complete",
            headers=auth,
            json={"age_confirmed": True, "timezone": body.get("timezone", "Europe/London")},
        )
        assert made.status_code in (200, 201), made.text
        workspace_id = made.json()["workspace_id"]
        if body.get("plan", "free") != "free":
            with transaction(engine) as conn:
                stripe_sync.grant_override(
                    conn, workspace_id=workspace_id, plan_id=str(body["plan"]),
                    reason="browser tests", actor="e2e", expires_at=db_now(conn) + 86_400,
                )
        ids = []
        for number in range(int(body.get("songs", 0))):
            audio = wav(float(body.get("seconds", 4.0)), tone=220.0 + 40 * number)
            asset_id = add_asset(
                engine, objects, workspace_id, audio, name=f"Song {number + 1}.wav",
                duration=float(body.get("seconds", 4.0)),
            )
            source_audio[asset_id] = audio
            proxy = playback_flac(audio) if body.get("real_proxy") else audio
            add_playback_file(engine, objects, workspace_id, asset_id, proxy)
            ids.append(asset_id)
        return {"workspace_id": workspace_id, "assets": ids}

    @app.get("/test/original-audio/{asset_id}")
    def original_audio(asset_id: str):
        """The uploaded source for the browser alignment check; never installed in production."""
        audio = source_audio.get(asset_id)
        if audio is None:
            return Response(status_code=404)
        return Response(audio, media_type="audio/wav")

    @app.post("/test/quota")
    def set_quota(body: dict = Body(default={})):  # noqa: B008
        workspace_id = workspace_of(str(body["user"]))
        with transaction(engine, workspace_id) as conn:
            usage = quota.set_limit(
                conn, workspace_id, plan_for("free"), limit_bytes=int(body["limit_bytes"])
            )
            outbox.emit(conn, "quota.changed", workspace_id, {"state": usage.state.value},
                        db_now(conn))
        return {"state": usage.state.value, "over_by_bytes": usage.over_by_bytes}

    @app.post("/test/quota-silent")
    def set_quota_silently(body: dict = Body(default={})):  # noqa: B008
        """Change the quota without telling open pages, for the polling fallback test."""
        workspace_id = workspace_of(str(body["user"]))
        with transaction(engine, workspace_id) as conn:
            usage = quota.set_limit(
                conn, workspace_id, plan_for("free"), limit_bytes=int(body["limit_bytes"])
            )
        return {"state": usage.state.value}

    @app.post("/test/usage")
    def use(body: dict = Body(default={})):  # noqa: B008
        workspace_id = workspace_of(str(body["user"]))
        plan = plan_for("free")
        with transaction(engine, workspace_id) as conn:
            for kind, amount in body.get("amounts", {}).items():
                taken = allowances.try_consume(
                    conn, workspace_id, kind, float(amount), allowances.limit_for(plan, kind),
                    timezone=body.get("timezone", "Europe/London"),
                )
                assert taken.ok, kind
        return {"ok": True}

    @app.post("/test/emit")
    def emit(body: dict = Body(default={})):  # noqa: B008
        workspace_id = workspace_of(str(body["user"]))
        with transaction(engine, workspace_id) as conn:
            event_id = outbox.emit(conn, str(body["topic"]), workspace_id, {}, db_now(conn))
        return {"id": event_id}

    @app.post("/test/expire-urls")
    def expire_urls():
        with objects.lock:
            objects.expired_through = next(objects.serial)
        return {"expired_through": objects.expired_through}

    @app.post("/test/expire-lease")
    def expire_lease(body: dict = Body(default={})):  # noqa: B008
        """Let `user`'s speaker lease lapse now, as 20 s without a heartbeat would (SC-0415-04)."""
        workspace_id = workspace_of(str(body["user"]))
        with transaction(engine, workspace_id) as conn:
            conn.execute(
                playback_sessions.update()
                .where(playback_sessions.c.workspace_id == workspace_id)
                .values(lease_expires_at=db_now(conn) - 1)
            )
        return {"ok": True}

    @app.post("/test/reset-playback")
    def reset_playback(body: dict = Body(default={})):  # noqa: B008
        """Forget `user`'s playback session, so a devices test starts from song 1 with no
        speaker, whatever an earlier test or attempt left behind."""
        workspace_id = workspace_of(str(body["user"]))
        with transaction(engine, workspace_id) as conn:
            conn.execute(
                playback_sessions.delete().where(playback_sessions.c.workspace_id == workspace_id)
            )
        return {"ok": True}

    @app.post("/test/r2/fail-parts")
    def fail_parts(body: dict = Body(default={})):  # noqa: B008
        objects.failing_parts = {int(number) for number in body.get("parts", [])}
        return {"failing": sorted(objects.failing_parts)}

    @app.get("/test/r2/log")
    def r2_log():
        return {"requests": objects.log}

    @app.delete("/test/r2/log")
    def clear_log():
        objects.log.clear()
        return {"requests": []}

    @app.post("/test/checkout-delay")
    def checkout_delay(body: dict = Body(default={})):  # noqa: B008
        state["checkout_delay"] = float(body.get("seconds", 3.0))
        return state

    @app.get("/test/wav")
    def test_wav(seconds: float = 60.0):
        return Response(wav(seconds), media_type="audio/wav")

    # -- fake R2 ------------------------------------------------------------------------------

    @app.put("/fake-r2/{bucket}/{key:path}")
    async def r2_put(bucket: str, key: str, request: Request):
        number = int(request.query_params.get("partNumber", "0"))
        upload_id = request.query_params.get("uploadId", "")
        data = await request.body()
        entry = {"method": "PUT", "key": key, "part": number, "time": time.time()}
        if number in objects.failing_parts:
            objects.log.append({**entry, "status": 503})
            return Response(status_code=503)
        part = objects.upload_part(upload_id, number, data=data)
        objects.log.append({**entry, "status": 200})
        return Response(status_code=200, headers={"ETag": part.etag})

    @app.get("/fake-r2/{bucket}/{key:path}")
    def r2_get(bucket: str, key: str, request: Request):
        serial = int(request.query_params.get("serial", "0"))
        entry = {"method": "GET", "key": key, "serial": serial, "time": time.time()}
        if serial <= objects.expired_through:
            objects.log.append({**entry, "status": 403})
            return Response("Request has expired", status_code=403)
        found = objects.objects.get((bucket, key))
        if found is None:
            objects.log.append({**entry, "status": 404})
            return Response(status_code=404)
        data = found.bytes()
        content_type = (
            "audio/flac" if key.endswith(".flac") and data[:4] == b"fLaC" else "audio/wav"
        )
        headers = {"Accept-Ranges": "bytes", "Content-Type": content_type}
        wanted = request.headers.get("range", "")
        if wanted.startswith("bytes="):
            first, _, last = wanted[6:].partition("-")
            start = int(first or 0)
            end = min(len(data) - 1, int(last)) if last else len(data) - 1
            objects.log.append({**entry, "status": 206})
            return Response(
                data[start : end + 1],
                status_code=206,
                headers={**headers, "Content-Range": f"bytes {start}-{end}/{len(data)}"},
            )
        objects.log.append({**entry, "status": 200})
        return Response(data, headers=headers)

    # -- fake Stripe --------------------------------------------------------------------------

    @app.get("/fake-stripe/checkout/{session_id}", response_class=HTMLResponse)
    def checkout_page(session_id: str):
        fields = checkouts[session_id]
        plan = PRICES[fields["price_id"]]["plan"]
        return (
            "<!doctype html><html lang=en><meta charset=utf-8><title>Test checkout</title>"
            f"<main><h1>Test checkout: {escape(plan)}</h1>"
            f"<form method=post action=\"/fake-stripe/checkout/{escape(session_id)}/pay\">"
            "<button>Pay</button></form>"
            f"<a href=\"{escape(same_server(fields['cancel_url']))}\">Cancel</a></main>"
        )

    @app.post("/fake-stripe/checkout/{session_id}/pay")
    def pay(session_id: str):
        fields = checkouts[session_id]
        price = PRICES[fields["price_id"]]
        workspace_id = fields["workspace_id"]

        def webhook():
            with transaction(engine, workspace_id) as conn:
                decision = stripe_sync.SnapshotDecision(
                    plan_id=price["plan"], plan_version=price["version"],
                    source=stripe_sync.SnapshotSource.STRIPE, reason="active",
                    subscription_id=f"sub_{session_id}", valid_until=db_now(conn) + 30 * 86_400,
                )
                stripe_sync.write_snapshot(conn, workspace_id, decision, db_now(conn))
                quota.set_limit(conn, workspace_id, plan_for(price["plan"]))

        threading.Timer(state["checkout_delay"], webhook).start()
        target = same_server(fields["success_url"].replace("{CHECKOUT_SESSION_ID}", session_id))
        return RedirectResponse(target, status_code=303)

    @app.get("/fake-stripe/portal", response_class=HTMLResponse)
    def portal(back: str):
        return (
            "<!doctype html><html lang=en><meta charset=utf-8><title>Test portal</title>"
            "<main><h1>Test billing portal</h1>"
            f"<a href=\"{escape(same_server(back))}\">Return to Selecta</a></main>"
        )

    # -- Rooms audio and pages -----------------------------------------------------------------

    @app.get("/e2e/audio/{index}.wav", include_in_schema=False)
    def room_audio(index: int):
        if index not in songs:
            return Response(status_code=404)
        return Response(songs[index], media_type="audio/wav")

    def page(name: str) -> FileResponse:
        return FileResponse(DIST / name, headers={"Cache-Control": "no-store"})

    @app.get("/r/{code}", include_in_schema=False)
    def guest_page(code: str):
        return page("guest.html")

    @app.get("/display", include_in_schema=False)
    def display_page():
        return page("display.html")

    @app.get("/harness", include_in_schema=False)
    def harness_page():
        return page("cloud-harness.html")

    # -- the built site -----------------------------------------------------------------------

    def built_files(dist: Path) -> dict[str, Path]:
        """Every file of a built site by its URL path, listed once (the build runs first)."""
        if dist not in built_cache:
            built_cache[dist] = {
                file.relative_to(dist).as_posix(): file
                for file in dist.rglob("*") if file.is_file()
            }
        return built_cache[dist]

    built_cache: dict[Path, dict[str, Path]] = {}

    @app.get("/{path:path}", include_in_schema=False)
    def site(path: str, request: Request):
        if path.startswith(("api/", "test/", "fake-", "e2e/")):
            return Response(status_code=404)
        # http://localhost:<port> is the site with the real AuthKit library (the sign-in test).
        dist = DIST_AUTHKIT if request.url.hostname == "localhost" else DIST
        if not (dist / "index.html").is_file():
            return Response("Build the cloud test sites first: pnpm build:cloud-e2e",
                            status_code=503)
        # The request only ever picks from the files the build made; it never becomes a path.
        built = built_files(dist)
        if path in built:
            return FileResponse(built[path])
        return FileResponse(dist / "index.html", headers={"Cache-Control": "no-store"})

    return app


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8812
    if not (DIST / "index.html").is_file():
        sys.exit("Build the cloud test site first: from web/, pnpm build:cloud-e2e")
    app = build(port)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()


__all__ = ["E2EObjects", "E2EVerifier", "build", "hashlib", "wav"]
