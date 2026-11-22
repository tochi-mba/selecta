"""Zones of one organisation take turns for render work (ADR-0443 BZ-0443-10).

`policy.zone_fair_order` keeps urgency first, then lets each zone's next job go in turn (each
zone's own jobs keep deadline, line and age order). A flood of work for one zone (a Rooms rush)
waits behind the next job of every other zone. The claim uses it inside an account, and deadline
boosts count per zone. Accounts without zones keep the plain order.
"""

from __future__ import annotations

from dataclasses import dataclass

from test_cloud_jobs_support import make_store, worker

from selecta.scheduling import policy
from selecta.work.enqueue import JobSpec


@dataclass
class _Row:
    name: str
    urgency: int
    needed_by: float | None
    line_position: int | None
    created_at: float
    zone_id: str | None


def test_zones_take_turns_within_an_urgency():
    flood = [_Row(f"a{i}", 1, 100.0 + i, None, i, "bar") for i in range(5)]
    other = [_Row("b0", 1, 500.0, None, 9, "terrace")]
    urgent = [_Row("u", 0, None, None, 20, "bar")]
    order = [r.name for r in policy.zone_fair_order(flood + other + urgent)]
    assert order == ["u", "a0", "b0", "a1", "a2", "a3", "a4"]


def test_an_account_without_zones_keeps_the_plain_order():
    rows = [_Row(f"j{i}", 2, None, 5 - i, i, None) for i in range(5)]
    plain = sorted(rows, key=lambda r: policy.job_key(r.urgency, r.needed_by,
                                                      r.line_position, r.created_at))
    assert policy.zone_fair_order(rows) == plain


def test_the_claim_lets_another_zone_in_ahead_of_a_flood(cloud_engine):
    store = make_store(cloud_engine)
    for _ in range(4):
        store.enqueue(JobSpec("org-1", "analyse.song", zone_id="zone-bar"))
    store.enqueue(JobSpec("org-1", "analyse.song", zone_id="zone-terrace"))
    claimed = []
    for _ in range(3):
        claim = store.claim("cpu-heavy", worker())
        claimed.append(claim.job.id)
        store.complete(claim.attempt_id, claim.fencing_token, cost_s=1.0)
    import sqlalchemy as sa

    from selecta.persistence import transaction
    from selecta.work.schema import jobs

    with transaction(cloud_engine) as conn:
        zones = dict(conn.execute(sa.select(jobs.c.id, jobs.c.zone_id)).all())
    assert [zones[job_id] for job_id in claimed] == ["zone-bar", "zone-terrace", "zone-bar"]
