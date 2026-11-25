"""Flag controls for the cloud browser tests (tests/e2e_cloud_server.py). Never part of the app.

The Cloud reflow sweep (web/e2e-cloud/flags.cloud.ts) switches features off for one test person
at a time with a real targeting rule, the same per-user `users` rule the admin page's "Off for
these users" writes, so the decision runs through every layer exactly as in production and
reaches open pages over `flags.changed`. Only that person's pages change, so other tests never
notice.

- `POST /test/flags/off {"user", "flags": [...]}` makes `flags` exactly the set switched off for
  `user` by this control (an empty list clears them), leaving every other rule alone.
- `POST /test/flags/reset {"flags": [...]}` clears every rule on `flags`, for tests that change a
  flag for everyone through the admin page and must leave it as they found it.
- `POST /test/flags/catch-all {"flag"}` ends `flag`'s rules with the cutover catch-all (a 0%
  rollout), so a build that turns the flag on still leaves it off for everyone no earlier rule
  names: the shape a Labs cohort is opened in (playwright.labs.config.ts).
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Body, FastAPI
from sqlalchemy.engine import Engine

from selecta import flags
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Rule, RuleKind
from selecta.persistence import transaction

NOTE = "e2e flag sweep"


def _mine(rule: Rule, user_id: str) -> bool:
    params = rule.to_dict()["params"]
    return (rule.kind == RuleKind.USERS and params.get("note") == NOTE
            and list(params.get("ids") or ()) == [user_id])


def grant_everyone(engine: Engine, flag_id: str) -> None:
    """End `flag_id`'s rules with "on for everyone" (a 100% rollout): a grant the build ships on
    with no matching rule meaning off (`rules_default: false`, such as `cloud.hosted_media` since
    57acb155). Earlier rules, such as a test person's "Off for these users", still win."""
    last = Rule(RuleKind.PERCENTAGE, {"percent": 100, "salt": "e2e", "note": "e2e grant"})
    with transaction(engine) as conn:
        current = list(flag_rules.load_snapshot(conn).for_flag(flag_id))
        if not current or current[-1].to_dict() != last.to_dict():
            flag_rules.save(conn, flag_id, [*current, last], author="e2e",
                            reason="browser tests: every person is grandfathered")


def install(app: FastAPI, engine: Engine, user_of: Callable[[str], str]) -> None:
    """`user_of(name)` gives the user id of the test person `name`."""

    def settled() -> int:
        # This instance reads the new rules at once; NOTIFY tells any other (and wakes streams).
        app.state.flag_rules.invalidate()
        return app.state.flag_rules.version

    @app.post("/test/flags/off")
    def switch_off(body: dict = Body(default={})):  # noqa: B008
        user_id = user_of(str(body["user"]))
        wanted = {str(flag_id) for flag_id in body.get("flags", [])}
        unknown = wanted - set(flags.registry())
        if unknown:
            return {"error": f"unknown flags {sorted(unknown)}"}
        with transaction(engine) as conn:
            snapshot = flag_rules.load_snapshot(conn)
            touched = wanted | {
                flag_id for flag_id, rules in snapshot.rules.items()
                if any(_mine(rule, user_id) for rule in rules)
            }
            for flag_id in sorted(touched):
                current = snapshot.for_flag(flag_id)
                rest = [rule for rule in current if not _mine(rule, user_id)]
                mine = [Rule(RuleKind.USERS, {"ids": [user_id], "on": False, "note": NOTE})]
                proposed = [*mine, *rest] if flag_id in wanted else rest
                if [r.to_dict() for r in proposed] != [r.to_dict() for r in current]:
                    flag_rules.save(conn, flag_id, proposed, author="e2e",
                                    reason="browser flag sweep")
        return {"user_id": user_id, "off": sorted(wanted), "version": settled()}

    @app.post("/test/flags/reset")
    def reset(body: dict = Body(default={})):  # noqa: B008
        with transaction(engine) as conn:
            for flag_id in body.get("flags", []):
                if flag_rules.current_rules(conn, str(flag_id)):
                    flag_rules.save(conn, str(flag_id), [], author="e2e",
                                    reason="browser test clean-up")
        return {"version": settled()}

    @app.post("/test/flags/catch-all")
    def catch_all(body: dict = Body(default={})):  # noqa: B008
        flag_id = str(body["flag"])
        if flag_id not in flags.registry():
            return {"error": f"unknown flag {flag_id}"}
        last = Rule(RuleKind.PERCENTAGE, {"percent": 0, "salt": "e2e", "note": "e2e catch-all"})
        with transaction(engine) as conn:
            current = list(flag_rules.load_snapshot(conn).for_flag(flag_id))
            if not current or current[-1].to_dict() != last.to_dict():
                flag_rules.save(conn, flag_id, [*current, last], author="e2e",
                                reason="browser test catch-all")
        return {"version": settled()}
