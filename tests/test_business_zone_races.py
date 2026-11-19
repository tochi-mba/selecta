"""One zone lease per device under contention (ADR-0443 BZ-0443-03), on PostgreSQL.

Twenty threads ask, at the same moment, for one browser to take twenty different zones of one
organisation. Exactly one take-over wins; every other is refused (`DeviceInOtherZone`), and the
database never shows the device as the live speaker of two zones. PostgreSQL only: SQLite
serialises writers, so it cannot show the race. Runs in the CI Postgres shard
(`SELECTA_TEST_POSTGRES_URL`) and is skipped without it.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from test_cloud_playback_fakes import USER, WORKSPACE, follow_clock
from test_cloud_playback_races import _race

from selecta.persistence import transaction
from selecta.playback import devices, zone_session
from selecta.playback.model import DeviceInOtherZone
from selecta.playback.schema import playback_sessions
from selecta.playback.zones import StaticZones, ZoneInfo

ZONES = 20


@pytest.fixture
def engine(postgres_engine, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    return postgres_engine


def test_twenty_parallel_take_overs_leave_one_lease(engine, clock):
    zones = StaticZones()
    for index in range(ZONES):
        zones.add(ZoneInfo(f"zone-{index}", WORKSPACE, "venue-1", f"Zone {index}"))
    phone = devices.register(engine, WORKSPACE, USER, name="Phone", kind="phone").device

    def attempt(index: int):
        try:
            zone_session.zone_take_over(engine, zones, WORKSPACE, f"zone-{index}", phone.id,
                                        user_id=USER)
            return "won"
        except DeviceInOtherZone:
            return "refused"

    results = _race(ZONES, attempt)
    assert results.count("won") == 1 and results.count("refused") == ZONES - 1
    with transaction(engine, WORKSPACE) as conn:
        live = conn.execute(sa.select(sa.func.count()).select_from(playback_sessions).where(
            playback_sessions.c.workspace_id == WORKSPACE,
            playback_sessions.c.active_device_id == phone.id,
            playback_sessions.c.lease_expires_at > clock.now,
        )).scalar()
    assert live == 1
