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


HOSTED_MEDIA = "cloud.hosted_media"


def grant_hosted_media(engine: Engine, app: FastAPI | None = None, *before) -> None:
    """Grant `cloud.hosted_media` to every account, as staff would (ADR-0455).

    Hosted media is a grant (`rules_default: false`): with no rule it is off, and uploads and
    hosted jobs with it. Tests of the hosted pages call this first. `before` are rules placed
    ahead of the grant (a USERS rule that revokes it for one account, say). Pass the running
    `app` so its rule cache reads the grant at once."""
    from selecta.flags import rules as flag_rules
    from selecta.flags.matching import Rule, RuleKind
    from selecta.persistence import transaction

    grant = Rule(RuleKind.PERCENTAGE, {"percent": 100, "salt": "tests", "note": "hosted tests"})
    with transaction(engine) as conn:
        flag_rules.save(
            conn, HOSTED_MEDIA, (*before, grant), author="tests", reason="hosted media granted"
        )
    if app is not None:
        app.state.flag_rules.invalidate()
