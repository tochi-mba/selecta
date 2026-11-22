"""The /business/start pilot contact form (ADR-0453 BZ-0453-04).

`POST /api/business/pilot-interest` emails REX Technologies sales from the signed-in person and
stores nothing; with no sender, no sales address or no verified reply address it says so (503)
instead of pretending. No organisation is ever created here.
"""

from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta.business import start_routes
from selecta.identity.schema import workspaces
from selecta.identity.tokens import Claims
from selecta.notify.mail import RecordingSender
from selecta.persistence import transaction


@dataclass
class _User:
    id: str
    email: str | None
    email_verified: bool = True


@dataclass
class _Principal:
    user: _User


def _client(engine, *, sender, sales="sales@rex.example", verified=True) -> TestClient:
    app = FastAPI()
    start_routes.install_routes(
        app, engine=engine,
        current_claims=lambda: Claims(subject="user-1", issued_at=0.0, expires_at=9e12),
        principal_for=lambda _e, _c, _h: _Principal(_User("user-1", "owner@cafe.example",
                                                          verified)),
        sender=sender, sales=sales,
    )
    return TestClient(app)


BODY = {"business_name": "Harbour Cafe", "venues": 2, "city": "Brighton", "message": "Hi"}


def test_pilot_interest_reaches_sales_and_creates_nothing(sqlite_engine):
    outbox = RecordingSender()
    sent = _client(sqlite_engine, sender=outbox).post("/api/business/pilot-interest", json=BODY)
    assert sent.status_code == 202 and sent.json() == {"sent": True}
    [mail] = outbox.sent
    assert mail.to == "sales@rex.example"
    assert mail.subject == "Pilot interest: Harbour Cafe"
    assert "owner@cafe.example" in mail.text and "Venues: 2" in mail.text
    with transaction(sqlite_engine) as conn:
        assert conn.execute(sa.select(workspaces).where(
            workspaces.c.kind == "business")).first() is None


def test_without_a_way_to_send_it_says_so(sqlite_engine):
    for client in (_client(sqlite_engine, sender=None),
                   _client(sqlite_engine, sender=RecordingSender(), sales=""),
                   _client(sqlite_engine, sender=RecordingSender(), verified=False)):
        refused = client.post("/api/business/pilot-interest", json=BODY)
        assert refused.status_code == 503
        assert refused.json()["detail"]["code"] == "contact_unavailable"
