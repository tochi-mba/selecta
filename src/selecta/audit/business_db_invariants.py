"""The business invariants the database can show, checked after every Cloud database test
(ADR-0454 BZ-0454-01, gate P3).

`business_invariants.check_trace` judges B1 to B9 over what a run observed (audio spans, leases,
payloads, stops). Three of them also leave rows behind, and those rows are checked here, after
every test that uses the `cloud_engine`, `sqlite_engine` or `postgres_engine` fixtures
(`tests/cloud_db.check_invariants`, next to the ten Cloud invariants):

- **B6** No billing stop without both warnings: every `dunning.playback_stopped` notice for a
  venue has a 72 h and a 24 h stop warning to that venue in the same grace cycle, sent before it.
- **B7** Play log exactly once: no two `biz_play_log` rows share a device and device sequence
  (the idempotency key is already unique by constraint).
- **B8** Offboarding is complete: a member marked removed keeps no workspace membership, venue
  role, staff PIN or signed-in personal device in that organisation.

The others stay trace-only; `business_invariants.NOT_CHECKED_IN_DB` says why for each.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.audit.business_invariants import BusinessInvariantBroken, BusinessViolation

STOP = "dunning.playback_stopped"
WARNINGS = ("dunning.stop_warning.72h", "dunning.stop_warning.24h")


def stops_have_warnings(conn: Connection) -> list[BusinessViolation]:
    from selecta.business.commercial_schema import biz_notices as n

    found: list[BusinessViolation] = []
    stops = conn.execute(sa.select(n.c.organisation_id, n.c.venue_id, n.c.cycle_key,
                                   n.c.created_at).where(n.c.kind == STOP)).all()
    for org, venue, cycle, at in stops:
        for kind in WARNINGS:
            sent = conn.execute(sa.select(sa.func.count()).select_from(n).where(
                n.c.organisation_id == org, n.c.venue_id == venue, n.c.cycle_key == cycle,
                n.c.kind == kind, n.c.created_at <= at)).scalar_one()
            if not sent:
                found.append(BusinessViolation(
                    "B6", f"venue {venue} was stopped in {cycle} without a {kind[-3:]} warning"))
    return found


def play_log_once(conn: Connection) -> list[BusinessViolation]:
    from selecta.business.commercial_schema import biz_play_log as p

    rows = conn.execute(
        sa.select(p.c.device_id, p.c.device_seq, sa.func.count())
        .where(p.c.device_id.is_not(None), p.c.device_seq.is_not(None))
        .group_by(p.c.device_id, p.c.device_seq).having(sa.func.count() > 1)
    ).all()
    return [BusinessViolation("B7", f"device {device} play {seq} is logged {count} times")
            for device, seq, count in rows]


def offboarding_complete(conn: Connection) -> list[BusinessViolation]:
    from selecta.business.people.schema import (
        business_members,
        business_staff_pins,
        business_venue_roles,
    )
    from selecta.identity.schema import workspace_members
    from selecta.playback.schema import devices

    found: list[BusinessViolation] = []
    removed = conn.execute(sa.select(business_members.c.workspace_id, business_members.c.user_id)
                           .where(business_members.c.status == "removed")).all()
    for workspace, user in removed:
        leftovers = {
            "membership": conn.execute(sa.select(sa.func.count()).select_from(workspace_members)
                                       .where(workspace_members.c.workspace_id == workspace,
                                              workspace_members.c.user_id == user)).scalar_one(),
            "venue role": conn.execute(sa.select(sa.func.count()).select_from(
                business_venue_roles).where(business_venue_roles.c.workspace_id == workspace,
                                            business_venue_roles.c.user_id == user)
            ).scalar_one(),
            "staff PIN": conn.execute(sa.select(sa.func.count()).select_from(business_staff_pins)
                                      .where(business_staff_pins.c.workspace_id == workspace,
                                             business_staff_pins.c.user_id == user)).scalar_one(),
            "signed-in device": conn.execute(sa.select(sa.func.count()).select_from(devices).where(
                devices.c.workspace_id == workspace, devices.c.user_id == user,
                devices.c.signed_out_at.is_(None))).scalar_one(),
        }
        for what, count in leftovers.items():
            if count:
                found.append(BusinessViolation(
                    "B8", f"removed member {user} still has a {what} in {workspace}"))
    return found


CHECKS = (stops_have_warnings, play_log_once, offboarding_complete)


def check_db(conn: Connection) -> list[BusinessViolation]:
    found: list[BusinessViolation] = []
    for check in CHECKS:
        found += check(conn)
    return found


def assert_db_clean(engine: Engine) -> None:
    """Raise with every violation, in a system transaction (all workspaces)."""
    from selecta.persistence import transaction

    inspector = sa.inspect(engine)
    if not all(inspector.has_table(t) for t in ("biz_notices", "biz_play_log",
                                                "business_members", "devices")):
        return  # a test database without the business tables has nothing to check
    with transaction(engine) as conn:
        found = check_db(conn)
    if found:
        raise BusinessInvariantBroken("; ".join(str(v) for v in found))
