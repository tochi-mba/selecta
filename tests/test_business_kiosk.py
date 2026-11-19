"""Kiosk players through the real Cloud app (ADR-0445 BZ-0445-01, 02, 03, 08, 09, 11, 13).

A kiosk is a second browser (its own cookie jar) holding a P-256 key made here with
`cryptography`, signing exactly what WebCrypto signs (raw r||s over the prefixed nonce). Alice
owns an organisation with one venue and a Bar zone and pairs players from her own browser.
"""

from __future__ import annotations

import base64
import json

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, BOB, auth
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

from selecta import flags
from selecta.billing import stripe_sync
from selecta.business import health, kiosk, orgs, venues, zones
from selecta.business.schema import zones as zones_table
from selecta.identity.schema import users
from selecta.persistence import db_now, transaction
from selecta.playback.schema import devices
from selecta.playback.zone_schema import (
    device_health,
    device_health_history,
    kiosk_tokens,
    zone_alerts,
)

pytest_plugins = ("cloud_party",)

FORBIDDEN_WORDS = ("bill", "licen", "seat", "pilot", "email", "payment", "audit", "error", "plan")


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


class Player:
    """One kiosk: its own browser and its own device key."""

    def __init__(self, party, machine: str = "machine-one-1234") -> None:
        self.client = party.guest_client()
        self.key = ec.generate_private_key(ec.SECP256R1())
        public = self.key.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        self.public_key = b64(public)
        self.machine = machine
        self.nonce: str | None = None
        self.device_id: str | None = None

    def sign(self, nonce: str) -> str:
        der = self.key.sign(f"{kiosk.SIGNED_PREFIX}{nonce}".encode(), ec.ECDSA(hashes.SHA256()))
        r, s = decode_dss_signature(der)
        return b64(r.to_bytes(32, "big") + s.to_bytes(32, "big"))

    def start(self):
        return self.client.post(
            "/api/kiosk/pairings",
            json={"public_key": self.public_key, "machine_id": self.machine},
        )

    def collect(self):
        answer = self.client.get("/api/kiosk/pairings/status")
        body = answer.json()
        self.nonce = body.get("nonce", self.nonce)
        self.device_id = body.get("device_id", self.device_id)
        return body

    def heartbeat(self, nonce: str | None = None, version: str = "2026.11.1"):
        used = nonce if nonce is not None else (self.nonce or "restart")
        answer = self.client.post(
            "/api/kiosk/heartbeat",
            json={
                "nonce": used,
                "signature": self.sign(used),
                "kiosk_version": version,
                "song_index": 0,
                "offset_ms": 0,
                "state": "playing",
            },
        )
        if answer.status_code == 200:
            self.nonce = answer.json()["nonce"]
        return answer


@pytest.fixture
def on():
    flags.use("+business.orgs +business.kiosk +business.offline")
    yield
    flags.use(None)


@pytest.fixture
def venue(party, on):
    with transaction(party.engine) as conn:
        now = int(db_now(conn))
        alice = conn.execute(
            sa.select(users.c.id).where(users.c.auth_subject == "user_alice")
        ).scalar_one()
        org = orgs.create(conn, owner_user_id=alice, name="Alice bars", now=now)
        stripe_sync.grant_override(
            conn,
            workspace_id=org["id"],
            plan_id="premium",
            reason="test org",
            actor="tests",
            expires_at=db_now(conn) + 86_400,
        )
    with transaction(party.engine, org["id"]) as conn:
        now = int(db_now(conn))
        place = venues.create(
            conn, org["id"], name="High Street", timezone="Europe/London", country="GB", now=now
        )
        bar = zones.create(conn, org["id"], place["id"], name="Bar", now=now)
    return {"org": org["id"], "venue": place["id"], "zone": bar["id"]}


def pair(party, venue, player: Player, **extra):
    started = player.start()
    assert started.status_code == 201, started.text
    code = started.json()["pairing_code"]
    answer = party.client.post(
        "/api/kiosk/pair",
        headers=auth(ALICE, venue["org"]),
        json={"code": code, "zone_id": venue["zone"], **extra},
    )
    return answer


def paired(party, venue, machine: str = "machine-one-1234") -> Player:
    player = Player(party, machine)
    answer = pair(party, venue, player)
    assert answer.status_code == 201, answer.text
    assert player.collect()["state"] == "paired"
    return player


# ---- BZ-0445-02 pairing by code


def test_pairing_code_is_six_characters_hashed_and_single_use(party, venue):
    player = Player(party)
    started = player.start()
    assert started.status_code == 201
    code = started.json()["pairing_code"]
    assert len(code) == 6
    assert started.json()["expires_at"] - started.json()["server_time"] == kiosk.PAIRING_SECONDS
    assert "status_secret" not in started.json()
    with transaction(party.engine) as conn:
        stored = conn.execute(sa.text("SELECT pairing_code_hash FROM kiosk_pairings")).scalar()
    assert stored and code not in stored

    first = party.client.post(
        "/api/kiosk/pair",
        headers=auth(ALICE, venue["org"]),
        json={"code": code, "zone_id": venue["zone"]},
    )
    again = party.client.post(
        "/api/kiosk/pair",
        headers=auth(ALICE, venue["org"]),
        json={"code": code, "zone_id": venue["zone"]},
    )
    assert first.status_code == 201, first.text
    assert again.status_code == 404
    assert again.json()["detail"]["code"] == "no_such_pairing"
    body = player.collect()
    assert body["state"] == "paired" and body["nonce"]
    # the token is handed over once: the pairing cookie is gone, so a second poll learns nothing
    assert player.collect()["state"] == "unknown"


def test_pairing_requests_are_rate_limited_per_address(party, on):
    player = Player(party)
    answers = [player.start().status_code for _ in range(12)]
    assert answers[:10] == [201] * 10
    assert 429 in answers[10:]


def test_a_person_outside_the_organisation_cannot_pair_into_its_zone(party, venue):
    player = Player(party)
    code = player.start().json()["pairing_code"]
    answer = party.client.post(
        "/api/kiosk/pair",
        headers=auth(BOB, venue["org"]),
        json={"code": code, "zone_id": venue["zone"]},
    )
    assert answer.status_code in (403, 404)


def test_a_zone_takes_a_home_and_a_standby_and_refuses_a_third(party, venue):
    home = paired(party, venue, "machine-home-0001")
    standby = paired(party, venue, "machine-standby-1")
    third = pair(party, venue, Player(party, "machine-third-01"))

    assert third.status_code == 409
    assert third.json()["detail"]["code"] == "zone_full"
    with transaction(party.engine, venue["org"]) as conn:
        zone = (
            conn.execute(sa.select(zones_table).where(zones_table.c.id == venue["zone"]))
            .mappings()
            .one()
        )
        kiosks = conn.execute(
            sa.select(devices.c.principal, devices.c.user_id).where(
                devices.c.zone_id == venue["zone"]
            )
        ).all()
    assert zone["home_device_id"] == home.device_id
    assert zone["standby_device_id"] == standby.device_id
    assert all(row.principal == "kiosk" and row.user_id is None for row in kiosks)


# ---- BZ-0445-03 kiosk token and device key


def test_signed_heartbeat_takes_the_zone_and_hands_out_the_next_nonce(party, venue):
    player = paired(party, venue)
    first_nonce = player.nonce
    answer = player.heartbeat()

    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["outcome"] == "took_over"
    assert body["nonce"] != first_nonce
    assert body["session"]["active_device_id"] == player.device_id
    assert body["latest"]["version"] == kiosk.KIOSK_RELEASES[-1][0]


def test_kiosk_token_copied_to_second_machine_is_refused(party, venue):
    player = paired(party, venue)
    thief = Player(party, "machine-thief-01")
    thief.client.cookies.set(
        kiosk.TOKEN_COOKIE, player.client.cookies.get(kiosk.TOKEN_COOKIE), path=kiosk.COOKIE_PATH
    )
    refused = thief.heartbeat(nonce=player.nonce)

    assert refused.status_code == 401
    assert refused.json()["detail"]["code"] == "kiosk_key_mismatch"
    with transaction(party.engine, venue["org"]) as conn:
        alert = (
            conn.execute(sa.select(zone_alerts).where(zone_alerts.c.kind == "key_mismatch"))
            .mappings()
            .one()
        )
    assert alert["status"] == "open" and alert["managers_told_at"] is not None
    # the real player carries on, and its next good heartbeat closes the alert
    assert player.heartbeat().status_code == 200
    with transaction(party.engine, venue["org"]) as conn:
        status = conn.execute(sa.select(zone_alerts.c.status)).scalar_one()
    assert status == "closed"


def test_a_restart_without_the_nonce_gets_the_current_one_and_no_alert(party, venue):
    player = paired(party, venue)
    stale = player.heartbeat(nonce="restart")
    assert stale.status_code == 409
    assert stale.json()["detail"]["nonce"] == player.nonce
    assert player.heartbeat().status_code == 200
    with transaction(party.engine, venue["org"]) as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(zone_alerts)).scalar() == 0


def test_tokens_rotate_after_seven_days(party, venue):
    player = paired(party, venue)
    old = player.client.cookies.get(kiosk.TOKEN_COOKIE)
    with transaction(party.engine, venue["org"]) as conn:
        conn.execute(
            sa.update(kiosk_tokens).values(created_at=db_now(conn) - kiosk.TOKEN_ROTATE_S - 1)
        )
    answer = player.heartbeat()
    assert answer.status_code == 200
    assert player.client.cookies.get(kiosk.TOKEN_COOKIE) != old
    assert player.heartbeat().status_code == 200


def test_cookies_are_httponly_secure_strict_and_scoped_to_the_kiosk_api(party, venue):
    player = Player(party)
    started = player.start()
    header = started.headers["set-cookie"].lower()
    for part in ("httponly", "secure", "samesite=strict", "path=/api/kiosk"):
        assert part in header


# ---- BZ-0445-08 versions


def test_server_accepts_current_and_previous_two_versions_and_fourteen_days_after():
    releases = (("1", 0.0, False), ("2", 100.0, False), ("3", 200.0, False), ("4", 300.0, False))
    day = 86_400.0
    assert kiosk.version_supported("4", 400.0, releases)
    assert kiosk.version_supported("2", 400.0, releases)
    assert kiosk.version_supported("1", 300.0 + 13 * day, releases)
    assert not kiosk.version_supported("1", 300.0 + 15 * day, releases)
    assert not kiosk.version_supported("9", 0.0, releases)
    assert not kiosk.version_supported(None, 0.0, releases)


def test_an_unknown_kiosk_version_is_told_to_update(party, venue):
    player = paired(party, venue)
    answer = player.heartbeat(version="1999.1.1")
    assert answer.status_code == 426
    assert answer.json()["detail"]["code"] == "kiosk_update_required"


# ---- BZ-0445-11 replace, unpair, re-pair


def test_replace_makes_the_new_player_home_and_revokes_the_old_at_once(party, venue):
    old = paired(party, venue, "machine-old-0001")
    assert old.heartbeat().status_code == 200
    new = Player(party, "machine-new-0001")
    answer = pair(party, venue, new, replace_device_id=old.device_id)
    assert answer.status_code == 201, answer.text
    assert answer.json()["role"] == "home"
    new.collect()

    refused = old.heartbeat()
    assert refused.status_code == 401
    assert refused.json()["detail"]["code"] == "kiosk_revoked"
    with transaction(party.engine, venue["org"]) as conn:
        zone = (
            conn.execute(sa.select(zones_table).where(zones_table.c.id == venue["zone"]))
            .mappings()
            .one()
        )
    assert zone["home_device_id"] == new.device_id
    assert new.heartbeat().json()["outcome"] in ("took_over", "renewed")


def test_unpair_revokes_at_once_and_the_player_learns_on_its_next_call(party, venue):
    player = paired(party, venue)
    answer = party.client.delete(
        f"/api/devices/{player.device_id}/kiosk", headers=auth(ALICE, venue["org"])
    )
    assert answer.status_code == 200, answer.text
    assert player.heartbeat().status_code == 401
    assert player.client.get("/api/kiosk/view").status_code == 401
    assert player.client.get("/api/kiosk/horizon").status_code == 401


def test_a_reset_device_pairs_as_new_and_the_old_entry_shows_not_seen_since(party, venue):
    old = paired(party, venue, "machine-same-001")
    old.heartbeat()
    with transaction(party.engine, venue["org"]) as conn:
        conn.execute(
            sa.update(devices)
            .where(devices.c.id == old.device_id)
            .values(last_seen_at=db_now(conn) - 3600)
        )
    reset = paired(party, venue, "machine-reset-01")
    listed = party.client.get("/api/business/kiosks", headers=auth(ALICE, venue["org"])).json()[
        "kiosks"
    ]
    by_id = {item["id"]: item for item in listed}
    assert reset.device_id in by_id and old.device_id in by_id
    assert by_id[old.device_id]["online"] is False
    assert by_id[old.device_id]["not_seen_since"] is not None


def test_pairing_lost_on_a_paired_machine_tells_the_manager(party, venue):
    paired(party, venue, "machine-lost-001")
    Player(party, "machine-lost-001").start()
    with transaction(party.engine, venue["org"]) as conn:
        kinds = [row.kind for row in conn.execute(sa.select(zone_alerts.c.kind))]
    assert "needs_pairing" in kinds


# ---- BZ-0445-01 the kiosk view payload


def test_kiosk_view_carries_only_allowlisted_fields(party, venue):
    player = paired(party, venue)
    view = player.client.get("/api/kiosk/view")
    assert view.status_code == 200, view.text
    body = view.json()
    assert set(body) == set(health.VIEW_FIELDS)
    assert body["zone_name"] == "Bar" and body["venue_name"] == "High Street"
    for name in body:
        assert not any(word in name for word in FORBIDDEN_WORDS), name


def test_one_zones_kiosk_token_cannot_read_another_organisations_zone(party, venue):
    player = paired(party, venue)
    body = player.client.get("/api/kiosk/view").json()
    assert body["zone_name"] == "Bar"
    stranger = Player(party, "machine-strange1")
    assert stranger.client.get("/api/kiosk/view").status_code == 401


# ---- BZ-0445-09 health


def test_health_keeps_the_latest_report_a_five_minute_bucket_and_a_hashed_network(party, venue):
    player = paired(party, venue)
    report = {
        "kiosk_version": "2026.11.1",
        "browser": "Chrome 131",
        "audio_context": "running",
        "autoplay_allowed": True,
        "wake_lock": True,
        "output_dbfs": -18.5,
        "playing_state": "playing",
        "hours_ahead": 3.5,
        "storage_used_bytes": 10,
        "storage_available_bytes": 20,
        "network": "online",
        "clock_offset_ms": 12,
        "restarted_at": None,
        "restart_reason": None,
        "battery": None,
        "stray": "dropped",
    }
    assert player.client.post("/api/kiosk/health", json=report).status_code == 200
    assert (
        player.client.post("/api/kiosk/health", json={**report, "output_dbfs": -80.0}).status_code
        == 200
    )
    with transaction(party.engine, venue["org"]) as conn:
        latest = conn.execute(sa.select(device_health)).mappings().one()
        bucket = conn.execute(sa.select(device_health_history)).mappings().one()
    assert latest["output_dbfs"] == -80.0
    assert latest["hours_ahead"] == 3.5
    assert latest["venue_network_hash"] and "testclient" not in latest["venue_network_hash"]
    assert bucket["reports"] == 2 and bucket["silent_reports"] == 1
    assert bucket["min_output_dbfs"] == -80.0


# ---- ADR-0446 kiosk side: horizon, resync, PIN


def test_horizon_carries_the_bundle_times_and_no_urls(party, venue):
    player = paired(party, venue)
    body = player.client.get("/api/kiosk/horizon").json()
    assert body["valid_until"] - body["issued_at"] == 7 * 86_400
    assert "url" not in str(body.get("segments"))


def test_segment_urls_are_given_only_for_the_zones_own_horizon(party, venue):
    player = paired(party, venue)
    answer = player.client.post("/api/kiosk/segment-url", json={"key": "w/other/a/thing"})
    assert answer.status_code == 404


def test_offline_play_logs_upload_once_on_reconnect(party, venue):
    player = paired(party, venue)
    entries = [
        {
            "kind": "play",
            "idempotency_key": f"k-{n}",
            "title": "Song",
            "artist": "Band",
            "started_at": 1_800_000_000.0 + n * 200,
            "seconds_played": 180,
            "device_seq": n,
        }
        for n in range(3)
    ]
    first = player.client.post("/api/kiosk/resync", json={"entries": entries}).json()
    again = player.client.post("/api/kiosk/resync", json={"entries": entries}).json()
    assert first["inserted"] == 3
    assert again["inserted"] == 0 and again["duplicates"] == 3


def test_staff_pin_is_refused_while_the_venue_has_pins_off(party, venue):
    player = paired(party, venue)
    assert player.client.post("/api/kiosk/pin", json={"pin": "1234"}).json() == {"ok": False}


# ---- BZ-0445-13 the flag


def test_with_the_flag_off_every_kiosk_route_is_refused(party):
    flags.use(None)
    player = Player(party)
    for answer in (
        player.start(),
        player.client.get("/api/kiosk/view"),
        party.client.post(
            "/api/kiosk/pair", headers=auth(ALICE), json={"code": "ABCDEF", "zone_id": "z"}
        ),
    ):
        assert answer.status_code == 403
        assert answer.json()["code"] == "flag_off"


# ---- the kiosk as a business device principal (ADR-0452, guard.device_actor)


def test_a_paired_kiosk_token_resolves_to_its_zone_as_a_device_actor(party, venue):
    from selecta.business.access import BusinessNotFound, guard

    player = paired(party, venue)
    token = player.client.cookies.get(kiosk.TOKEN_COOKIE)
    with transaction(party.engine) as conn:
        actor = guard.device_actor(conn, token=token)
    assert actor.device_id == player.device_id
    assert actor.device_zone_id == venue["zone"]
    assert actor.device_venue_id == venue["venue"]

    party.client.delete(f"/api/devices/{player.device_id}/kiosk", headers=auth(ALICE, venue["org"]))
    with transaction(party.engine) as conn, pytest.raises(BusinessNotFound):
        guard.device_actor(conn, token=token)


# ---- BZ-0445-10 alerts reach managers: the in-app list and the email


def _open_silent_alert(party, venue, player) -> str:
    with transaction(party.engine, venue["org"]) as conn:
        return kiosk.open_alert(
            conn,
            venue["org"],
            venue["zone"],
            player.device_id,
            "silent",
            "digital_silence",
            db_now(conn),
            notify_now=True,
            venue_id=venue["venue"],
        )


def test_managers_see_open_player_alerts_and_can_acknowledge_them(party, venue):
    player = paired(party, venue)
    alert_id = _open_silent_alert(party, venue, player)
    listed = party.client.get(
        f"/api/business/zone-alerts?venue_id={venue['venue']}", headers=auth(ALICE, venue["org"])
    )
    assert listed.status_code == 200, listed.text
    [item] = listed.json()["alerts"]
    assert item["id"] == alert_id and item["kind"] == "silent"
    assert "no music is coming out of SelectaDJ" in item["text"]
    acked = party.client.post(
        f"/api/business/zone-alerts/{alert_id}/acknowledge", headers=auth(ALICE, venue["org"])
    )
    assert acked.status_code == 200
    stranger = party.client.post(
        f"/api/business/zone-alerts/{alert_id}/acknowledge", headers=auth(BOB, venue["org"])
    )
    assert stranger.status_code in (403, 404)


def test_alert_email_goes_to_verified_managers_through_the_mail_path(party, venue, tmp_path):
    from selecta.business import alert_mail
    from selecta.notify.mail import RecordingSender

    player = paired(party, venue)
    with transaction(party.engine) as conn:
        conn.execute(
            sa.update(users)
            .where(users.c.auth_subject == "user_alice")
            .values(email="alice@example.test", email_verified=True)
        )
    alert_id = _open_silent_alert(party, venue, player)
    outgoing = alert_mail.Outgoing()
    notify = alert_mail.collecting_notify(outgoing)
    with transaction(party.engine, venue["org"]) as conn:
        alert = dict(
            conn.execute(sa.select(zone_alerts).where(zone_alerts.c.id == alert_id))
            .mappings()
            .one()
        )
        notify(conn, alert, "managers", db_now(conn))
    recorder = RecordingSender()
    assert alert_mail.send(recorder, outgoing) == 1
    [message] = recorder.sent
    assert message.to == "alice@example.test"
    assert "Bar at High Street" in message.subject
    assert "cannot hear the room" in message.text
    assert message.idempotency_key.startswith(f"zone-alert:{alert_id}:managers")

    # in the dev stack the same email lands in the local inbox, never delivered
    inbox = alert_mail.sender_for({"SELECTA_DEV_DATA": str(tmp_path)})
    assert isinstance(inbox, alert_mail.DevInboxSender)
    inbox.send(message)
    assert [m["subject"] for m in inbox.store.mail()] == [message.subject]
    assert alert_mail.sender_for({}) is None


def test_horizon_bundle_is_signed_with_the_keys_given_at_pairing(party, venue):
    from selecta.business import permits

    player = Player(party, "machine-permit-1")
    assert pair(party, venue, player).status_code == 201
    status = player.client.get("/api/kiosk/pairings/status").json()
    keys = status["permit_keys"]
    assert keys
    signed = player.client.get("/api/kiosk/horizon").json()["offline_bundle"]
    body = permits.verify(signed, keys)
    assert body["permit"]["zone_id"] == venue["zone"]
    assert body["permit"]["device_id"] == status["device_id"]
    tampered = {**signed, "bundle": signed["bundle"].replace(venue["zone"], "another-zone")}
    with pytest.raises(permits.PermitRefused):
        permits.verify(tampered, keys)


# ---- ADR-0446: commands while the kiosk is offline, the permit's stops, the offline flag


def _phone(party, org: str) -> str:
    from cloud_party import made_up

    answer = party.client.post(
        "/api/devices",
        headers=auth(ALICE, org),
        json={"name": "Phone", "kind": "phone", "device_id": made_up()},
    )
    assert answer.status_code == 201, answer.text
    return answer.json()["device"]["id"]


def _press(party, venue, phone: str, command: str, session: dict, args=None):
    return party.client.post(
        f"/api/zones/{venue['zone']}/playback/commands",
        headers=auth(ALICE, venue["org"]),
        json={
            "device_id": phone,
            "command": command,
            "args": args,
            "fence": session["fence"],
            "based_on_seq": session["seq"],
            "idempotency_key": f"k-{command}-{session['seq']}",
        },
    )


def test_a_skip_for_an_unreachable_kiosk_is_refused_at_once_and_never_queued(party, venue):
    from selecta.playback.schema import playback_commands

    player = paired(party, venue)
    session = player.heartbeat().json()["session"]
    phone = _phone(party, venue["org"])
    with transaction(party.engine, venue["org"]) as conn:
        conn.execute(sa.update(playback_sessions_table()).values(lease_expires_at=db_now(conn) - 1))
    refused = _press(party, venue, phone, "skip", session)
    assert refused.status_code == 409, refused.text
    detail = refused.json()["detail"]
    assert detail["code"] == "speaker_offline"
    assert "still playing saved music" in detail["message"]
    with transaction(party.engine, venue["org"]) as conn:
        queued = conn.execute(
            sa.select(sa.func.count())
            .select_from(playback_commands)
            .where(playback_commands.c.command == "skip")
        ).scalar()
    assert queued == 0
    # a state change still applies on the server, and reaches the kiosk when it is back
    volume = _press(party, venue, phone, "set_volume", session, {"volume": 40})
    assert volume.status_code == 200, volume.text


def playback_sessions_table():
    from selecta.playback.schema import playback_sessions

    return playback_sessions


def test_the_permit_carries_a_payment_stop_and_the_earliest_stop_wins(party, venue, monkeypatch):
    from selecta.business import dunning, permits

    player = paired(party, venue)
    monkeypatch.setattr(
        dunning,
        "stop_plan",
        lambda _conn, _org, _hours, now: [
            dunning.VenueStop(venue["venue"], now + 3600, None, None)
        ],
    )
    signed = player.client.get("/api/kiosk/horizon").json()["offline_bundle"]
    keys = [k["public_key"] for k in json.loads(signed["bundle"])["keys"]]
    body = permits.verify(signed, keys)
    permit = body["permit"]
    assert permit["plan_state"] == "grace" and permit["stop_reason"] == "payment"
    assert permit["stop_at"] - permit["issued_at"] == pytest.approx(3600, abs=5)
    assert body["content"]["refused_song_ids"] == []


def test_with_business_offline_off_the_kiosk_gets_three_songs_and_no_permit(party, venue):
    player = paired(party, venue)
    flags.use("+business.orgs +business.kiosk")
    body = player.client.get("/api/kiosk/horizon").json()
    assert body["offline"] is False
    assert "offline_bundle" not in body
    assert len(body["segments"]) <= 3
