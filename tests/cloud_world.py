"""A signed-up Cloud account over in-memory object storage, for the account, billing-page and
export tests, and for the cloud browser-test server (tests/e2e_cloud_server.py).

`signed_up` builds the real cloud app (fake token check, migrated SQLite, `FakeS3` in place of
R2), onboards the listener and returns what a test needs. `add_asset` stores an accepted original
the way an upload would leave it: the object with its SHA-256, the asset row and the committed
bytes on the quota. `add_playback_file` adds the prepared playback file a worker would make, so
`/playback-proxy` answers "ready" without a worker running.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from cloud_helpers import GOOD_TOKEN, make_cloud_app
from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine
from test_cloud_storage_fakes import FakeS3

from selecta.persistence import db_now, new_id, transaction
from selecta.storage import api as storage_api
from selecta.storage.keys import derived_key, original_key
from selecta.storage.schema import assets
from selecta.usage import quota
from selecta.work import artifacts, proxies
from selecta.work.ports import ArtifactOutput

ORIGINALS = "sel-originals"
DERIVED = "sel-derived"
HEADERS = {"Authorization": f"Bearer {GOOD_TOKEN}", "Origin": "https://app.test"}


class CloudObjects(FakeS3):
    """`FakeS3` as the routes hold it: they close their client when done."""

    def close(self) -> None:
        pass


@dataclass
class World:
    client: TestClient
    engine: Engine
    objects: FakeS3
    workspace_id: str
    user_id: str


def use_fake_storage(monkeypatch, objects: FakeS3) -> None:
    """Point every Cloud storage route at `objects` instead of R2."""
    for name in ("ACCOUNT_ID", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"):
        monkeypatch.setenv(f"SELECTA_R2_{name}", "test")
    monkeypatch.setattr(storage_api, "R2Client", lambda *_args, **_kwargs: objects)


@contextmanager
def signed_up(tmp_path: Path, monkeypatch, *, timezone: str = "UTC") -> Iterator[World]:
    objects = CloudObjects()
    use_fake_storage(monkeypatch, objects)
    app, engine, _verifier = make_cloud_app(tmp_path)
    try:
        with TestClient(app) as client:
            created = client.post(
                "/api/onboarding/complete",
                headers=HEADERS,
                json={"age_confirmed": True, "timezone": timezone},
            )
            assert created.status_code == 201, created.text
            body = created.json()
            yield World(client, engine, objects, body["workspace_id"], body["user_id"])
    finally:
        engine.dispose()


def add_asset(
    engine: Engine,
    objects: FakeS3,
    workspace_id: str,
    content: bytes,
    *,
    name: str = "song.wav",
    sample_rate: int = 44_100,
    duration: float = 10.0,
) -> str:
    """An accepted original, as a finished upload leaves it. Returns the asset id."""
    asset_id = new_id()
    key = original_key(workspace_id, asset_id)
    digest = hashlib.sha256(content).hexdigest()
    objects.put_bytes(ORIGINALS, key, content, sha256=digest)
    with transaction(engine, workspace_id) as conn:
        now = db_now(conn)
        conn.execute(
            assets.insert().values(
                id=asset_id,
                workspace_id=workspace_id,
                original_key=key,
                size=len(content),
                sha256=digest,
                format="wav",
                duration_s=duration,
                sample_rate=sample_rate,
                channels=2,
                created_at=now,
            )
        )
        held = quota.reserve(conn, workspace_id, len(content), f"seed-{asset_id}")
        quota.commit(conn, held.id)
    _name_asset(engine, workspace_id, asset_id, name, len(content))
    return asset_id


def _name_asset(engine: Engine, workspace_id: str, asset_id: str, name: str, size: int) -> None:
    """The library shows an asset's name from its accepted upload session; give it one."""
    from selecta.storage.schema import upload_sessions

    with transaction(engine, workspace_id) as conn:
        now = db_now(conn)
        conn.execute(
            upload_sessions.insert().values(
                id=asset_id,
                workspace_id=workspace_id,
                display_name=name,
                declared_size=size,
                content_type="audio/wav",
                part_size=8 * 1024 * 1024,
                staging_key=f"s/{asset_id}/object",
                status="accepted",
                created_at=now,
                updated_at=now,
                expires_at=now + 86_400,
            )
        )


def add_playback_file(
    engine: Engine, objects: FakeS3, workspace_id: str, asset_id: str, content: bytes
) -> None:
    """The prepared playback file for an asset, as the `play.proxy` worker publishes it."""
    with transaction(engine, workspace_id) as conn:
        row = conn.execute(assets.select().where(assets.c.id == asset_id)).mappings().one()
        provenance, input_hash = proxies.identity(row["sha256"], row["sample_rate"])
        key = derived_key(workspace_id, "playback", input_hash, new_id(), "proxy.flac")
        objects.put_bytes(DERIVED, key, content, sha256=hashlib.sha256(content).hexdigest())
        artifacts.write(
            conn,
            workspace_id,
            new_id(),
            new_id(),
            [
                ArtifactOutput(
                    kind="playback",
                    input_hash=input_hash,
                    keys=[key],
                    checksum=hashlib.sha256(content).hexdigest(),
                    size_bytes=len(content),
                    provenance=provenance,
                )
            ],
            db_now(conn),
        )
