"""ADR-0447 BZ-0447-01, -03, -10, -11, -13 and ADR-0449 BZ-0449-05, wired: the Stripe test-mode
catalogue setup, quantity changes charged as they happen, owner downgrades, venue transfers,
Enterprise contracts, billing emails, and the play log written as zones play."""

from __future__ import annotations

import json
from dataclasses import replace
from typing import Any

import httpx
import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_bz_billing_routes import (
    DAY,
    ORG,
    FakeStripe,
    _Principal,
    _Workspace,
    make_org,
    subscribe,
)

from selecta import flags
from selecta.business import (
    billing_contracts,
    billing_emails,
    billing_plan,
    billing_routes,
    billing_transfer,
    crates,
    orgs,
    playlog,
    playlog_writer,
    stripe_business,
    stripe_setup,
    venues,
    zones,
)
from selecta.business.commercial_audit import notices
from selecta.business.commercial_facts import FixedHours, SqlFacts, StaticFacts
from selecta.business.commercial_schema import biz_play_log, biz_venue_billing
from selecta.business.schema import crates as crate_table
from selecta.business.schema import zones as zone_table
from selecta.identity import accounts
from selecta.identity.tokens import Claims
from selecta.local_media.schema import local_songs
from selecta.persistence import transaction
from selecta.playback.model import PlayState, ProgrammeRef, Session
from selecta.playback.zones import ZoneInfo

PRICES = {f"price_{i}": {"item": i, "currency": "GBP", "interval": "month"}
          for i in ("business_venue", "business_extra_zone", "business_extra_seat")}


# --- BZ-0447-01 the test-mode catalogue -------------------------------------------------------


def test_setup_creates_missing_prices_and_the_coupon_once():
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.method == "GET" and request.url.path == "/v1/prices":
            return httpx.Response(200, json={"data": []})
        if request.method == "GET":
            return httpx.Response(404, json={})
        path = request.url.path
        made = "prod_1" if path == "/v1/products" else f"price_{len(seen)}"
        return httpx.Response(200, json={"id": made})

    client = stripe_business.HttpBusinessStripe("sk_test_x", transport=httpx.MockTransport(handle))
    printed = json.loads(stripe_setup.run({}, client))

    assert len(printed) == 18  # 3 items x 3 currencies x 2 intervals
    assert {p["item"] for p in printed.values()} == {"business_venue", "business_extra_zone",
                                                     "business_extra_seat"}
    posts = [r.url.path for r in seen if r.method == "POST"]
    assert posts.count("/v1/products") == 3 and posts.count("/v1/prices") == 18
    assert posts[-1] == "/v1/coupons"
    with pytest.raises(ValueError):
        stripe_setup.run({stripe_business.KEY_ENV: "sk_live_nope"})


# --- BZ-0447-03 and -10 on a bare app ---------------------------------------------------------


@pytest.fixture
def world(sqlite_engine, clock, monkeypatch):
    monkeypatch.setenv("SELECTA_BUSINESS_STRIPE_PRICES", json.dumps(PRICES))
    facts = StaticFacts()
    facts.put(make_org(venues=2))
    fake = FakeStripe()
    app = FastAPI()

    @app.post("/api/business/venues", status_code=201)
    def venue_added():  # stands in for the real route; the hook only reads the answer
        return {"venue": {}}

    billing_routes.install_routes(
        app, engine=sqlite_engine,
        current_claims=lambda: Claims(subject="user-owner", issued_at=0.0, expires_at=9e12),
        principal_for=lambda *_: _Principal(_Workspace(ORG), "owner"),
        stripe_factory=lambda: fake, facts=facts,
        hours=FixedHours(daily={"v0": ("10:00", "23:00"), "v1": ("10:00", "23:00")}),
    )
    flags.use("+business.orgs +business.billing")
    try:
        yield {"http": TestClient(app), "engine": sqlite_engine, "facts": facts, "fake": fake,
               "clock": clock}
    finally:
        flags.use(None)


def test_adding_a_venue_is_charged_at_once_and_prorated(world):
    subscribe(world["engine"], world["clock"].now)
    world["facts"].put(make_org(venues=3))
    world["http"].post("/api/business/venues", headers={"X-Workspace-ID": ORG})

    added = [c for n, c in world["fake"].calls if n == "add_item"]
    venue = next(c for c in added if c["price"] == "price_business_venue")
    assert venue["quantity"] == 3 and venue["proration_behavior"] == "create_prorations"


def test_nothing_is_charged_when_the_flag_is_off(world):
    subscribe(world["engine"], world["clock"].now)
    flags.use("+business.orgs -business.billing")
    world["http"].post("/api/business/venues", headers={"X-Workspace-ID": ORG})
    assert world["fake"].calls == []


def test_a_downgrade_pauses_unpicked_venues_at_close_and_resume_brings_them_back(world):
    engine, clock, http = world["engine"], world["clock"], world["http"]
    subscribe(engine, clock.now)
    clock.advance(4 * 3600)  # 12:00 in London: both venues are open until 23:00
    answer = http.post("/api/business/billing/downgrade", json={"keep_venue_ids": ["v0"]}).json()

    assert [p["venue_id"] for p in answer["pausing"]] == ["v1"]
    summary = http.get("/api/business/billing").json()
    assert summary["quantities"]["business_venue"] == 1
    assert {v["venue_id"]: v["state"] for v in summary["venues"]} == {"v0": "active",
                                                                       "v1": "pausing"}
    org = world["facts"].organisation(None, ORG)
    hours = FixedHours(daily={"v1": ("10:00", "23:00")})
    with transaction(engine) as conn:
        assert billing_plan.apply_due_pauses(conn, org, now=clock.now, hours=hours) == []

    back = http.post("/api/business/billing/venues/v1/resume").json()  # before its close
    assert back == {"venue_id": "v1", "state": "active"}
    assert http.get("/api/business/billing").json()["quantities"]["business_venue"] == 2

    again = http.post("/api/business/billing/downgrade", json={"keep_venue_ids": ["v0"]}).json()
    with transaction(engine) as conn:
        later = again["pausing"][0]["pause_at"] + 1
        assert billing_plan.apply_due_pauses(conn, org, now=later, hours=hours) == ["v1"]
        state = conn.execute(sa.select(biz_venue_billing.c.state).where(
            biz_venue_billing.c.venue_id == "v1")).scalar()
    assert state == "paused"
    assert http.post("/api/business/billing/downgrade",
                     json={"keep_venue_ids": ["nope"]}).status_code == 422


# --- BZ-0447-13 contracts and the billing emails ----------------------------------------------


def test_a_contract_warns_before_it_ends_then_enters_grace(sqlite_engine, monkeypatch):
    monkeypatch.setenv(billing_emails.SALES_ENV, "sales@rex.test")
    org = make_org()
    start = 1_800_000_000.0
    with transaction(sqlite_engine) as conn:
        billing_contracts.record_contract(
            conn, org, term_start=start, term_end=start + 60 * DAY, venues=2, zones=4, seats=6,
            price_minor=500_000, currency="GBP", invoice_terms="net 30", reason="Signed deal",
            actor="staff:1", now=start)
        assert billing_contracts.tick(conn, org, now=start + 29 * DAY) == []
        assert billing_contracts.tick(conn, org, now=start + 31 * DAY) == ["30d"]
        assert billing_contracts.tick(conn, org, now=start + 31 * DAY) == []
        mail = billing_emails.due(conn, start + 31 * DAY)
        assert billing_contracts.tick(conn, org, now=start + 61 * DAY) == ["grace"]
    assert any(m.to == "sales@rex.test" and "Enterprise contract" in m.subject for m in mail)


def test_every_billing_notice_kind_has_plain_words():
    for kind in ("dunning.email.day3", "dunning.read_only", "dunning.stop_warning.24h",
                 "billing.vat.recheck_failed", "contract.expiry.14d"):
        subject, text = billing_emails.words(kind, "Acme Bars", {})
        assert "SelectaDJ" in subject + text and "—" not in subject + text
    assert billing_emails.words("dunning.playback_stopped", "Acme", {}) is None


# --- BZ-0447-11 transfers and BZ-0449-05 the play log, on real organisation rows --------------


def _org(conn, subject: str, name: str) -> tuple[str, str]:
    claims = Claims(subject=subject, issued_at=0.0, expires_at=9e12, email=f"{subject}@x.test",
                    email_verified=True)
    owner = accounts.provision(conn, claims, age_confirmed=True)
    org = orgs.create(conn, owner_user_id=owner.user.id, name=name, now=1_800_000_000)
    return org["id"], owner.user.id


def test_a_venue_moves_with_its_zones_but_the_library_stays(sqlite_engine):
    now = 1_800_000_000
    with transaction(sqlite_engine) as conn:
        source, owner = _org(conn, "src-owner", "Source Bars")
        target, other = _org(conn, "tgt-owner", "Target Pubs")
        venue = venues.create(conn, source, name="Camden", timezone="Europe/London",
                              country="GB", now=now)
        zone = zones.create(conn, source, venue["id"], name="Bar", now=now)
        crate = crates.create(conn, source, name="Camden picks", venue_id=venue["id"], now=now)
        facts = SqlFacts()
        made = billing_transfer.propose(conn, facts.organisation(conn, source),
                                        facts.organisation(conn, target), venue["id"],
                                        actor=owner, now=now)
        with pytest.raises(ValueError):
            billing_transfer.consent(conn, facts.organisation(conn, source), made["id"],
                                     actor=owner, now=now)
        agreed = billing_transfer.consent(conn, facts.organisation(conn, target), made["id"],
                                          actor=other, now=now)
        assert agreed["effective_at"] == now  # no subscription: at once
        assert billing_transfer.complete_due(conn, now=now) == [made["id"]]
        moved_zone = conn.execute(sa.select(zone_table.c.workspace_id).where(
            zone_table.c.id == zone["id"])).scalar()
        kept_crate = conn.execute(sa.select(crate_table.c.workspace_id, crate_table.c.venue_id)
                                  .where(crate_table.c.id == crate["id"])).one()
        assert moved_zone == target
        assert tuple(kept_crate) == (source, None)
        assert [v.id for v in facts.organisation(conn, target).venues] == [venue["id"]]


def test_a_zone_moving_to_the_next_song_writes_the_play_log_once(sqlite_engine):
    now = 1_800_000_000.0
    with transaction(sqlite_engine) as conn:
        org_id, _ = _org(conn, "log-owner", "Log Bars")
        venue = venues.create(conn, org_id, name="Soho", timezone="Europe/London", country="GB",
                              now=int(now))
        song = conn.execute(sa.insert(local_songs).values(
            workspace_id=org_id, content_sha256="a" * 64, title="Golden Hour",
            artist="Sunday Static", album="Dusk", duration_s=200.0, created_at=now,
            updated_at=now)).inserted_primary_key[0]
    zone = ZoneInfo(id="z1", workspace_id=org_id, venue_id=venue["id"], name="Bar")
    before = Session(workspace_id=org_id, mix_revision_id="m1", song_index=0, offset_ms=0,
                     anchor_at=now - 185, state=PlayState.PLAYING, active_device_id="d1",
                     lease_expires_at=now + 30, seq=3, updated_at=now, zone_id="z1",
                     programme=(ProgrammeRef(song, "a" * 64),))
    after = replace(before, song_index=1, anchor_at=now, seq=4)
    try:
        flags.use("+business.orgs +business.licensing")
        with transaction(sqlite_engine) as conn:
            assert playlog_writer.record(conn, zone, before, after, now)
            assert not playlog_writer.record(conn, zone, before, after, now)  # same play
            row = conn.execute(sa.select(biz_play_log)).mappings().one()
        flags.use("+business.orgs -business.licensing")
        with transaction(sqlite_engine) as conn:
            assert not playlog_writer.record(conn, zone, before, replace(after, song_index=2),
                                             now + 5)
    finally:
        flags.use(None)
    assert (row["title"], row["artist"], row["source"]) == ("Golden Hour", "Sunday Static",
                                                            "schedule")
    assert row["seconds_played"] == pytest.approx(185)
    assert playlog.safe_cell(row["title"]) == "Golden Hour"
    assert playlog_writer.ended_play(before, replace(before, seq=9), now) is None
    paused = replace(before, state=PlayState.PAUSED)
    assert playlog_writer.ended_play(paused, after, now) is None


def test_notices_are_recorded_for_dunning_reminders(world):
    subscribe(world["engine"], world["clock"].now, status="past_due",
              past_due_since=world["clock"].now, grace_ends_at=world["clock"].now + 14 * DAY)
    from selecta.business import dunning

    org = world["facts"].organisation(None, ORG)
    with transaction(world["engine"]) as conn:
        dunning.tick(conn, org, now=world["clock"].now, hours=FixedHours())
        kinds = {n["kind"] for n in notices(conn, ORG)}
    assert "dunning.email.day0" in kinds


class ItemStripe(FakeStripe):
    """Keeps item quantities, so a remove then re-add in one period can be seen."""

    def __init__(self) -> None:
        super().__init__()
        self.items: dict[str, dict] = {}

    def get_subscription(self, subscription_id: str) -> dict:
        return {"id": subscription_id, "customer": "cus_1", "currency": "gbp",
                "status": "active", "current_period_start": 1_799_000_000.0,
                "items": {"data": list(self.items.values())}}

    def add_subscription_item(self, subscription_id: str, **kwargs: Any) -> dict:
        self.calls.append(("add_item", kwargs))
        item = {"id": f"si_{kwargs['price']}", "price": {"id": kwargs["price"]},
                "quantity": kwargs["quantity"]}
        self.items[item["id"]] = item
        return item

    def update_subscription_item(self, item_id: str, **kwargs: Any) -> dict:
        self.calls.append(("update_item", kwargs))
        self.items[item_id]["quantity"] = kwargs["quantity"]
        return self.items[item_id]


def test_removing_then_re_adding_in_one_period_is_not_charged_twice(world):
    from selecta.business import billing
    from selecta.business.billing_catalogue import load_price_map

    subscribe(world["engine"], world["clock"].now)
    fake = ItemStripe()
    org = make_org(venues=2)
    with transaction(world["engine"]) as conn:
        for wanted in (2, 1, 2, 3):
            billing.apply_quantities(
                conn, fake, org, price_map=load_price_map(), now=world["clock"].now,
                actor="t", desired={"business_venue": wanted, "business_extra_zone": 0,
                                    "business_extra_seat": 0})
    venue_steps = [(c["quantity"], c["proration_behavior"]) for n, c in fake.calls
                   if n in ("add_item", "update_item")
                   and c.get("price", "si") in ("price_business_venue", "si")]
    assert venue_steps == [(2, "create_prorations"), (1, "none"), (2, "none"),
                           (3, "create_prorations")]
