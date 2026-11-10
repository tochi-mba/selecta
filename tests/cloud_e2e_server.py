"""The cloud app for the browser tests in web/e2e-cloud: Rooms, guests, displays and devices.

It runs the real cloud API over a fresh SQLite file, with test sign-ins instead of AuthKit:
the bearer tokens `alice`, `bob` and `carol` are three people (Alice and Bob on Premium, Carol on
Free). The song library is synthetic (`FakeSongCatalog`), since the cloud has no analysed
library yet. It also serves the web build made with SELECTA_CLOUD_E2E=1 (the app, the guest page
at /r/{code}, the display at /display and the test harness at /harness) and a few seconds of
quiet synthesized audio per song at /e2e/audio/{index}.wav, so a speaker really plays something.

    python tests/cloud_e2e_server.py 8741

Nothing here touches a real account, a real library or the owner's site.
"""

from __future__ import annotations

import io
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
OUT = WEB / "dist-rooms-e2e"
sys.path.insert(0, str(Path(__file__).parent))

import uvicorn  # noqa: E402
from fastapi import Response  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from test_cloud_rooms_fakes import (  # noqa: E402
    PEPPER,
    FakeNowPlaying,
    FakeRequestPlanner,
    FakeSongCatalog,
)

from selecta.api_cloud import CloudSettings, create_cloud_app  # noqa: E402
from selecta.billing import stripe_sync  # noqa: E402
from selecta.identity.tokens import BadSignature, Claims  # noqa: E402
from selecta.persistence import db_now, make_engine, migrate, transaction  # noqa: E402
from selecta.rooms.cloud_ports import RoomPorts  # noqa: E402

PEOPLE = {"alice": True, "bob": True, "carol": False}  # token: on Premium


class People:
    def verify(self, token: str) -> Claims:
        if token not in PEOPLE:
            raise BadSignature("unknown test token")
        return Claims(
            subject=f"user_{token}",
            issued_at=1_000,
            expires_at=4_000_000_000,
            email=f"{token}@example.test",
            email_verified=True,
        )


def quiet_song(index: int, seconds: float = 8.0, rate: int = 8000) -> bytes:
    """A soft tone, different per song; the browser tests run muted anyway."""
    frames = bytearray()
    pitch = 220.0 * (1 + (index % 5) / 4)
    for n in range(int(seconds * rate)):
        frames += struct.pack("<h", int(800 * math.sin(2 * math.pi * pitch * n / rate)))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(bytes(frames))
    return buffer.getvalue()


def build_web() -> None:
    if os.environ.get("SELECTA_CLOUD_E2E_SKIP_BUILD") == "1" and (OUT / "index.html").exists():
        return
    env = {**os.environ, "SELECTA_CLOUD_E2E": "1"}
    pnpm = shutil.which("pnpm") or "pnpm"
    subprocess.run(
        [pnpm, "exec", "vite", "build", "--outDir", str(OUT), "--emptyOutDir"],
        cwd=WEB,
        env=env,
        check=True,
        stdout=subprocess.DEVNULL,
    )


def make_app(port: int):
    home = Path(tempfile.mkdtemp(prefix="selecta-cloud-e2e-"))
    engine = make_engine(f"sqlite:///{home / 'cloud.sqlite'}")
    migrate.upgrade(engine)
    origin = f"http://127.0.0.1:{port}"
    settings = CloudSettings(
        database_url="sqlite:///e2e",
        workos_client_id="client_e2e",
        issuer="https://issuer.e2e",
        audience="selecta-e2e",
        allowed_hosts=("127.0.0.1", "localhost"),
        allowed_origins=(origin, f"http://localhost:{port}"),
    )
    ports = RoomPorts(
        pepper=PEPPER,
        catalog=FakeSongCatalog(40),
        planner=FakeRequestPlanner(),
        now_playing=FakeNowPlaying(),
    )
    app = create_cloud_app(settings, engine=engine, verifier=People(), room_ports=ports)
    with TestClient(app, base_url=origin) as client:
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

    @app.get("/e2e/audio/{index}.wav", include_in_schema=False)
    def audio(index: int):
        if index not in songs:
            return Response(status_code=404)
        return Response(songs[index], media_type="audio/wav")

    def page(name: str) -> FileResponse:
        return FileResponse(OUT / name, headers={"Cache-Control": "no-store"})

    @app.get("/r/{code}", include_in_schema=False)
    def guest_page(code: str):
        return page("guest.html")

    @app.get("/display", include_in_schema=False)
    def display_page():
        return page("display.html")

    @app.get("/harness", include_in_schema=False)
    def harness_page():
        return page("cloud-harness.html")
    app.mount("/", StaticFiles(directory=OUT, html=True), name="web")
    return app


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8741
    build_web()
    uvicorn.run(make_app(port), host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
