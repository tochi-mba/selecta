"""One way to build the cloud app in tests, so every cloud test starts from the same place.

The database is a fresh SQLite file brought to the newest schema by the real migrations, and
tokens are checked by `FakeVerifier` instead of AuthKit: "signed-token" is the only valid one.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from sqlalchemy.engine import Engine

from selecta.api_cloud import CloudSettings, create_cloud_app
from selecta.identity.tokens import BadSignature, Claims
from selecta.persistence import make_engine, migrate

GOOD_TOKEN = "signed-token"


class FakeVerifier:
    """Accepts only `GOOD_TOKEN`, as the listener in `claims`."""

    def __init__(self) -> None:
        self.claims = Claims(
            subject="auth0|listener",
            issued_at=1_000,
            expires_at=10_000,
            email="listener@example.test",
            email_verified=True,
        )

    def verify(self, token: str) -> Claims:
        if token != GOOD_TOKEN:
            raise BadSignature("bad test token")
        return self.claims


def cloud_settings() -> CloudSettings:
    return CloudSettings(
        database_url="sqlite:///test-only",
        workos_client_id="client_test",
        issuer="https://issuer.test",
        audience="selecta-test",
        allowed_hosts=("testserver",),
        allowed_origins=("https://app.test",),
    )


def make_cloud_app(tmp_path: Path) -> tuple[FastAPI, Engine, FakeVerifier]:
    """The cloud app over a migrated SQLite file in `tmp_path`. Dispose the engine when done."""
    engine = make_engine(f"sqlite:///{tmp_path / 'cloud.sqlite'}")
    migrate.upgrade(engine)
    verifier = FakeVerifier()
    return create_cloud_app(cloud_settings(), engine=engine, verifier=verifier), engine, verifier
