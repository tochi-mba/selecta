"""Kiosk horizons with rendered seams (ADR-0446 BZ-0446-01, BZ-0446-11) on the real tables.

Songs are made-up dicts in the shape `health.programme_horizon` gives; seams and analyses are
artifact rows as the `seam.render` and `analyse.song` workers publish them (the seam's cue
points in its provenance, `workers/engine_handlers.render_seam`).
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa

from selecta.business import horizon
from selecta.persistence import db_now, new_id, transaction
from selecta.playback.schema import playback_sessions
from selecta.storage import eviction
from selecta.storage.schema import assets
from selecta.work.schema import artifacts, jobs

WS = "ws-horizon"
T0 = 1_800_000_000.0


@pytest.fixture(autouse=True)
def _clear_made_up_artifacts(sqlite_engine):
    """The rows here stand in for workers' output without their files and full provenance, so
    they go before the database invariants (docs/saas/15-stress-testing.md) are checked."""
    yield
    with transaction(sqlite_engine, WS) as conn:
        conn.execute(sa.delete(artifacts).where(artifacts.c.workspace_id == WS))


def _song(n: int, start: float, duration: float = 200.0) -> dict:
    return {
        "id": f"z:{n}:{n}",
        "key": f"w/{WS}/a/{n}",
        "kind": "song",
        "song_index": n,
        "song_id": n,
        "title": f"Song {n}",
        "artist": "Band",
        "starts_at": start,
        "duration_s": duration,
        "bytes": 1000,
        "sha256": f"{n:064x}",
        "committed": n < 3,
    }


def _artifact(conn, kind: str, input_hash: str, **extra) -> str:
    row_id = new_id()
    conn.execute(
        artifacts.insert().values(
            id=row_id,
            workspace_id=WS,
            kind=kind,
            input_hash=input_hash,
            keys=[f"d/{WS}/{kind}/{input_hash[:8]}/seam.flac"],
            checksum="ab" * 32,
            size_bytes=500,
            provenance=extra.pop("provenance", {}),
            created_at=T0,
            last_used_at=T0,
            **extra,
        )
    )
    return row_id


def _original(conn, n: int) -> None:
    conn.execute(
        assets.insert().values(
            id=new_id(),
            workspace_id=WS,
            original_key=f"w/{WS}/a/{n}",
            size=1000,
            sha256=f"{n:064x}",
            format="wav",
            duration_s=200.0,
            created_at=T0,
        )
    )


def test_a_rendered_seam_cuts_song_a_short_and_starts_song_b_later(sqlite_engine):
    songs = [_song(0, T0), _song(1, T0 + 200)]
    cues = {"a_source_start": 180.0, "b_source_end": 12.0, "seconds": 16.0}
    with transaction(sqlite_engine, WS) as conn:
        _artifact(
            conn,
            "seam",
            horizon.seam_hash(songs[0]["sha256"], songs[1]["sha256"]),
            provenance={"settings": {"cues": cues}},
        )
        spliced = horizon.splice(conn, WS, songs)
    a, seam, b = spliced
    assert (a["starts_at"], a["from_s"], a["duration_s"]) == (T0, 0.0, 180.0)
    assert seam["kind"] == "transition" and seam["starts_at"] == T0 + 180
    assert seam["duration_s"] == 16.0 and seam["key"].endswith("seam.flac")
    assert (b["starts_at"], b["from_s"], b["duration_s"]) == (T0 + 196, 12.0, 188.0)


def test_without_a_rendered_seam_the_songs_meet_back_to_back(sqlite_engine):
    songs = [_song(0, T0), _song(1, T0 + 200)]
    with transaction(sqlite_engine, WS) as conn:
        spliced = horizon.splice(conn, WS, songs)
    assert [s["kind"] for s in spliced] == ["song", "song"]
    assert spliced[1]["starts_at"] == T0 + 200


def test_render_work_carries_zone_and_deadline_and_the_next_two_are_urgent(sqlite_engine):
    songs = [_song(n, T0 + 200 * n) for n in range(5)]
    with transaction(sqlite_engine, WS) as conn:
        for n in range(5):
            _original(conn, n)
            _artifact(conn, "analysis", horizon.analysis_hash(f"{n:064x}"))
        made = horizon.request_seams(conn, WS, "zone-bar", songs, T0)
        again = horizon.request_seams(conn, WS, "zone-bar", songs, T0)
        rows = (
            conn.execute(
                sa.select(jobs).where(jobs.c.type == "seam.render").order_by(jobs.c.needed_by)
            )
            .mappings()
            .all()
        )
    assert made["seams"] == 4 and again["seams"] == 0  # idempotent by seam
    assert [r["input_ref"]["zone_id"] for r in rows] == ["zone-bar"] * 4
    # The job row itself names the zone, so zones take turns in the claim (ADR-0443 BZ-0443-10).
    assert [r["zone_id"] for r in rows] == ["zone-bar"] * 4
    assert [r["needed_by"] for r in rows] == [T0 + 200 * n for n in range(1, 5)]
    assert [r["lane"] for r in rows] == ["interactive", "interactive", "standard", "standard"]
    side = rows[0]["input_ref"]["a"]
    assert side["source_key"] == f"w/{WS}/a/0" and side["analysis_key"]


def test_a_song_without_analysis_gets_analysed_first_and_nothing_past_closing(sqlite_engine):
    songs = [_song(n, T0 + 200 * n) for n in range(4)]
    with transaction(sqlite_engine, WS) as conn:
        for n in range(4):
            _original(conn, n)
        made = horizon.request_seams(conn, WS, "zone-bar", songs, T0, close_at=T0 + 450)
        types = [row.type for row in conn.execute(sa.select(jobs.c.type))]
    # seams heard at +200 and +400 are before the close at +450; the one at +600 is not
    assert made["seams"] == 0 and made["analyses"] == 3
    assert sorted(types) == ["analyse.song"] * 3


def test_eviction_never_removes_a_seam_or_analysis_a_zone_horizon_uses(sqlite_engine):
    shas = [f"{n:064x}" for n in range(3)]
    with transaction(sqlite_engine, WS) as conn:
        now = db_now(conn)
        conn.execute(
            playback_sessions.insert().values(
                workspace_id=WS,
                zone_id="zone-bar",
                state="playing",
                song_index=0,
                offset_ms=0,
                seq=0,
                fence=0,
                updated_at=now,
                programme=[{"song_id": n, "sha256": sha} for n, sha in enumerate(shas)],
            )
        )
        used = _artifact(conn, "seam", horizon.seam_hash(shas[0], shas[1]))
        analysis = _artifact(conn, "analysis", horizon.analysis_hash(shas[2]))
        unrelated = _artifact(conn, "seam", horizon.seam_hash(shas[2], shas[0]))
        protected = eviction.protected_ids(conn, WS)
    assert used in protected and analysis in protected
    assert unrelated not in protected
