"""Business test controls for the cloud browser tests (ADR-0453; web/e2e-cloud/business.cloud.ts).

The business flags are off in every shipped build. The browser-test server turns them on in its
build (`BUSINESS_FLAGS`) and, at start, gives each a last "0 percent" rule, so everybody else's
pages stay exactly as with the flags off. `POST /test/business/seed {"user", "staff"?}` then:

- makes the made-up "Harbour & Vine Group" pilot (`pilot.seed_demo`) owned by `user`;
- with `staff`, makes that person a member with the staff role at the first venue;
- puts the test people first in each business flag's rules with a per-user "on" rule.

It answers the organisation, venue and zone ids. Nothing here is reachable outside this server.
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Body, FastAPI
from sqlalchemy.engine import Engine

from selecta.flags import rules as flag_rules
from selecta.flags.matching import Rule, RuleKind
from selecta.persistence import db_now, new_id, transaction

BUSINESS_FLAGS = (
    "business.orgs", "business.workspaces", "business.console", "business.venue_view",
    "business.staff_controls", "business.zones", "business.roles", "business.schedules",
    "business.start",
)
NOTE = "e2e business"


def build_flags() -> str:
    return " ".join(f"+{flag}" for flag in BUSINESS_FLAGS)


def install(app: FastAPI, engine: Engine, user_of: Callable[[str], str]) -> None:
    last = Rule(RuleKind.PERCENTAGE, {"percent": 0, "salt": "e2e-business", "note": NOTE})
    with transaction(engine) as conn:
        for flag_id in BUSINESS_FLAGS:
            current = list(flag_rules.current_rules(conn, flag_id))
            if not current or current[-1].to_dict() != last.to_dict():
                flag_rules.save(conn, flag_id, [*current, last], author="e2e",
                                reason="business browser tests: off for everyone else")

    @app.post("/test/business/seed")
    def seed(body: dict = Body(default={})):  # noqa: B008
        from selecta.business import pilot
        from selecta.business.people.schema import business_members, business_venue_roles
        from selecta.identity.schema import workspace_members

        owner = user_of(str(body["user"]))
        staff = user_of(str(body["staff"])) if body.get("staff") else None
        with transaction(engine) as conn:
            now = int(db_now(conn))
            made = pilot.seed_demo(conn, owner_user_id=owner, now=now)
            org = made["org"]["id"]
            venue = made["venues"][0]["id"]
            if staff:
                conn.execute(workspace_members.insert().values(
                    workspace_id=org, user_id=staff, role="business_member", created_at=now))
                conn.execute(business_members.insert().values(
                    id=new_id(), workspace_id=org, organisation_id=org, user_id=staff,
                    email=f"{body['staff']}@example.test", status="active", source="invite",
                    joined_at=now))
                conn.execute(business_venue_roles.insert().values(
                    id=new_id(), workspace_id=org, organisation_id=org, user_id=staff,
                    venue_id=venue, role="staff", created_at=now))
            people = [person for person in (owner, staff) if person]
            for flag_id in BUSINESS_FLAGS:
                current = list(flag_rules.current_rules(conn, flag_id))
                mine = Rule(RuleKind.USERS, {"ids": people, "on": True, "note": NOTE})
                flag_rules.save(conn, flag_id, [mine, *current], author="e2e",
                                reason="business browser test people")
        app.state.flag_rules.invalidate()
        return {
            "org": org,
            "venues": [v["id"] for v in made["venues"]],
            "zones": [z["id"] for z in made["zones"]],
        }


__all__ = ["BUSINESS_FLAGS", "build_flags", "install"]
