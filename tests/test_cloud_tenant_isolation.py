"""Tenant isolation: one account can never read, change or learn about another account's data.

Two people sign up. Alice owns an upload, an asset, a derived file and some events. Bob then
tries every cloud route that can reach a workspace's data, two ways:

- with Alice's workspace named in `X-Workspace-ID`, which must be refused as "no such workspace"
  before anything is read or stored;
- in his own workspace with Alice's ids, which must get exactly the answer a made-up id gets,
  so a refusal never reveals that something exists.

After all that, every row of Alice's is unchanged and the object store was never asked about her
files on Bob's behalf. `test_every_cloud_route_is_classified` makes each new route join this
matrix (or be named as public or as acting only on the caller) before it can ship.
"""

from __future__ import annotations

import dataclasses
import hashlib
import time

import pytest
import sqlalchemy as sa
from cloud_helpers import cloud_settings
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from selecta.api_cloud import create_cloud_app
from selecta.identity.tokens import BadSignature, Claims
from selecta.persistence import db_now, make_engine, metadata, migrate, new_id, transaction
from selecta.storage import api as storage_api
from selecta.storage.keys import derived_key, original_key
from selecta.storage.objects import ObjectHead
from selecta.storage.schema import assets
from selecta.work.schema import outbox_events

ALICE, BOB, BOB_BRIEF = "alice-token", "bob-token", "bob-brief-token"
CONSENT = "terms-2026-11"

# Routes anyone may call: health checks, and webhooks that prove themselves by signature.
PUBLIC = {
    ("GET", "/api/status"),
    ("GET", "/api/ready"),
    ("POST", "/api/webhooks/stripe"),
    ("POST", "/api/webhooks/workos"),
}
# Anonymous routes are isolated by an unguessable guest/display capability cookie rather than a
# signed-in workspace. Their own API suite proves a cookie for one room cannot address another.
CAPABILITY_ONLY = {
    ("POST", "/api/guest/join"),
    ("GET", "/api/guest/rooms/{room_id}"),
    ("GET", "/api/guest/rooms/{room_id}/search"),
    ("POST", "/api/guest/rooms/{room_id}/requests"),
    ("DELETE", "/api/guest/rooms/{room_id}/requests/{request_id}"),
    ("POST", "/api/guest/rooms/{room_id}/requests/{request_id}/vote"),
    ("DELETE", "/api/guest/rooms/{room_id}/requests/{request_id}/vote"),
    ("GET", "/api/guest/rooms/{room_id}/nicknames"),
    ("PUT", "/api/guest/rooms/{room_id}/nickname"),
    ("POST", "/api/guest/rooms/{room_id}/leave"),
    ("POST", "/api/display/pairings"),
    ("GET", "/api/display/view"),
}
# Routes that act only on the signed-in person, whatever workspace a request names.
SELF_ONLY = {
    ("POST", "/api/onboarding/complete"),
    ("POST", "/api/account/sign-out-everywhere"),
    ("DELETE", "/api/account"),
    # Staff only: starts the caller's own admin session and never reads a customer workspace.
    ("POST", "/api/admin/session"),
}
# Staff-console routes never trust a customer workspace header. Every one first requires the
# caller's server-side privileged session; the admin route tests exercise its scoped commands.
STAFF_ONLY = {
    ("GET", "/api/admin/me"),
    ("GET", "/api/admin/overview"),
    ("GET", "/api/admin/jobs"),
    ("GET", "/api/admin/jobs/{job_id}"),
    ("POST", "/api/admin/jobs/{job_id}/{command}"),
    ("GET", "/api/admin/workers"),
    ("POST", "/api/admin/workers/{worker_id}/{command}"),
    ("GET", "/api/admin/accounts"),
    ("GET", "/api/admin/accounts/{user_id}"),
    ("POST", "/api/admin/accounts/{user_id}/{command}"),
    ("POST", "/api/admin/overrides"),
    ("POST", "/api/admin/overrides/mass"),
    ("DELETE", "/api/admin/overrides/{override_id}"),
    ("GET", "/api/admin/ai"),
    ("GET", "/api/admin/security"),
    ("POST", "/api/admin/security/roles"),
    ("GET", "/api/admin/audit"),
    ("PATCH", "/api/admin/audit/{event_id}"),
    ("DELETE", "/api/admin/audit/{event_id}"),
    ("GET", "/api/admin/alerts"),
    ("GET", "/api/admin/actions"),
    ("POST", "/api/admin/actions/{action_id}/{command}"),
    ("GET", "/api/admin/emergency"),
    ("POST", "/api/admin/emergency/{control}/{command}"),
    ("GET", "/api/admin/flags"),
    ("GET", "/api/admin/flags/history"),
    ("POST", "/api/admin/flags/rollback"),
    ("GET", "/api/admin/flags/explain/{user_id}"),
    ("POST", "/api/admin/flags/{flag_id}/impact"),
    ("POST", "/api/admin/flags/{flag_id}/change"),
    ("POST", "/api/admin/flags/{flag_id}/preview"),
    ("GET", "/api/admin/takedowns"),
    ("POST", "/api/admin/takedowns"),
    ("POST", "/api/admin/takedowns/{notice_id}/{command}"),
    ("POST", "/api/admin/upload-restrictions/{workspace_id}/lift"),
    ("POST", "/api/admin/business/pilots"),
}
# Business routes require an organisation workspace and membership, not merely a
# personal library workspace. The dedicated Business tests exercise their tenant
# checks and the flag-guard suite proves they are disabled before rollout.
BUSINESS_SCOPED = {
    ("GET", "/api/business/orgs"),
    ("POST", "/api/business/orgs"),
    ("GET", "/api/business/orgs/{org_id}"),
    ("GET", "/api/business/venues"),
    ("POST", "/api/business/venues"),
    ("GET", "/api/business/venues/{venue_id}"),
    ("PATCH", "/api/business/venues/{venue_id}"),
    ("POST", "/api/business/venues/{venue_id}/archive"),
    ("GET", "/api/business/zones"),
    ("POST", "/api/business/zones"),
    ("PATCH", "/api/business/zones/{zone_id}"),
    ("POST", "/api/business/zones/{zone_id}/archive"),
    ("GET", "/api/business/crates"),
    ("POST", "/api/business/crates"),
    ("GET", "/api/business/crates/{crate_id}"),
    ("PUT", "/api/business/crates/{crate_id}/songs"),
    ("DELETE", "/api/business/crates/{crate_id}"),
    ("GET", "/api/business/venues/{venue_id}/hours"),
    ("PUT", "/api/business/venues/{venue_id}/hours"),
    ("POST", "/api/business/venues/{venue_id}/hour-exceptions"),
    ("DELETE", "/api/business/venues/{venue_id}/hour-exceptions/{exception_id}"),
    ("GET", "/api/business/venues/{venue_id}/holiday-suggestions"),
    ("POST", "/api/business/venues/{venue_id}/stay-open-late"),
    ("POST", "/api/business/venues/{venue_id}/close-now"),
    ("POST", "/api/business/venues/{venue_id}/close-now/{override_id}/undo"),
    ("GET", "/api/business/zones/{zone_id}/state"),
    ("GET", "/api/business/zones/{zone_id}/programme"),
    ("PUT", "/api/business/zones/{zone_id}/programme"),
    ("GET", "/api/business/zones/{zone_id}/offline-manifest"),
    ("POST", "/api/business/zones/{zone_id}/commands"),
    ("PUT", "/api/business/zones/{zone_id}/cache-report"),
    ("GET", "/api/workspaces"),
}

# Every route that can reach a workspace's data, with a body valid enough to get past
# validation, so the refusal we see comes from the workspace check and not from a 422.
SCOPED: dict[tuple[str, str], dict | None] = {
    ("GET", "/api/events"): None,
    ("GET", "/api/account"): None,
    ("GET", "/api/account/labs"): None,
    ("PUT", "/api/account/labs/{flag_id}"): {"enabled": False},
    ("GET", "/api/account/export"): None,
    ("GET", "/api/account/lucy"): None,
    ("PUT", "/api/account/lucy"): {
        "enabled": True,
        "phases": {"chat": True},
        "privacy": {"share_lyrics": False},
    },
    ("POST", "/api/billing/checkout"): {
        "plan": "premium",
        "interval": "month",
        "consent_version": CONSENT,
        "accepted_terms": True,
        "requested_immediate_access": True,
        "acknowledged_cancellation_right": True,
    },
    ("POST", "/api/billing/portal"): {"return_url": "https://app.test/account/billing"},
    ("POST", "/api/uploads/plan"): {"files": [{"name": "song.flac", "size": 10}]},
    ("GET", "/api/uploads"): None,
    ("GET", "/api/uploads/{session_id}"): None,
    ("POST", "/api/uploads/{session_id}/parts"): {"part_numbers": [1]},
    ("POST", "/api/uploads/{session_id}/complete"): None,
    ("DELETE", "/api/uploads/{session_id}"): None,
    ("GET", "/api/assets"): None,
    ("GET", "/api/assets/{asset_id}"): None,
    ("DELETE", "/api/assets/{asset_id}"): None,
    ("GET", "/api/assets/{asset_id}/playback-url"): None,
    ("POST", "/api/assets/{asset_id}/playback-proxy"): None,
    ("GET", "/api/assets/{asset_id}/playback-proxy"): None,
    ("POST", "/api/storage/derived-playback-url"): None,  # body built per test: Alice's key
    ("POST", "/api/devices"): {"name": "Browser", "kind": "laptop"},
    ("GET", "/api/devices"): None,
    ("PATCH", "/api/devices/{device_id}"): {"name": "Kitchen"},
    ("POST", "/api/devices/{device_id}/sign-out"): None,
    ("GET", "/api/playback/session"): None,
    ("POST", "/api/playback/heartbeat"): {
        "device_id": "missing",
        "song_index": 0,
        "offset_ms": 0,
    },
    ("POST", "/api/playback/take-over"): {"device_id": "missing"},
    ("POST", "/api/playback/reconnect"): {"device_id": "missing"},
    ("POST", "/api/playback/commands"): {
        "device_id": "missing",
        "command": "pause",
        "based_on_seq": 0,
        "idempotency_key": "tenant-matrix",
    },
    ("POST", "/api/rooms"): {"name": "Party", "settings": {}},
    ("GET", "/api/rooms/current"): None,
    ("GET", "/api/rooms/{room_id}"): None,
    ("PATCH", "/api/rooms/{room_id}/settings"): {"votes": False},
    ("POST", "/api/rooms/{room_id}/lock"): None,
    ("POST", "/api/rooms/{room_id}/unlock"): None,
    ("POST", "/api/rooms/{room_id}/code"): {"remove_everyone": False},
    ("POST", "/api/rooms/{room_id}/end"): None,
    ("POST", "/api/rooms/{room_id}/requests/{request_id}/approve"): None,
    ("POST", "/api/rooms/{room_id}/requests/{request_id}/pass"): None,
    ("POST", "/api/rooms/{room_id}/guests/{guest_id}/approve"): None,
    ("POST", "/api/rooms/{room_id}/guests/{guest_id}/remove"): None,
    ("POST", "/api/rooms/{room_id}/guests/{guest_id}/ban"): None,
    ("POST", "/api/rooms/{room_id}/displays"): {"pairing_code": "ABC-123"},
    ("DELETE", "/api/rooms/{room_id}/displays"): None,
}
# The scoped routes that name one resource. In his own workspace, Bob asking for Alice's
# resource must get the same answer as asking for one that doesn't exist.
BY_ID = sorted(key for key in SCOPED if "{session_id}" in key[1] or "{asset_id}" in key[1])


class People:
    """Three signed-in tokens: Alice, Bob, and a Bob token about to expire (for event streams)."""

    def __init__(self) -> None:
        def person(name: str, expires_at: float) -> Claims:
            return Claims(
                subject=f"user_{name}",
                issued_at=1_000,
                expires_at=expires_at,
                email=f"{name}@example.test",
                email_verified=True,
            )

        self.claims = {
            ALICE: person("alice", 4_000_000_000),
            BOB: person("bob", 4_000_000_000),
            BOB_BRIEF: person("bob", time.time() + 1.5),
        }

    def verify(self, token: str) -> Claims:
        try:
            return self.claims[token]
        except KeyError:
            raise BadSignature("unknown test token") from None


class Objects:
    """An in-memory object store that remembers every key it was asked about."""

    def __init__(self) -> None:
        self.data: dict[str, bytes] = {}
        self.meta: dict[str, dict[str, str]] = {}
        self.touched: list[str] = []

    def put(self, key: str, content: bytes) -> None:
        self.data[key] = content
        self.meta[key] = {"sha256": hashlib.sha256(content).hexdigest()}

    def create_multipart_upload(self, _bucket, key, **_kwargs):
        self.touched.append(key)
        return "multipart-test"

    def presign_upload_part(self, _bucket, key, _upload_id, part_number, _ttl, **_kwargs):
        self.touched.append(key)
        return f"https://objects.test/{key}/{part_number}"

    def list_parts(self, _bucket, key, _upload_id):
        self.touched.append(key)
        return []

    def abort_multipart_upload(self, _bucket, key, _upload_id):
        self.touched.append(key)

    def head_object(self, _bucket, key):
        self.touched.append(key)
        return ObjectHead(key, len(self.data[key]), "etag", metadata=self.meta[key])

    def presign_get(self, _bucket, key, _ttl, _filename=None):
        self.touched.append(key)
        return f"https://objects.test/{key}?signed"

    def delete_object(self, _bucket, key):
        self.touched.append(key)
        self.data.pop(key, None)


@pytest.fixture
def world(tmp_path, monkeypatch):
    """Alice and Bob signed up; Alice owns an upload, an asset, a derived file and events."""
    objects = Objects()
    for name in ("ACCOUNT_ID", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"):
        monkeypatch.setenv(f"SELECTA_R2_{name}", "test")
    monkeypatch.setattr(storage_api, "R2Client", lambda *_args, **_kwargs: objects)
    monkeypatch.setenv("SELECTA_CHECKOUT_CONSENT_VERSION", CONSENT)
    monkeypatch.delenv("SELECTA_STRIPE_SECRET_KEY", raising=False)

    engine = make_engine(f"sqlite:///{tmp_path / 'cloud.sqlite'}")
    migrate.upgrade(engine)
    app = create_cloud_app(cloud_settings(), engine=engine, verifier=People())
    with TestClient(app) as client:
        workspace = {}
        for token in (ALICE, BOB):
            answer = client.post(
                "/api/onboarding/complete", headers=_auth(token), json={"age_confirmed": True}
            )
            assert answer.status_code == 201, answer.text
            workspace[token] = answer.json()["workspace_id"]
        alice_ws, bob_ws = workspace[ALICE], workspace[BOB]

        planned = client.post(
            "/api/uploads/plan", headers=_auth(ALICE), json=SCOPED[("POST", "/api/uploads/plan")]
        )
        assert planned.status_code == 201, planned.text
        session_id = planned.json()["uploads"][0]["session"]["id"]

        asset_id = new_id()
        song = b"alice's song"
        objects.put(original_key(alice_ws, asset_id), song)
        derived = derived_key(alice_ws, "playback", "a" * 64, new_id(), "proxy.flac")
        objects.put(derived, b"derived audio")
        with transaction(engine, alice_ws) as conn:
            now = db_now(conn)
            conn.execute(
                assets.insert().values(
                    id=asset_id,
                    workspace_id=alice_ws,
                    original_key=original_key(alice_ws, asset_id),
                    size=len(song),
                    sha256=hashlib.sha256(song).hexdigest(),
                    format="flac",
                    duration_s=180.0,
                    sample_rate=44_100,
                    channels=2,
                    created_at=now,
                )
            )
            for owner, topic in ((alice_ws, "alice.secret"), (bob_ws, "bob.own")):
                conn.execute(
                    outbox_events.insert().values(
                        topic=topic, workspace_id=owner, payload={"x": 1}, created_at=now
                    )
                )

        yield {
            "client": client,
            "engine": engine,
            "objects": objects,
            "alice_ws": alice_ws,
            "bob_ws": bob_ws,
            "ids": {
                "session_id": session_id,
                "asset_id": asset_id,
                "flag_id": "lucy",
                "device_id": new_id(),
                "room_id": new_id(),
                "request_id": new_id(),
                "guest_id": new_id(),
            },
            "derived": derived,
            "alice_keys": {original_key(alice_ws, asset_id), derived, f"s/{session_id}/object"},
        }
    engine.dispose()


def _auth(token: str, workspace_id: str | None = None) -> dict[str, str]:
    # Origin as the app sends it, so origin checks pass and the workspace check decides.
    headers = {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": new_id(),
        "Origin": "https://app.test",
    }
    if workspace_id:
        headers["X-Workspace-ID"] = workspace_id
    return headers


def _call(client, method, path, ids, headers, body):
    return client.request(method, path.format(**ids), headers=headers, json=body)


def _body(world, key):
    if key == ("POST", "/api/storage/derived-playback-url"):
        return {"key": world["derived"], "ttl": 60}
    return SCOPED[key]


def _rows_of(engine, workspace_id) -> dict[str, list]:
    """Every row in every tenant table that belongs to this workspace, except the audit log
    (which may rightly record a refused attempt)."""
    found = {}
    with engine.connect() as conn:
        for table in metadata.sorted_tables:
            if "workspace_id" not in table.c or table.name.startswith("audit"):
                continue
            rows = conn.execute(sa.select(table).where(table.c.workspace_id == workspace_id)).all()
            found[table.name] = sorted(map(repr, rows))
    return found


def test_every_cloud_route_is_classified(world):
    routes = {
        (method, route.path)
        for route in world["client"].app.routes
        if isinstance(route, APIRoute) and route.path.startswith("/api")
        for method in route.methods - {"HEAD"}
    }
    classified = PUBLIC | CAPABILITY_ONLY | SELF_ONLY | STAFF_ONLY | BUSINESS_SCOPED | set(SCOPED)
    assert routes - classified == set(), "new routes must join the tenant isolation matrix"
    assert classified - routes == set(), "the matrix names routes that no longer exist"


def test_alice_can_reach_everything_bob_is_refused(world):
    """The positive control: the fixtures are real, so Bob's refusals mean isolation."""
    client, ids = world["client"], world["ids"]
    assert client.get(f"/api/uploads/{ids['session_id']}", headers=_auth(ALICE)).status_code == 200
    assert client.get(f"/api/assets/{ids['asset_id']}", headers=_auth(ALICE)).status_code == 200
    url = client.get(f"/api/assets/{ids['asset_id']}/playback-url", headers=_auth(ALICE))
    assert url.status_code == 200, url.text
    derived = client.post(
        "/api/storage/derived-playback-url",
        headers=_auth(ALICE),
        json={"key": world["derived"], "ttl": 60},
    )
    assert derived.status_code == 200, derived.text


@pytest.mark.parametrize("route", sorted(SCOPED), ids=" ".join)
def test_naming_another_workspace_is_refused_before_anything_happens(world, route):
    method, path = route
    before = _rows_of(world["engine"], world["alice_ws"])
    world["objects"].touched.clear()

    answer = _call(
        world["client"],
        method,
        path,
        world["ids"],
        _auth(BOB, world["alice_ws"]),
        _body(world, route),
    )

    assert answer.status_code == 404, answer.text
    assert answer.json()["detail"]["code"] == "workspace_not_found"
    assert _rows_of(world["engine"], world["alice_ws"]) == before
    assert world["objects"].touched == []


@pytest.mark.parametrize("route", BY_ID, ids=" ".join)
def test_another_accounts_resource_looks_exactly_like_a_missing_one(world, route):
    method, path = route
    client = world["client"]
    before = _rows_of(world["engine"], world["alice_ws"])
    world["objects"].touched.clear()
    body = _body(world, route)

    theirs = _call(client, method, path, world["ids"], _auth(BOB), body)
    made_up = {name: new_id() for name in world["ids"]}
    missing = _call(client, method, path, made_up, _auth(BOB), body)

    assert theirs.status_code == 404, theirs.text
    assert (theirs.status_code, theirs.json()) == (missing.status_code, missing.json())
    assert _rows_of(world["engine"], world["alice_ws"]) == before
    assert not set(world["objects"].touched) & world["alice_keys"]


def test_another_accounts_derived_file_looks_exactly_like_a_missing_one(world):
    client = world["client"]
    theirs = client.post(
        "/api/storage/derived-playback-url",
        headers=_auth(BOB),
        json={"key": world["derived"], "ttl": 60},
    )
    made_up = derived_key(world["alice_ws"], "playback", "b" * 64, new_id(), "proxy.flac")
    missing = client.post(
        "/api/storage/derived-playback-url", headers=_auth(BOB), json={"key": made_up, "ttl": 60}
    )
    assert theirs.status_code == 404
    assert theirs.json() == missing.json()
    assert world["derived"] not in world["objects"].touched


def test_lists_show_only_your_own_things(world):
    client = world["client"]
    uploads = client.get("/api/uploads", headers=_auth(BOB)).json()
    library = client.get("/api/assets", headers=_auth(BOB)).json()
    assert world["ids"]["session_id"] not in repr(uploads)
    assert library["assets"] == []
    alice = client.get("/api/assets", headers=_auth(ALICE)).json()
    assert [item["id"] for item in alice["assets"]] == [world["ids"]["asset_id"]]


def test_the_event_stream_carries_only_your_own_events(world):
    # Start the brief token's clock now: the fixture can take longer than its life on a busy
    # machine, and an already expired stream ends before sending anything.
    people = world["client"].app.state.token_verifier
    people.claims[BOB_BRIEF] = dataclasses.replace(
        people.claims[BOB_BRIEF], expires_at=time.time() + 1.5
    )
    answer = world["client"].get("/api/events", headers=_auth(BOB_BRIEF))
    assert answer.status_code == 200
    assert "bob.own" in answer.text
    assert "alice.secret" not in answer.text


def test_signing_out_everywhere_touches_only_your_own_sessions(world):
    client = world["client"]
    out = client.post("/api/account/sign-out-everywhere", headers=_auth(BOB, world["alice_ws"]))
    assert out.status_code == 200, out.text
    assert client.get("/api/account", headers=_auth(ALICE)).status_code == 200
    assert client.get("/api/account", headers=_auth(BOB)).status_code == 401


def test_deleting_your_account_never_deletes_anyone_elses(world):
    before = _rows_of(world["engine"], world["alice_ws"])
    gone = world["client"].delete("/api/account", headers=_auth(BOB, world["alice_ws"]))
    assert gone.status_code == 202, gone.text
    alice = world["client"].get("/api/account", headers=_auth(ALICE))
    assert alice.status_code == 200
    assert alice.json()["workspace"]["id"] == world["alice_ws"]
    assert _rows_of(world["engine"], world["alice_ws"]) == before


def test_onboarding_twice_never_joins_another_workspace(world):
    again = world["client"].post(
        "/api/onboarding/complete",
        headers=_auth(BOB, world["alice_ws"]),
        json={"age_confirmed": True},
    )
    assert again.status_code in {200, 201}, again.text
    assert again.json()["workspace_id"] == world["bob_ws"]
