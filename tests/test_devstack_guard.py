"""The local Cloud stack (`dev.cmd cloud`) can never serve anyone but this machine.

Two halves: `guard` refuses to start the stack outside development, and production settings
refuse the local identity provider. These tests try to get past both.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from selecta.devstack import guard
from selecta.devstack.identity import IdentityConfig, create_identity_app
from selecta.devstack.objects import DiskObjects
from selecta.storage.objects import R2Error

DEV = {"SELECTA_ENV": "development"}
SITE = "http://127.0.0.1:5199"


def identity_app(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_ENV", "development")
    monkeypatch.delenv("SELECTA_WORKOS_API_KEY", raising=False)
    return create_identity_app(
        IdentityConfig(
            folder=tmp_path / "identity",
            base_url="http://127.0.0.1:8742",
            client_id="client_test",
            site_origins=(SITE,),
            echo_mail=False,
        )
    )


def test_guard_refuses_production_staging_and_unset():
    for stage in ("production", "staging", ""):
        assert guard.problems({"SELECTA_ENV": stage})
    assert guard.problems(DEV) == []


def test_guard_refuses_non_loopback_bind_and_live_keys():
    for host in ("0.0.0.0", "::", "192.168.1.20", "example.com"):
        assert guard.problems(DEV, host=host)
    assert guard.problems({**DEV, "STRIPE_SECRET_KEY": "sk_live_x"})
    assert guard.problems({**DEV, "SELECTA_WORKOS_API_KEY": "sk_real"})


@pytest.mark.parametrize(
    "value",
    [
        "https://127.0.0.1/",
        "https://localhost:8742/x",
        "http://identity.example.com",
        "https://admin@127.0.0.1/user_management",
        "https://[::1]/user_management",
        "https://localhost./user_management",
        "https://127.1/user_management",
        "https://0.0.0.0:8742/user_management",
    ],
)
def test_production_refuses_local_identity_addresses(value):
    assert guard.production_identity_problem({"SELECTA_AUTH_ISSUER": value})


def test_production_accepts_hosted_https_identity():
    env = {
        "SELECTA_AUTH_ISSUER": "https://api.workos.com/user_management/client_x",
        "SELECTA_WORKOS_API_BASE": "https://api.workos.com",
    }
    assert guard.production_identity_problem(env) is None


def test_production_refuses_local_identity_flag_and_key():
    assert guard.production_identity_problem({"SELECTA_LOCAL_IDENTITY": "1"})
    assert guard.production_identity_problem({"SELECTA_WORKOS_API_KEY": guard.LOCAL_WORKOS_KEY})


def test_identity_refuses_requests_from_other_machines(tmp_path, monkeypatch):
    """Started by hand with `uvicorn --host 0.0.0.0`, it must still answer only this machine."""
    app = identity_app(tmp_path, monkeypatch)
    local = TestClient(app, base_url="http://127.0.0.1:8742", client=("127.0.0.1", 50000))
    assert local.get("/dev/mail.json").status_code == 200
    remote = TestClient(app, base_url="http://127.0.0.1:8742", client=("192.168.1.20", 50000))
    assert remote.get("/dev/mail.json").status_code == 403


def test_identity_refuses_dns_rebinding_hosts(tmp_path, monkeypatch):
    """A page on evil.example rebound to 127.0.0.1 can't read the inbox (reset links)."""
    app = identity_app(tmp_path, monkeypatch)
    client = TestClient(app, base_url="http://evil.example:8742", client=("127.0.0.1", 50000))
    assert client.get("/dev/mail.json").status_code in (400, 403)


def test_identity_app_refuses_outside_development(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_ENV", "production")
    with pytest.raises(guard.DevOnlyError):
        create_identity_app(
            IdentityConfig(
                folder=tmp_path, base_url=SITE, client_id="c", site_origins=(SITE,)
            )
        )


@pytest.mark.parametrize(
    ("bucket", "key"),
    [("b", "D:evil"), ("b", "a/C:evil"), ("D:", "evil"), ("b", "../x"), ("..", "x")],
)
def test_disk_objects_keep_every_key_inside_the_folder(tmp_path, bucket, key):
    store = DiskObjects(tmp_path / "objects", SITE, b"secret")
    with pytest.raises(R2Error):
        store.path(bucket, key)
