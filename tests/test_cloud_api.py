from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
import sqlalchemy as sa

from selecta.api_cloud import CloudConfigurationError, CloudSettings, create_cloud_app
from selecta.identity.tokens import Claims
from selecta.persistence import make_engine, metadata
from selecta.persistence.migrate import current, downgrade, head, pending_changes, upgrade
from selecta.persistence.registry import load_all_tables


class FakeVerifier:
    def __init__(self) -> None:
        self.claims = Claims(subject="auth0|listener", issued_at=1_000, expires_at=10_000)

    def verify(self, token: str) -> Claims:
        if token != "signed-token":
            from selecta.identity.tokens import BadSignature

            raise BadSignature("bad test token")
        return self.claims


@pytest.fixture
def cloud(tmp_path):
    load_all_tables()
    engine = make_engine(f"sqlite:///{tmp_path / 'cloud.sqlite'}")
    metadata.create_all(engine)
    settings = CloudSettings(
        database_url="sqlite:///test-only",
        workos_client_id="client_test",
        issuer="https://issuer.test",
        audience="selecta-test",
        allowed_hosts=("testserver",),
        allowed_origins=("https://app.test",),
    )
    verifier = FakeVerifier()
    return create_cloud_app(settings, engine=engine, verifier=verifier), engine, verifier


def test_cloud_health_and_readiness_are_explicit(cloud):
    app, engine, _ = cloud
    metadata.drop_all(engine)
    upgrade(engine)
    with TestClient(app) as client:
        assert client.get("/api/status").json() == {
            "service": "selecta", "mode": "cloud", "status": "ok"
        }
        result = client.get("/api/ready")
        assert result.status_code == 200
        assert result.json()["schema"] == head() == current(engine)


def test_account_routes_require_a_verified_bearer_token(cloud):
    app, _, _ = cloud
    with TestClient(app) as client:
        assert client.get("/api/account").status_code == 401
        bad = client.get("/api/account", headers={"Authorization": "Bearer forged"})
        assert bad.status_code == 401
        assert bad.json()["detail"]["code"] == "invalid_session"


def test_onboarding_requires_age_confirmation_and_starts_free_plan(cloud):
    app, _, _ = cloud
    headers = {"Authorization": "Bearer signed-token"}
    with TestClient(app) as client:
        refused = client.post("/api/onboarding/complete", headers=headers, json={"age_confirmed": False})
        assert refused.status_code == 400
        assert refused.json()["detail"]["code"] == "age_confirmation_required"
        created = client.post(
            "/api/onboarding/complete",
            headers=headers,
            json={"age_confirmed": True, "timezone": "Europe/London"},
        )
        assert created.status_code == 201
        assert created.json()["created"] is True
        workspace_id = created.json()["workspace_id"]
        account = client.get(
            "/api/account",
            headers=headers | {"X-Workspace-ID": workspace_id},
        )
        assert account.status_code == 200
        assert account.json()["entitlement"]["plan"] == "free"
        assert account.json()["entitlement"]["storage_limit_bytes"] == 10_000_000_000
        again = client.post(
            "/api/onboarding/complete", headers=headers, json={"age_confirmed": True}
        )
        assert again.status_code == 201
        assert again.json()["created"] is False


def test_sign_out_everywhere_revokes_the_current_token(cloud):
    app, _, _ = cloud
    headers = {"Authorization": "Bearer signed-token"}
    with TestClient(app) as client:
        created = client.post(
            "/api/onboarding/complete", headers=headers, json={"age_confirmed": True}
        ).json()
        headers["X-Workspace-ID"] = created["workspace_id"]
        assert client.post("/api/account/sign-out-everywhere", headers=headers).status_code == 200
        response = client.get("/api/account", headers=headers)
        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "session_revoked"


def test_cloud_settings_refuse_local_or_incomplete_configuration(monkeypatch):
    for key in (
        "SELECTA_DATABASE_URL", "SELECTA_WORKOS_CLIENT_ID", "SELECTA_AUTH_ISSUER",
        "SELECTA_AUTH_AUDIENCE", "SELECTA_ALLOWED_HOSTS", "SELECTA_ALLOWED_ORIGINS",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("SELECTA_DATABASE_URL", "sqlite:///local.sqlite")
    with pytest.raises(CloudConfigurationError, match="PostgreSQL"):
        CloudSettings.from_environment()
    monkeypatch.setenv("SELECTA_DATABASE_URL", "postgresql+psycopg://user:pass@db/selecta")
    with pytest.raises(CloudConfigurationError, match="SELECTA_WORKOS_CLIENT_ID"):
        CloudSettings.from_environment()


def test_cloud_schema_upgrade_and_rollback_preserve_legacy_local_tables(tmp_path):
    load_all_tables()
    engine = make_engine(f"sqlite:///{tmp_path / 'upgrade.sqlite'}")
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE songs (id INTEGER PRIMARY KEY)")
    upgrade(engine)
    assert current(engine) == head()
    assert not pending_changes(engine)
    assert "jobs" in sa.inspect(engine).get_table_names()
    downgrade(engine)
    table_names = set(sa.inspect(engine).get_table_names())
    assert "songs" in table_names
    assert "jobs" not in table_names
