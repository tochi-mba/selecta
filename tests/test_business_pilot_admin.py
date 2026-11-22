"""Pilot administration in the staff console (ADR-0452 BZ-0452-13, ADR-0453 S8).

Staff holding `business.pilots.create` list pilots and extend, change, convert or end one,
each with a reason that goes to the audit. A pilot lasts at most 180 days; the organisation's
`pilot_until` follows every change. Staff without the permission are refused.
"""

# ruff: noqa: F811 -- the imported fixture is requested by name.

from __future__ import annotations

import sqlalchemy as sa
from test_cloud_admin_routes import EVERY_FIELD, admin_world  # noqa: F401

from selecta import flags
from selecta.identity import accounts
from selecta.identity.schema import workspaces
from selecta.persistence import db_now, transaction

DAY = 24 * 3600


def _pilot(admin_world):
    with transaction(admin_world.engine) as conn:
        owner = accounts.provision(conn, admin_world.tokens.claims["customer"],
                                   age_confirmed=True).user.id
    made = admin_world.http.post("/api/admin/business/pilots", headers=admin_world.headers,
                                 json={**EVERY_FIELD, "owner_user_id": owner,
                                       "org_name": "Harbour Cafe", "pilot_days": 60})
    assert made.status_code == 201, made.text
    return made.json()["pilot"]


def test_staff_list_extend_change_and_end_a_pilot(admin_world):
    flags.use("+business.orgs +business.pilots")
    try:
        made = _pilot(admin_world)
        pilot_id, org_id = made["pilot_id"], made["org"]["id"]
        listed = admin_world.http.get("/api/admin/business/pilots", headers=admin_world.headers)
        [row] = [p for p in listed.json()["pilots"] if p["id"] == pilot_id]
        assert row["org_name"] == "Harbour Cafe" and row["venues_used"] == 1
        assert row["allowance"] == {"venues": 1, "zones": 3} and row["status"] == "active"

        url = f"/api/admin/business/pilots/{pilot_id}"
        too_long = admin_world.http.post(f"{url}/extend", headers=admin_world.headers, json={
            "reason": "busy season", "ends_at": row["starts_at"] + 200 * DAY})
        assert too_long.status_code == 422 and too_long.json()["detail"]["code"] == "too_long"
        extended = admin_world.http.post(f"{url}/extend", headers=admin_world.headers, json={
            "reason": "busy season", "ends_at": row["starts_at"] + 120 * DAY})
        assert extended.status_code == 200, extended.text
        with transaction(admin_world.engine) as conn:
            assert conn.execute(sa.select(workspaces.c.pilot_until).where(
                workspaces.c.id == org_id)).scalar() == row["starts_at"] + 120 * DAY
        changed = admin_world.http.post(f"{url}/allowance", headers=admin_world.headers, json={
            "reason": "second site", "allowance": {"venues": 2, "zones": 5}})
        assert changed.json()["pilot"]["allowance"] == {"venues": 2, "zones": 5}
        ended = admin_world.http.post(f"{url}/end", headers=admin_world.headers,
                                      json={"reason": "pilot finished"})
        assert ended.json()["pilot"]["status"] == "ended"
        refused = admin_world.http.post(f"{url}/convert", headers=admin_world.headers,
                                        json={"reason": "too late"})
        assert refused.status_code == 422
        with transaction(admin_world.engine) as conn:
            now = db_now(conn)
            assert conn.execute(sa.select(workspaces.c.pilot_until).where(
                workspaces.c.id == org_id)).scalar() <= now
    finally:
        flags.use(None)


def test_converting_clears_the_pilot_and_staff_without_the_role_are_refused(admin_world):
    flags.use("+business.orgs +business.pilots")
    try:
        made = _pilot(admin_world)
        url = f"/api/admin/business/pilots/{made['pilot_id']}"
        denied = admin_world.http.post(f"{url}/convert", headers=admin_world.denied_headers,
                                       json={"reason": "not mine"})
        assert denied.status_code == 403
        converted = admin_world.http.post(f"{url}/convert", headers=admin_world.headers,
                                          json={"reason": "signed the contract"})
        assert converted.json()["pilot"]["status"] == "converted"
        with transaction(admin_world.engine) as conn:
            assert conn.execute(sa.select(workspaces.c.pilot_until).where(
                workspaces.c.id == made["org"]["id"])).scalar() is None
    finally:
        flags.use(None)
