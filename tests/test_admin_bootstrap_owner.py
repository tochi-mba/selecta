"""The first Owner (doc 07b §2): `selecta admin bootstrap-owner` makes one, once, and says little.

- it finds the account by sign-in email (any case) and prints only the user id;
- it refuses once any Owner exists, for an unknown email, a suspended account and a short reason;
- it audits itself and raises an alert; it revokes the new Owner's other sessions;
- the dev seed makes the seeded account the Owner only when the local database has none.
"""

from __future__ import annotations

import time

import pytest
import sqlalchemy as sa
from typer.testing import CliRunner

from selecta.admin import alerts
from selecta.admin.bootstrap import BootstrapRefused, first_owner
from selecta.admin.schema import platform_alerts
from selecta.authz.check import platform_owners
from selecta.authz.schema import audit_events
from selecta.cli import app
from selecta.identity import accounts
from selecta.identity.tokens import Claims
from selecta.persistence import transaction

REASON = "first Owner for the launch"


def person(engine, name: str) -> str:
    now = time.time()
    claims = Claims(f"subject-{name}", now, now + 60, email=f"{name}@example.test",
                    email_verified=True)
    with transaction(engine) as conn:
        return accounts.provision(conn, claims, age_confirmed=True).user.id


def owners(engine) -> frozenset[str]:
    with transaction(engine) as conn:
        return platform_owners(conn)


def test_the_first_owner_is_made_once_audited_and_alerted(cloud_engine):
    first, second = person(cloud_engine, "first"), person(cloud_engine, "second")
    assert first_owner(cloud_engine, "FIRST@example.test", reason=REASON) == first
    assert owners(cloud_engine) == {first}
    with pytest.raises(BootstrapRefused, match="already exists"):
        first_owner(cloud_engine, "second@example.test", reason=REASON)
    assert owners(cloud_engine) == {first}
    with cloud_engine.connect() as conn:
        actions = set(conn.execute(sa.select(audit_events.c.action)).scalars())
        kinds = set(conn.execute(sa.select(platform_alerts.c.kind)).scalars())
    assert {"role.assigned", "admin.owner.bootstrap"} <= actions
    assert alerts.OWNER_BOOTSTRAPPED in kinds
    assert second not in owners(cloud_engine)


@pytest.mark.parametrize(
    ("email", "reason", "message"),
    [
        ("nobody@example.test", REASON, "No SelectaDJ account"),
        ("not-an-email", REASON, "email address"),
        ("first@example.test", "short", "at least 10"),
    ],
)
def test_bad_requests_are_refused_without_an_owner(cloud_engine, email, reason, message):
    person(cloud_engine, "first")
    with pytest.raises(BootstrapRefused, match=message):
        first_owner(cloud_engine, email, reason=reason)
    assert owners(cloud_engine) == frozenset()


def test_a_suspended_account_cannot_become_the_first_owner(cloud_engine):
    user_id = person(cloud_engine, "first")
    with transaction(cloud_engine) as conn:
        accounts.suspend(conn, user_id, actor_id="test", reason="test")
    with pytest.raises(BootstrapRefused, match="suspended"):
        first_owner(cloud_engine, "first@example.test", reason=REASON)


def test_the_cli_prints_only_the_user_id(cloud_engine, monkeypatch):
    user_id = person(cloud_engine, "first")
    monkeypatch.setenv("SELECTA_DATABASE_URL", cloud_engine.url.render_as_string(False))
    monkeypatch.setattr("selecta.admin.cli.make_engine", lambda _url: cloud_engine)
    monkeypatch.setattr(cloud_engine, "dispose", lambda: None)
    runner = CliRunner()
    done = runner.invoke(app, ["admin", "bootstrap-owner", "--email", "first@example.test",
                               "--reason", REASON])
    assert done.exit_code == 0, done.output
    assert done.stdout.strip() == user_id
    again = runner.invoke(app, ["admin", "bootstrap-owner", "--email", "first@example.test",
                                "--reason", REASON])
    assert again.exit_code == 1
    assert user_id not in again.output


def test_the_dev_seed_makes_its_account_owner_only_when_there_is_none(cloud_engine, monkeypatch):
    from selecta.devstack import guard
    from selecta.devstack.seed import make_local_owner

    monkeypatch.setenv("SELECTA_ENV", "development")
    for name in ("SELECTA_STRIPE_SECRET_KEY", "SELECTA_WORKOS_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    dev, other = person(cloud_engine, "dev"), person(cloud_engine, "other")
    assert make_local_owner(cloud_engine, dev) is True
    assert make_local_owner(cloud_engine, other) is False
    assert owners(cloud_engine) == {dev}
    monkeypatch.setenv("SELECTA_ENV", "production")
    with pytest.raises(guard.DevOnlyError):
        make_local_owner(cloud_engine, other)


def test_local_staff_sign_ins_carry_the_staff_organization(tmp_path):
    import jwt

    from selecta.devstack.identity import IdentityConfig, LocalIdentity
    from selecta.devstack.settings import STAFF_ORGANIZATION_ID

    provider = LocalIdentity(IdentityConfig(folder=tmp_path, base_url="http://127.0.0.1:1",
                                            client_id="c", site_origins=()))
    staff = provider.store.create("s@example.test", "long-password", verified=True)
    customer = provider.store.create("c@example.test", "long-password", verified=True)
    provider.store.mark_staff(staff.id)

    def org(who) -> str | None:
        token = provider.access_token(who, "sid")
        return jwt.decode(token, options={"verify_signature": False}).get("org_id")

    assert org(staff) == STAFF_ORGANIZATION_ID
    assert org(customer) is None


def test_the_cli_needs_a_configured_database(monkeypatch):
    monkeypatch.delenv("SELECTA_DATABASE_URL", raising=False)
    done = CliRunner().invoke(app, ["admin", "bootstrap-owner", "--email", "a@example.test",
                                    "--reason", REASON])
    assert done.exit_code == 2
