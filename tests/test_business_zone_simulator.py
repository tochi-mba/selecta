"""A Rooms flood on one zone never makes another zone's seams late (ADR-0443 BZ-0443-10).

The scheduling simulator (`scheduling.simulator`) runs one organisation with three zones on four
slots for an hour: the Bar zone floods with urgent request renders far beyond capacity, while
Terrace and Lounge each need a seam every 90 seconds. Zones take turns inside the account (as
`claims.ClaimSession` does with `policy.zone_fair_order`), so Terrace and Lounge start every
seam before its deadline; only the flooded Bar runs late. Seeded, so the run is the same each
time.
"""

from __future__ import annotations

from selecta.scheduling.policy import Lane
from selecta.scheduling.simulator import AccountSpec, Demand, Scenario, simulate


def _scenario(seed: int) -> Scenario:
    flood = Demand(lane=Lane.INTERACTIVE, rate_per_s=0.5, est_cost_s=20.0, urgency=0,
                   needed_in_s=60.0, zone="bar")
    seams = tuple(
        Demand(lane=Lane.INTERACTIVE, rate_per_s=1 / 90, est_cost_s=20.0, urgency=0,
               needed_in_s=90.0, zone=name)
        for name in ("terrace", "lounge")
    )
    organisation = AccountSpec("org", tier="premium", demand=(flood, *seams))
    neighbour = AccountSpec("someone-else", tier="premium", demand=(Demand(backlog=5),))
    return Scenario(accounts=(organisation, neighbour), slots=4, duration_s=3_600.0, seed=seed)


def test_a_flooded_zone_never_delays_another_zones_seams():
    for seed in (1, 7, 42):
        report = simulate(_scenario(seed))
        assert report.late_by_zone.get("terrace", 0) == 0, (seed, report.late_by_zone)
        assert report.late_by_zone.get("lounge", 0) == 0, (seed, report.late_by_zone)
        assert report.late_by_zone.get("bar", 0) > 0, "the scenario must really flood the bar"
