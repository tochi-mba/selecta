"""Where targeting rules are kept: saving and refusing, immutable versions, rollback, staff
previews, warnings and the per-process cache (ADR-0414; docs/saas/11b-feature-flags.md §11B.4 to
§11B.9; docs/saas/18-test-plan.md §18.8)."""

from __future__ import annotations

import threading

import pytest
import sqlalchemy as sa

from selecta.flags import Flag
from selecta.flags import rules as store
from selecta.flags.matching import MAX_IDS, Rule, RuleSnapshot
from selecta.persistence import transaction


def make(flag_id: str, **fields) -> Flag:
    return Flag(id=flag_id, area="Test", label=flag_id, about=f"About {flag_id}", **fields)


REGISTRY = {
    flag.id: flag
    for flag in (
        make("plain"),
        make("other"),
        make("rooms", modes=("cloud",)),
        make("base", core="Everything stands on it"),
        make("admin.console", modes=("cloud",), kind="ops"),
        make("staff"),
        make("staff.tools"),
        make("trial", kind="experiment"),
        *[make(f"flag{n}") for n in range(25)],
    )
}
KILL = Rule("kill_switch")
OFF_FOR_FREE = Rule("segment", {"plans": ["free"]})


def rollout(percent: float, salt: str = "a") -> Rule:
    return Rule("percentage", {"percent": percent, "salt": salt})


def save(conn, flag_id, rules, *, author="staff-1", reason="testing", registry=REGISTRY, **kw):
    return store.save(conn, flag_id, rules, author=author, reason=reason, registry=registry, **kw)


def preview(conn, flag_id="plain", user_id="staff-1", *, ttl=store.PREVIEW_TTL, **kw):
    kw.setdefault("author", user_id)
    kw.setdefault("reason", "QA")
    return store.set_preview(conn, flag_id, user_id, ttl=ttl, registry=REGISTRY, **kw)


# Saving


def test_saving_rules_stores_them_in_order_with_a_new_version(cloud_engine):
    with transaction(cloud_engine) as conn:
        assert store.current_version(conn) == 0
        saved = save(conn, "plain", [OFF_FOR_FREE, rollout(10)])
        assert saved.version == 1
        assert saved.flag_id == "plain"
        assert saved.warnings == ()
        assert store.current_rules(conn, "plain") == (OFF_FOR_FREE, rollout(10))
        assert store.current_version(conn) == 1


def test_versions_count_up_across_every_flag(cloud_engine):
    with transaction(cloud_engine) as conn:
        assert save(conn, "plain", [KILL]).version == 1
        assert save(conn, "other", [KILL]).version == 2
        assert save(conn, "plain", []).version == 3
        assert store.current_rules(conn, "plain") == ()
        assert store.current_rules(conn, "other") == (KILL,)


def test_saving_an_empty_list_clears_a_flags_rules_and_still_records_who(cloud_engine):
    with transaction(cloud_engine) as conn:
        save(conn, "plain", [KILL])
        cleared = save(conn, "plain", [], author="staff-2", reason="incident over")
        version = store.get_version(conn, cleared.version)
        assert version is not None
        assert (version.rules, version.author, version.reason) == ((), "staff-2", "incident over")


def test_a_rule_for_a_flag_that_does_not_exist_is_refused_with_a_suggestion(cloud_engine):
    with transaction(cloud_engine) as conn:
        with pytest.raises(store.RuleError) as refused:
            save(conn, "plian", [KILL])
        assert refused.value.problems == ["'plian' isn't a flag. Did you mean plain?"]
        with pytest.raises(store.RuleError, match="'zzz' isn't a flag.$"):
            save(conn, "zzz", [KILL])


def test_saving_a_rule_for_a_core_flag_is_refused(cloud_engine):
    with transaction(cloud_engine) as conn:
        with pytest.raises(store.RuleError) as refused:
            save(conn, "base", [KILL])
        assert refused.value.problems == [
            "base is core, so it can't be targeted: Everything stands on it"
        ]


@pytest.mark.parametrize("flag_id", ["admin.console", "staff", "staff.tools"])
def test_saving_a_rule_for_the_admin_console_or_staff_routes_is_refused(cloud_engine, flag_id):
    with transaction(cloud_engine) as conn:
        with pytest.raises(store.RuleError, match="runs the admin console or staff routes"):
            save(conn, flag_id, [KILL])
        assert store.current_version(conn) == 0


def test_the_untargetable_list_can_be_widened(cloud_engine):
    with transaction(cloud_engine) as conn:
        with pytest.raises(store.RuleError):
            save(conn, "rooms", [KILL], untargetable=("room*",))
    assert store.is_untargetable("admin")
    assert store.is_untargetable("admin.console.users")
    assert not store.is_untargetable("administration")
    assert not store.is_untargetable("rooms")


def test_every_problem_with_the_rules_is_reported_at_once(cloud_engine):
    rules = [Rule("users", {"ids": []}), "kill everything", rollout(250), KILL]
    with transaction(cloud_engine) as conn:
        with pytest.raises(store.RuleError) as refused:
            save(conn, "trial", rules)
        assert refused.value.problems == [
            "rule 1: ids should be a list with at least one entry",
            "rule 2 isn't a Rule",
            "rule 3: percent should be a number from 0 to 100",
            "rule 4: an experiment can't have a kill switch; end the experiment",
        ]
        assert str(refused.value).startswith("rule 1: ids should be")
        assert store.current_version(conn) == 0


def test_a_flag_can_have_at_most_a_hundred_rules(cloud_engine):
    with transaction(cloud_engine) as conn:
        assert save(conn, "plain", [OFF_FOR_FREE] * store.MAX_RULES).version == 1
        with pytest.raises(store.RuleError, match="at most 100 rules"):
            save(conn, "plain", [OFF_FOR_FREE] * (store.MAX_RULES + 1))


def test_a_long_list_rule_is_stored_and_read_back_whole(cloud_engine):
    ids = [f"user-{n}" for n in range(MAX_IDS)]
    with transaction(cloud_engine) as conn:
        save(conn, "plain", [Rule("users", {"ids": ids, "on": True})])
        assert store.current_rules(conn, "plain")[0].params["ids"] == ids


@pytest.mark.parametrize(("author", "reason"), [("", "why"), ("me", "  "), (" ", "")])
def test_every_change_needs_an_author_and_a_reason(cloud_engine, author, reason):
    with transaction(cloud_engine) as conn:
        with pytest.raises(store.RuleError, match="every change needs"):
            save(conn, "plain", [KILL], author=author, reason=reason)
        with pytest.raises(store.RuleError, match="every change needs"):
            store.rollback(conn, 1, author=author, reason=reason, registry=REGISTRY)
        with pytest.raises(store.RuleError, match="every change needs"):
            store.clear_preview(conn, "plain", "me", author=author, reason=reason)


def test_saving_uses_the_real_registry_by_default(cloud_engine):
    with transaction(cloud_engine) as conn:
        with pytest.raises(store.RuleError, match="core"):
            store.save(conn, "core.library", [KILL], author="a", reason="b")
        with pytest.raises(store.RuleError, match="admin console"):
            store.save(conn, "admin.console", [KILL], author="a", reason="b")


# Versions and rollback


def test_a_version_never_changes_after_it_is_written(cloud_engine):
    with transaction(cloud_engine) as conn:
        first = save(conn, "plain", [OFF_FOR_FREE], author="alice", reason="free first")
        before = store.get_version(conn, first.version)
        save(conn, "plain", [KILL])
        save(conn, "plain", [rollout(5)])
        store.rollback(conn, 2, author="bob", reason="back", registry=REGISTRY)
        assert store.get_version(conn, first.version) == before
        assert before is not None
        assert (before.change, before.rules, before.author) == ("rules", (OFF_FOR_FREE,), "alice")


def test_a_version_number_can_only_be_written_once(cloud_engine):
    with transaction(cloud_engine) as conn:
        save(conn, "plain", [KILL])
    with pytest.raises(sa.exc.IntegrityError):
        with transaction(cloud_engine) as conn:
            conn.execute(
                sa.insert(store.flag_rule_versions).values(
                    version=1,
                    flag_id="plain",
                    change="rules",
                    rules=[],
                    author="mallory",
                    reason="rewrite history",
                    created_at=0.0,
                )
            )


def test_rollback_restores_the_exact_earlier_rules_as_a_new_version(cloud_engine):
    first = [OFF_FOR_FREE, rollout(12.5, "x"), Rule("users", {"ids": ["u1"], "on": True})]
    with transaction(cloud_engine) as conn:
        save(conn, "plain", first)
        save(conn, "plain", [KILL])
        restored = store.rollback(conn, 1, author="staff-1", reason="undo", registry=REGISTRY)
        assert restored.version == 3
        assert restored.rules == tuple(first)
        assert store.current_rules(conn, "plain") == tuple(first)
        row = store.get_version(conn, 3)
        assert row is not None
        assert (row.change, row.rolled_back_to, row.rules) == ("rollback", 1, tuple(first))


def test_rolling_back_to_an_empty_rule_list_clears_the_rules(cloud_engine):
    with transaction(cloud_engine) as conn:
        save(conn, "plain", [])
        save(conn, "plain", [KILL])
        store.rollback(conn, 1, author="a", reason="b", registry=REGISTRY)
        assert store.current_rules(conn, "plain") == ()


def test_rolling_back_to_a_version_that_does_not_exist_is_a_lookup_error(cloud_engine):
    with transaction(cloud_engine) as conn:
        with pytest.raises(LookupError, match="no version 9"):
            store.rollback(conn, 9, author="a", reason="b", registry=REGISTRY)


def test_an_old_version_that_no_longer_makes_sense_is_refused(cloud_engine):
    with transaction(cloud_engine) as conn:
        save(conn, "plain", [KILL])
        save(conn, "plain", [])
        now_core = REGISTRY | {"plain": make("plain", core="Now essential")}
        with pytest.raises(store.RuleError) as refused:
            store.rollback(conn, 1, author="a", reason="b", registry=now_core)
        assert refused.value.problems[0] == "version 1 can't be restored as it is"
        assert store.current_version(conn) == 2


def test_history_lists_changes_newest_first_per_flag_and_in_pages(cloud_engine):
    with transaction(cloud_engine) as conn:
        for flag_id in ("plain", "other", "plain", "other", "plain"):
            save(conn, flag_id, [KILL])
        assert [v.version for v in store.history(conn)] == [5, 4, 3, 2, 1]
        assert [v.version for v in store.history(conn, "plain")] == [5, 3, 1]
        assert [v.version for v in store.history(conn, limit=2)] == [5, 4]
        assert [v.version for v in store.history(conn, before=4)] == [3, 2, 1]
        assert [v.version for v in store.history(conn, "other", before=4)] == [2]
        assert store.get_version(conn, 99) is None


# Warnings


def test_a_new_salt_warns_that_the_rollout_reshuffles():
    found = store.warnings([rollout(10, "a")], [rollout(10, "b")])
    assert found == ["a new salt reshuffles who is in the rollout: some accounts lose the feature"]
    assert store.warnings([], [rollout(10, "b")]) == []
    assert store.warnings([rollout(10, "a")], [rollout(20, "a")]) == []


def test_lowering_a_rollout_warns_that_accounts_lose_the_feature():
    found = store.warnings([rollout(30)], [rollout(20)])
    assert found == ["lowering a rollout takes the feature away from accounts that have it"]
    disabled = Rule("percentage", {"percent": 30, "salt": "a"}, enabled=False)
    assert store.warnings([disabled], [rollout(20)]) == []


def test_a_third_change_within_ten_minutes_warns_of_flapping():
    assert store.warnings([], [KILL], recent_changes=1) == []
    assert store.warnings([], [KILL], recent_changes=2) == [
        "this flag has changed 3 times in 10 minutes"
    ]


def test_saving_returns_its_warnings(cloud_engine):
    with transaction(cloud_engine) as conn:
        save(conn, "plain", [rollout(50, "one")])
        second = save(conn, "plain", [rollout(40, "two")])
        assert "a new salt reshuffles" in second.warnings[0]
        third = save(conn, "plain", [rollout(30, "two")])
        assert third.warnings == (
            "lowering a rollout takes the feature away from accounts that have it",
            "this flag has changed 3 times in 10 minutes",
        )
        assert save(conn, "other", [KILL]).warnings == ()


def test_changes_older_than_ten_minutes_do_not_count_as_flapping(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        save(conn, "plain", [KILL])
        save(conn, "plain", [])
    clock.advance(store.FLAP_WINDOW + 1)
    with transaction(sqlite_engine) as conn:
        assert save(conn, "plain", [KILL]).warnings == ()


# Staff previews


def test_a_staff_preview_switches_a_flag_on_for_their_own_account_only(cloud_engine):
    with transaction(cloud_engine) as conn:
        with pytest.raises(store.RuleError, match="your own account only"):
            store.set_preview(
                conn, "plain", "user-9", author="staff-1", reason="QA", registry=REGISTRY
            )
        saved = preview(conn, "plain", "staff-1", ttl=None)
        snapshot = store.load_snapshot(conn)
    assert snapshot.version == saved.version == 1
    assert snapshot.previews == {"plain": {"staff-1": None}}
    assert snapshot.previewing("plain", "staff-1", 0)
    assert not snapshot.previewing("plain", "user-9", 0)


def test_a_preview_is_a_version_that_leaves_the_rules_alone(cloud_engine):
    with transaction(cloud_engine) as conn:
        save(conn, "plain", [OFF_FOR_FREE])
        saved = preview(conn)
        assert saved.warnings == ()
        assert store.current_rules(conn, "plain") == (OFF_FOR_FREE,)
        row = store.get_version(conn, saved.version)
        assert row is not None
        assert (row.change, row.subject_user_id, row.rules) == (
            "preview_on",
            "staff-1",
            (OFF_FOR_FREE,),
        )


def test_a_preview_for_a_core_untargetable_or_unknown_flag_is_refused(cloud_engine):
    with transaction(cloud_engine) as conn:
        for flag_id in ("base", "admin.console", "nope"):
            with pytest.raises(store.RuleError):
                preview(conn, flag_id)
        assert store.current_version(conn) == 0


@pytest.mark.parametrize("ttl", [0, -5])
def test_a_preview_needs_a_time_to_run(cloud_engine, ttl):
    with transaction(cloud_engine) as conn:
        with pytest.raises(store.RuleError, match="above 0"):
            preview(conn, ttl=ttl)


def test_a_preview_expires_after_its_time(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        preview(conn, ttl=60)
        snapshot = store.load_snapshot(conn)
    ends = clock.now + 60
    assert snapshot.previews == {"plain": {"staff-1": ends}}
    assert snapshot.previewing("plain", "staff-1", ends - 0.001)
    assert not snapshot.previewing("plain", "staff-1", ends)
    clock.advance(60)
    with transaction(sqlite_engine) as conn:
        assert store.load_snapshot(conn).previews == {}
        assert store.expire_previews(conn) == 1
        assert store.expire_previews(conn) == 0


def test_expiring_previews_keeps_those_still_running(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        preview(conn, "plain", "staff-1", ttl=10)
        preview(conn, "other", "staff-1", ttl=100)
        preview(conn, "rooms", "staff-1", ttl=None)
    clock.advance(50)
    with transaction(sqlite_engine) as conn:
        assert store.expire_previews(conn) == 1
        assert store.load_snapshot(conn).previews == {
            "other": {"staff-1": clock.now + 50},
            "rooms": {"staff-1": None},
        }


def test_setting_a_preview_again_replaces_its_end(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        preview(conn, ttl=10)
        preview(conn, ttl=1_000)
        assert store.load_snapshot(conn).previews == {"plain": {"staff-1": clock.now + 1_000}}


def test_clearing_a_preview_writes_a_version_and_clearing_nothing_does_not(cloud_engine):
    with transaction(cloud_engine) as conn:
        assert store.clear_preview(conn, "plain", "staff-1", author="staff-1", reason="x") is None
        preview(conn)
        cleared = store.clear_preview(conn, "plain", "staff-1", author="staff-1", reason="done")
        assert cleared is not None
        row = store.get_version(conn, cleared.version)
        assert row is not None
        assert row.change == "preview_off"
        assert store.load_snapshot(conn).previews == {}
        assert store.current_version(conn) == 2


# Snapshots, orphans and the cache


def test_a_snapshot_holds_every_flags_rules_and_the_newest_version(cloud_engine):
    with transaction(cloud_engine) as conn:
        save(conn, "plain", [OFF_FOR_FREE, KILL])
        save(conn, "other", [rollout(5)])
        snapshot = store.load_snapshot(conn)
    assert snapshot.version == 2
    assert snapshot.for_flag("plain") == (OFF_FOR_FREE, KILL)
    assert snapshot.for_flag("other") == (rollout(5),)
    assert snapshot.for_flag("rooms") == ()


def test_rules_for_a_removed_or_untargetable_flag_are_orphans(cloud_engine):
    with transaction(cloud_engine) as conn:
        save(conn, "plain", [KILL])
        save(conn, "other", [KILL])
        save(conn, "rooms", [KILL])
        changed = {k: v for k, v in REGISTRY.items() if k != "plain"}
        changed["other"] = make("other", core="Now essential")
        found = store.orphans(conn, registry=changed, untargetable=("room*",))
        assert found == [
            "other has rules but can't be targeted any more",
            "plain has rules but isn't a flag any more",
            "rooms has rules but can't be targeted any more",
        ]
        assert store.orphans(conn, registry=REGISTRY) == []
        assert store.orphans(conn) == [
            "other has rules but isn't a flag any more",
            "plain has rules but isn't a flag any more",
        ]


class Queries:
    def __init__(self, engine) -> None:
        self.count = 0
        sa.event.listen(engine, "before_cursor_execute", self.seen)

    def seen(self, *args) -> None:
        self.count += 1


class Ticks:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_the_cache_loads_once_and_refreshes_only_to_a_newer_version(cloud_engine):
    with transaction(cloud_engine) as conn:
        save(conn, "plain", [KILL])
    cache = store.RulesCache(cloud_engine)
    held = cache.snapshot
    assert cache.version == 1
    assert cache.snapshot is held
    queries = Queries(cloud_engine)
    assert cache.refresh_if_newer(1) is False
    assert cache.refresh_if_newer(0) is False
    assert queries.count == 0
    assert cache.refresh_if_newer() is False
    assert cache.snapshot is held
    with transaction(cloud_engine) as conn:
        save(conn, "plain", [])
    assert cache.refresh_if_newer(2) is True
    assert cache.version == 2
    assert cache.snapshot.for_flag("plain") == ()
    # A reader that took the old snapshot keeps it for its whole request.
    assert held.for_flag("plain") == (KILL,)


def test_the_cache_never_goes_back_to_an_older_version(cloud_engine):
    with transaction(cloud_engine) as conn:
        save(conn, "plain", [KILL])
    cache = store.RulesCache(cloud_engine)
    newer = RuleSnapshot(5, {"plain": (OFF_FOR_FREE,)})
    cache._snapshot = newer
    assert cache.refresh_if_newer() is False
    assert cache.snapshot is newer


def test_a_notified_version_loads_the_cache_even_before_its_first_read(cloud_engine):
    cache = store.RulesCache(cloud_engine)
    assert cache.refresh_if_newer(3) is True
    assert cache.version == 0


def test_a_stale_cache_checks_again_at_most_every_max_age(cloud_engine):
    ticks = Ticks()
    cache = store.RulesCache(cloud_engine, max_age=30, clock=ticks)
    assert cache.refresh_if_stale() is True
    with transaction(cloud_engine) as conn:
        save(conn, "plain", [KILL])
    queries = Queries(cloud_engine)
    ticks.now = 29.9
    assert cache.refresh_if_stale() is False
    assert queries.count == 0
    assert cache.version == 0
    ticks.now = 30
    assert cache.refresh_if_stale() is True
    assert cache.version == 1
    ticks.now = 61
    assert cache.refresh_if_stale() is False
    ticks.now = 70
    assert cache.refresh_if_stale() is False


def test_invalidating_the_cache_reloads_on_the_next_read(cloud_engine):
    cache = store.RulesCache(cloud_engine)
    first = cache.snapshot
    cache.invalidate()
    assert cache.snapshot is not first
    assert cache.snapshot.version == 0


# Many writers at once


def test_writers_at_once_get_distinct_consecutive_versions(cloud_engine):
    flag_ids = [f"flag{n}" for n in range(20)]
    errors: list[BaseException] = []
    start = threading.Barrier(len(flag_ids))

    def write(flag_id: str) -> None:
        try:
            start.wait()
            with transaction(cloud_engine) as conn:
                save(conn, flag_id, [KILL])
        except BaseException as error:  # noqa: BLE001
            errors.append(error)

    threads = [threading.Thread(target=write, args=(flag_id,)) for flag_id in flag_ids]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert errors == []
    with transaction(cloud_engine) as conn:
        versions = sorted(v.version for v in store.history(conn, limit=100))
        assert versions == list(range(1, 21))
        assert {v.flag_id for v in store.history(conn, limit=100)} == set(flag_ids)
