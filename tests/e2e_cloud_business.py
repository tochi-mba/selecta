"""Business test controls for the cloud browser tests (ADR-0453; web/e2e-cloud/business.cloud.ts).

The business flags are off in every shipped build. The browser-test server turns them on in its
build (`BUSINESS_FLAGS`) and, at start, gives each a last "0 percent" rule, so everybody else's
pages stay exactly as with the flags off. `POST /test/business/seed {"user", "staff"?,
"without"?, "selling"?}` then:

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
    "business.start", "business.entitlements", "business.signups",
)
# ADR-0450 and ADR-0451 browser tests (web/e2e-business/*.content.ts) run on their own server
# with SELECTA_E2E_CONTENT=1: only there are content controls and Rooms for Business built on,
# so every other suite's zone programmes stay unchecked by content rules.
CONTENT_FLAGS = (
    "business.content_controls", "business.content_controls.bulk",
    "business.content_controls.lyrics_hint", "business.rooms", "business.rooms.branding",
    "business.rooms.print", "business.rooms.screen_code",
)


def flags_in_play() -> tuple[str, ...]:
    import os

    extra = CONTENT_FLAGS if os.environ.get("SELECTA_E2E_CONTENT") == "1" else ()
    return (*BUSINESS_FLAGS, *extra)


# Selling stays off for the seeded people unless the seed asks for it (`"selling": true`), so the
# pilot-only pages keep their sign-up-off copy (web/e2e-business/pricing.business.ts).
SELLING = "business.signups"
NOTE = "e2e business"


def build_flags() -> str:
    return " ".join(f"+{flag}" for flag in flags_in_play())


def install(app: FastAPI, engine: Engine, user_of: Callable[[str], str]) -> None:
    last = Rule(RuleKind.PERCENTAGE, {"percent": 0, "salt": "e2e-business", "note": NOTE})
    with transaction(engine) as conn:
        for flag_id in flags_in_play():
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
            # `without`: flags left off for these people, for a flag-off browser run.
            left_off = set(body.get("without") or ())
            if not body.get("selling"):
                left_off.add(SELLING)
            if body.get("songs"):
                _songs(conn, org, int(body["songs"]), now)
            for flag_id in flags_in_play():
                if flag_id in left_off:
                    continue
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


def _songs(conn, workspace_id: str, count: int, now: int) -> None:
    """`songs`: that many made-up analysed uploads in the organisation library, so the content
    pages and the guest search have something real to show (ADR-0450 browser tests)."""
    import hashlib

    from selecta.business.content.library import clear_cache
    from selecta.local_media.schema import local_songs
    from selecta.storage.schema import assets
    from selecta.work.schema import artifacts

    for index in range(count):
        sha = hashlib.sha256(f"{workspace_id}:{index}".encode()).hexdigest()
        song_id = new_id()
        conn.execute(assets.insert().values(
            id=song_id, workspace_id=workspace_id, original_key=f"e2e/{song_id}", size=1000,
            sha256=sha, format="mp3", duration_s=200.0, created_at=now))
        conn.execute(local_songs.insert().values(
            workspace_id=workspace_id, content_sha256=sha, title=f"Harbour Song {index + 1}",
            artist="Rude Words" if index == 0 else f"Harbour Band {index % 4}", album="Docks",
            duration_s=200.0, created_at=now, updated_at=now))
        conn.execute(artifacts.insert().values(
            id=new_id(), workspace_id=workspace_id, kind="song_facts", input_hash=sha, keys=[],
            checksum="e2e", provenance={"facts": {"bpm": 120, "energy": 0.5}}, created_at=now,
            last_used_at=now))
    clear_cache()


__all__ = ["BUSINESS_FLAGS", "CONTENT_FLAGS", "build_flags", "flags_in_play", "install"]
