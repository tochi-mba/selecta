"""Product audit item 4: the plans promise a library soft cap (docs/saas/02-plans-and-economics.md);
the account says how many songs there are against it, and nothing is refused for going past it."""

from __future__ import annotations

from selecta.billing.plans import plan_for
from selecta.local_media.schema import local_songs
from selecta.persistence import transaction
from selecta.usage.meters import library_size


def test_the_library_soft_cap_is_counted_and_never_refuses(cloud_engine):
    with transaction(cloud_engine) as conn:
        for index in range(3):
            conn.execute(local_songs.insert().values(
                workspace_id="ws-cap", content_sha256=f"{index:064d}", title=f"Song {index}",
                artist="Someone", created_at=1_700_000_000.0,
                updated_at=1_700_000_000.0,
            ))
        size = library_size(conn, "ws-cap", plan_for("free"))
    assert size == {"songs": 3, "soft_cap": plan_for("free").library_soft_cap_songs}
