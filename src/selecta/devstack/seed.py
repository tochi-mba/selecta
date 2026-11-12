"""A ready-made developer account with sample songs, for `dev.cmd cloud --seed`. Dev only.

Makes (once; running it again changes nothing):

- the sign-in `dev@selectadj.test` / `selectadj-dev`, email already verified, in the local
  identity provider;
- its SelectaDJ Cloud account and workspace, onboarded as the site would, with a Premium plan
  granted for 30 days as a staff override (so Rooms and every paid limit can be explored; a new
  sign-up starts on Free to exercise the pretend checkout);
- eight short synthetic songs (generated tones, no real music), stored as accepted uploads in the
  on-disk object store. Their playback files are made by the local worker the first time each is
  played, as in the hosted Cloud.
"""

from __future__ import annotations

import hashlib
import io
import time

import numpy as np
import soundfile as sf
from sqlalchemy import select
from sqlalchemy.engine import Engine

from selecta.billing import plans, stripe_sync
from selecta.devstack import guard
from selecta.devstack.identity_store import IdentityStore
from selecta.devstack.objects import DiskObjects
from selecta.devstack.settings import DevSettings
from selecta.identity import accounts
from selecta.identity.tokens import Claims
from selecta.identity.workos import WorkOSUser
from selecta.persistence import db_now, make_engine, new_id, transaction
from selecta.storage.keys import original_key
from selecta.storage.schema import assets, upload_sessions
from selecta.usage import quota

EMAIL = "dev@selectadj.test"
PASSWORD = "selectadj-dev"
RATE = 44_100
SONGS = (
    ("Lantern Room", "Amber Static", 122.0, 220.0),
    ("Night Bus Home", "Amber Static", 124.0, 246.9),
    ("Warm Concrete", "Field Notes", 118.0, 196.0),
    ("Low Sun", "Field Notes", 120.0, 261.6),
    ("Copper Wire", "Tidal Office", 126.0, 293.7),
    ("Second Wind", "Tidal Office", 128.0, 174.6),
    ("Glasshouse", "Quiet Engines", 110.0, 329.6),
    ("Last Orders", "Quiet Engines", 116.0, 207.7),
)


def synthetic_song(tempo: float, root: float, seconds: float = 24.0) -> bytes:
    """A soft chord with a kick on every beat: real audio for the pipeline, no one's music."""
    t = np.arange(int(seconds * RATE)) / RATE
    chord = sum(0.08 * np.sin(2 * np.pi * root * ratio * t) for ratio in (1.0, 1.25, 1.5))
    beat = 60.0 / tempo
    phase = np.mod(t, beat)
    kick = 0.35 * np.sin(2 * np.pi * (55 + 90 * np.exp(-phase * 30)) * phase) * np.exp(-phase * 9)
    mono = np.clip(chord + kick, -0.95, 0.95)
    fade = np.minimum(1.0, np.minimum(t, seconds - t) / 0.5)
    stereo = np.stack([mono * fade, mono * fade * 0.97], axis=1).astype(np.float32)
    out = io.BytesIO()
    sf.write(out, stereo, RATE, format="WAV", subtype="PCM_16")
    return out.getvalue()


def add_song(
    engine: Engine, objects: DiskObjects, workspace_id: str, name: str, audio: bytes, seconds: float
) -> str:
    asset_id = new_id()
    key = original_key(workspace_id, asset_id)
    digest = hashlib.sha256(audio).hexdigest()
    objects.put_object("sel-originals", key, audio, content_type="audio/wav")
    with transaction(engine, workspace_id) as conn:
        now = db_now(conn)
        conn.execute(
            assets.insert().values(
                id=asset_id, workspace_id=workspace_id, original_key=key, size=len(audio),
                sha256=digest, format="wav", duration_s=seconds, sample_rate=RATE, channels=2,
                created_at=now,
            )
        )
        conn.execute(
            upload_sessions.insert().values(
                id=asset_id, workspace_id=workspace_id, display_name=name,
                declared_size=len(audio), content_type="audio/wav", part_size=8 * 1024 * 1024,
                staging_key=f"s/{asset_id}/object", status="accepted", created_at=now,
                updated_at=now, expires_at=now + 86_400,
            )
        )
        held = quota.reserve(conn, workspace_id, len(audio), f"seed-{asset_id}")
        quota.commit(conn, held.id)
    return asset_id


def seed(settings: DevSettings, *, engine: Engine | None = None) -> dict[str, object]:
    guard.require_development()
    store = IdentityStore(settings.identity_folder)
    person = store.by_email(EMAIL) or store.create(EMAIL, PASSWORD, verified=True)
    if not person.email_verified:
        store.mark_verified(person.id)
    owns = engine is None
    engine = engine or make_engine(settings.database_url)
    try:
        now = time.time()
        claims = Claims(subject=person.id, issued_at=now, expires_at=now + 60)
        identity = WorkOSUser(id=person.id, email=EMAIL, email_verified=True, created_at=now)
        with transaction(engine) as conn:
            made = accounts.provision(
                conn, claims, age_confirmed=True, timezone="Europe/London", identity=identity
            )
            workspace_id = made.workspace.id
            if made.created:
                quota.set_limit(conn, workspace_id, plans.plan_for(plans.DEFAULT_PLAN))
        with transaction(engine, workspace_id) as conn:
            has_songs = conn.execute(
                select(assets.c.id).where(assets.c.workspace_id == workspace_id).limit(1)
            ).first()
            if made.created:
                stripe_sync.grant_override(
                    conn, workspace_id=workspace_id, plan_id="premium",
                    reason="local developer seed", actor="dev.cmd cloud --seed",
                    expires_at=db_now(conn) + 30 * 86_400,
                )
                quota.set_limit(conn, workspace_id, plans.plan_for("premium"))
        added = 0
        if has_songs is None:
            objects = DiskObjects.in_folder(settings.objects, settings.site_url)
            for title, artist, tempo, root in SONGS:
                audio = synthetic_song(tempo, root)
                add_song(engine, objects, workspace_id, f"{artist} - {title}.wav", audio, 24.0)
                added += 1
        return {"email": EMAIL, "password": PASSWORD, "workspace_id": workspace_id,
                "songs_added": added, "created": made.created}
    finally:
        if owns:
            engine.dispose()


__all__ = ["EMAIL", "PASSWORD", "seed", "synthetic_song"]
