"""The kiosk's file URLs (ADR-0446 BZ-0446-04) through the real Cloud app.

A zone plays two uploaded songs joined by a rendered seam. The kiosk's horizon names the seam,
and `POST /api/kiosk/segment-url` signs a short-lived URL for it in the derived bucket (and for
the songs in the originals bucket), only for files in that kiosk's own horizon. The object
store is a recording stand-in for R2.
"""

from __future__ import annotations

import hashlib
import uuid

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, auth
from test_business_kiosk import Player, pair

from selecta import flags
from selecta.billing import stripe_sync
from selecta.business import horizon, orgs, venues, zones
from selecta.identity.schema import users
from selecta.local_media.schema import local_songs
from selecta.persistence import db_now, new_id, transaction
from selecta.playback.schema import playback_sessions
from selecta.routes.business_kiosk import storage_presign
from selecta.storage import api as storage_api
from selecta.storage.keys import derived_key, original_key
from selecta.storage.schema import assets
from selecta.work.schema import artifacts

pytest_plugins = ("cloud_party",)


class Signer:
    def __init__(self) -> None:
        self.signed: list[tuple[str, str, int]] = []

    def presign_get(self, bucket: str, key: str, ttl: int, download_name=None) -> str:
        self.signed.append((bucket, key, ttl))
        return f"https://r2.test/{bucket}/{key}?ttl={ttl}"


@pytest.fixture
def signer(monkeypatch):
    found = Signer()
    monkeypatch.setattr(storage_api, "_r2_client", lambda: found)
    flags.use("+business.orgs +business.kiosk +business.offline")
    yield found
    flags.use(None)


@pytest.fixture
def zone(party, signer):
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
    ws = org["id"]
    with transaction(party.engine, ws) as conn:
        now = db_now(conn)
        place = venues.create(
            conn, ws, name="High Street", timezone="Europe/London", country="GB", now=int(now)
        )
        bar = zones.create(conn, ws, place["id"], name="Bar", now=int(now))
        programme, keys = [], []
        for n in range(2):
            sha = hashlib.sha256(f"song-{n}".encode()).hexdigest()
            asset_id = new_id()
            key = original_key(ws, asset_id)
            conn.execute(
                assets.insert().values(
                    id=asset_id,
                    workspace_id=ws,
                    original_key=key,
                    size=1000,
                    sha256=sha,
                    format="wav",
                    duration_s=200.0,
                    created_at=now,
                )
            )
            song_id = conn.execute(
                local_songs.insert().values(
                    workspace_id=ws,
                    content_sha256=sha,
                    title=f"Song {n}",
                    artist="Band",
                    duration_s=200.0,
                    created_at=now,
                    updated_at=now,
                )
            ).inserted_primary_key[0]
            programme.append({"song_id": song_id, "sha256": sha})
            keys.append(key)
        conn.execute(
            playback_sessions.insert().values(
                workspace_id=ws,
                zone_id=bar["id"],
                state="playing",
                song_index=0,
                offset_ms=0,
                anchor_at=now,
                seq=1,
                fence=0,
                updated_at=now,
                programme=programme,
            )
        )
        digest = horizon.seam_hash(programme[0]["sha256"], programme[1]["sha256"])
        seam_key = derived_key(ws, "seam", digest, str(uuid.uuid4()), "seam.flac")
        conn.execute(
            artifacts.insert().values(
                id=new_id(),
                workspace_id=ws,
                kind="seam",
                input_hash=digest,
                keys=[seam_key],
                checksum="ab" * 32,
                size_bytes=500,
                created_at=now,
                last_used_at=now,
                provenance={
                    "settings": {\n                        "cues": {\n                            "a_source_start": 190.0,\n                            "b_source_end": 8.0,\n                            "seconds": 14.0,\n                        }\n                    }
                },
            )
        )
    yield {"org": ws, "venue": place["id"], "zone": bar["id"], "originals": keys, "seam": seam_key}
    with transaction(party.engine, ws) as conn:
        # a stand-in seam has no worker provenance; it goes before the database checks run
        conn.execute(sa.delete(artifacts).where(artifacts.c.workspace_id == ws))


def test_the_horizon_names_the_seam_and_its_url_is_signed_in_the_derived_bucket(
    party, zone, signer
):
    player = Player(party, "machine-seam-001")
    assert pair(party, zone, player).status_code == 201
    player.collect()
    segments = player.client.get("/api/kiosk/horizon").json()["segments"]
    assert [s["kind"] for s in segments] == ["song", "transition", "song"]
    assert segments[1]["key"] == zone["seam"]
    assert segments[2]["from_s"] == 8.0

    seam = player.client.post("/api/kiosk/segment-url", json={"key": zone["seam"]})
    assert seam.status_code == 200, seam.text
    assert seam.json()["url"].startswith("https://r2.test/")
    song = player.client.post("/api/kiosk/segment-url", json={"key": zone["originals"][0]})
    assert song.status_code == 200
    buckets = [bucket for bucket, _key, _ttl in signer.signed]
    assert buckets == [storage_api.buckets().derived, storage_api.buckets().originals]
    assert all(ttl == 300 for _b, _k, ttl in signer.signed)


def test_a_file_outside_the_kiosks_own_horizon_gets_no_url(party, zone, signer):
    player = Player(party, "machine-seam-002")
    assert pair(party, zone, player).status_code == 201
    player.collect()
    other = derived_key(new_id(), "seam", "ab" * 32, str(uuid.uuid4()), "seam.flac")
    refused = player.client.post("/api/kiosk/segment-url", json={"key": other})
    assert refused.status_code == 404
    assert signer.signed == []
    assert auth(ALICE)


def test_the_signer_refuses_another_workspaces_or_a_staging_key():
    signer = Signer()
    presign = storage_presign(lambda: signer, storage_api.buckets())
    ws = new_id()
    own = derived_key(ws, "seam", "cd" * 32, str(uuid.uuid4()), "seam.flac")
    assert presign(ws, own) is not None
    assert presign(new_id(), own) is None
    assert presign(ws, "staging/whatever") is None


# ---- BZ-0446-09: resync replans from where the kiosk really is


def _session(party, zone):
    with transaction(party.engine, zone["org"]) as conn:
        return (
            conn.execute(
                sa.select(playback_sessions).where(playback_sessions.c.zone_id == zone["zone"])
            )
            .mappings()
            .one()
        )


def test_reconnect_resync_moves_the_zone_to_the_kiosks_position(party, zone, signer):
    player = Player(party, "machine-resync-1")
    assert pair(party, zone, player).status_code == 201
    player.collect()
    assert player.heartbeat().status_code == 200  # the kiosk holds the zone
    answer = player.client.post(
        "/api/kiosk/resync",
        json={"entries": [], "position": {"song_index": 1, "offset_ms": 30_000}},
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["replan"] == {"replanned": True, "song_index": 1}
    session = _session(party, zone)
    assert (session["song_index"], session["offset_ms"]) == (1, 30_000)
    # the horizon now starts from the device's song
    segments = player.client.get("/api/kiosk/horizon").json()["segments"]
    assert segments[0]["song_index"] == 1


def test_reconnect_after_lease_taken_keeps_the_new_speakers_position(party, zone, signer):
    player = Player(party, "machine-resync-2")
    assert pair(party, zone, player).status_code == 201
    player.collect()
    with transaction(party.engine, zone["org"]) as conn:
        conn.execute(
            sa.update(playback_sessions)
            .where(playback_sessions.c.zone_id == zone["zone"])
            .values(active_device_id=None, lease_expires_at=db_now(conn) + 60)
        )
        conn.execute(
            sa.update(playback_sessions)
            .where(playback_sessions.c.zone_id == zone["zone"])
            .values(active_device_id=_other_device(conn, zone["org"]))
        )
    answer = player.client.post(
        "/api/kiosk/resync", json={"entries": [], "position": {"song_index": 1, "offset_ms": 5_000}}
    )
    assert answer.json()["replan"] == {"replanned": False, "reason": "another_speaker"}
    assert _session(party, zone)["song_index"] == 0


def _other_device(conn, workspace_id: str) -> str:
    from selecta.playback.schema import devices

    device_id = new_id()
    now = db_now(conn)
    conn.execute(
        devices.insert().values(
            id=device_id,
            workspace_id=workspace_id,
            user_id=None,
            principal="person",
            name="Staff phone",
            kind="phone",
            capabilities={},
            created_at=now,
            last_seen_at=now,
        )
    )
    return device_id


def test_fallback_hand_offs_and_local_actions_upload_once_into_the_device_log(party, zone, signer):
    from selecta.playback.zone_schema import device_log_entries

    player = Player(party, "machine-resync-3")
    assert pair(party, zone, player).status_code == 201
    player.collect()
    entries = [
        {
            "kind": "offline_fallback",
            "idempotency_key": "fallback:a:1",
            "device_seq": 4,
            "started_at": 1_800_000_000.0,
            "recorded_at": 1_800_000_000.0,
        },
        {
            "kind": "urgent_update",
            "idempotency_key": "urgent-update:2026.12.1",
            "device_seq": 5,
            "started_at": 1_800_000_100.0,
            "recorded_at": 1_800_000_100.0,
        },
        {
            "kind": "play",
            "idempotency_key": "play-1",
            "title": "Song 0",
            "artist": "Band",
            "started_at": 1_800_000_000.0,
            "seconds_played": 120,
            "device_seq": 3,
        },
    ]
    first = player.client.post("/api/kiosk/resync", json={"entries": entries}).json()
    again = player.client.post("/api/kiosk/resync", json={"entries": entries}).json()
    assert (first["log_inserted"], first["inserted"]) == (2, 1)
    assert (again["log_inserted"], again["log_duplicates"], again["duplicates"]) == (0, 2, 1)
    with transaction(party.engine, zone["org"]) as conn:
        rows = (
            conn.execute(sa.select(device_log_entries).order_by(device_log_entries.c.device_seq))
            .mappings()
            .all()
        )
    assert [(r["kind"], r["device_seq"]) for r in rows] == [
        ("offline_fallback", 4),
        ("urgent_update", 5),
    ]
    assert rows[0]["device_time"] == 1_800_000_000.0 and rows[0]["zone_id"] == zone["zone"]
