"""ADR-0450's one rule engine, pools, relaxation, saves, horizons, kiosk snapshots and volume.

Pure tests over `content.engine`, `content.pool`, `content.snapshot_io`, `content.names` and
`content.volume`, plus Hypothesis properties: rules only narrow from organisation to daypart,
answers are deterministic, a refusal always names its rule, and relaxing never admits a song the
explicit filter, blocklist or crates refused.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from selecta.business.content import snapshot_io
from selecta.business.content.engine import (
    NEVER_RELAX,
    RELAX_ORDER,
    BlockEntry,
    Override,
    RecentPlays,
    RuleRow,
    SongFacts,
    allowed,
    clean_swap,
    compile_snapshot,
    daypart_at,
)
from selecta.business.content.names import artist_variants, credits
from selecta.business.content.pool import (
    effective_pool,
    horizon_after_change,
    kiosk_snapshot_merge,
    validate_blocks,
)
from selecta.business.content.volume import QuietWindow, VolumeRules, cap_at, clamp, step

ORG, VENUE, ZONE = "org", "venue", "zone"
NOW = datetime(2026, 11, 16, 14, 0, tzinfo=UTC)  # a Monday


def song(song_id="s1", **values) -> SongFacts:
    base = dict(song_id=song_id, title=f"Title {song_id}", artist="Artist", bpm=120.0,
                energy=0.5, explicit="clean", crate_ids=frozenset({"c1"}))
    base.update(values)
    return SongFacts(**base)


def snap(rules=(), entries=(), overrides=(), version=1, **extra):
    return compile_snapshot(version=version, zone_id=ZONE, venue_id=VENUE, organisation_id=ORG,
                            rules=rules, entries=entries, overrides=overrides, zone_name="Bar",
                            **extra)


def entry(kind, value, level="organisation", level_id=ORG, created=0.0, ends=None):
    return BlockEntry(id=f"b-{kind}-{value}", kind=kind, value=value, label=value, level=level,
                      level_id=level_id, created_at=created, ends_at=ends)


# ---- every rule kind refuses with its name -------------------------------------------------

@pytest.mark.parametrize(("facts", "rules", "entries", "expected"), [
    (song(set_aside=True), (), (), "set_aside"),
    (song(never_play=True), (), (), "never_play"),
    (song(analysed=False), (), (), "unanalysed"),
    (song(), (), (entry("song", "s1"),), "blocklist_song"),
    (song(artist="Beyoncé feat. Jay-Z"), (), (entry("artist", "Jay Z"),), "blocklist_artist"),
    (song(album="Lemonade"), (), (entry("album", "lemonade"),), "blocklist_album"),
    (song(tags=frozenset({"Drill"})), (), (entry("tag", "drill"),), "blocklist_tag"),
    (song(), (RuleRow("zone", ZONE, crate_ids=frozenset({"c2"})),), (), "crates"),
    (song(explicit="explicit"), (), (), "explicit"),
    (song(explicit="unknown"), (RuleRow("venue", VENUE, filter_mode="clean_only"),), (),
     "explicit"),
    (song(bpm=150.0), (RuleRow("zone", ZONE, bpm_min=90, bpm_max=115, half_double=False),), (),
     "brand_bpm"),
    (song(energy=0.9), (RuleRow("zone", ZONE, energy_min=0.1, energy_max=0.6),), (),
     "brand_energy"),
])
def test_each_rule_kind_refuses_and_names_itself(facts, rules, entries, expected):
    decision = allowed(facts, snap(rules, entries), NOW)
    assert not decision.allowed
    assert decision.rule == expected
    assert decision.detail
    assert decision.snapshot_version == 1


def test_spacing_refuses_a_recent_song_and_artist():
    recent = RecentPlays.of([(song("s1"), NOW - timedelta(minutes=10))])
    assert allowed(song("s1"), snap(), NOW, recent=recent).rule == "song_spacing"
    assert allowed(song("s2"), snap(), NOW, recent=recent).rule == "artist_spacing"
    assert allowed(song("s3", artist="Other"), snap(), NOW, recent=recent).allowed


def test_half_and_double_time_count_by_default_and_can_be_switched_off():
    rule = RuleRow("zone", ZONE, bpm_min=130, bpm_max=150)
    assert allowed(song(bpm=70.0), snap([rule]), NOW).allowed  # 70 counts as 140
    strict = RuleRow("zone", ZONE, bpm_min=130, bpm_max=150, half_double=False)
    assert allowed(song(bpm=70.0), snap([strict]), NOW).rule == "brand_bpm"


def test_engine_off_refuses_everything():
    decision = allowed(song(), snap(enabled=False), NOW)
    assert decision.rule == "content_controls_off"


def test_a_blocklist_entry_ends_on_time():
    ends = NOW.timestamp() + 60
    rules = snap(entries=[entry("song", "s1", ends=ends)])
    assert allowed(song(), rules, NOW).rule == "blocklist_song"
    assert allowed(song(), rules, NOW + timedelta(minutes=2)).allowed


def test_new_zones_start_on_no_explicit_and_unknown_still_plays():
    assert allowed(song(explicit="unknown"), snap(), NOW).allowed
    assert allowed(song(explicit="explicit"), snap(), NOW).rule == "explicit"


def test_a_manager_flag_replaces_the_songs_own_mark():
    rules = snap(explicit_flags={"s1": "explicit"})
    assert allowed(song(explicit="clean"), rules, NOW).rule == "explicit"


# ---- overrides -----------------------------------------------------------------------------

def override(kind="artist", value="Artist", created=10.0, ends=None):
    start = NOW.timestamp() - 60
    return Override(id="o1", zone_id=ZONE, kind=kind, value=value, created_at=created,
                    starts_at=start, ends_at=ends or start + 3600, reason="private event")


def test_an_override_lets_an_older_blocked_artist_through_but_not_a_newer_entry():
    older = entry("artist", "Artist", created=1.0)
    assert allowed(song(), snap(entries=[older], overrides=[override()]), NOW).allowed
    newer = entry("artist", "Artist", created=99.0)
    assert allowed(song(), snap(entries=[newer], overrides=[override()]), NOW).rule == \
        "blocklist_artist"


def test_an_override_never_lifts_clean_only():
    rules = [RuleRow("zone", ZONE, filter_mode="clean_only")]
    decision = allowed(song(explicit="explicit"), snap(rules, overrides=[override()]), NOW)
    assert decision.rule == "explicit"


def test_an_override_ends_on_time():
    ends = NOW.timestamp() + 30
    rules = snap(entries=[entry("artist", "Artist", created=1.0)], overrides=[override(ends=ends)])
    assert allowed(song(), rules, NOW).allowed
    assert not allowed(song(), rules, NOW + timedelta(minutes=1)).allowed


# ---- dayparts, crates and the effective pool -----------------------------------------------

def test_dayparts_follow_local_time_overnight():
    part = RuleRow("daypart", ZONE, daypart_id="late", daypart_label="Late",
                   filter_mode="clean_only", windows=((0, 23 * 60, 2 * 60),))
    rules = snap([part], time_zone="Europe/London")
    late = datetime(2026, 11, 16, 23, 30, tzinfo=ZoneInfo("Europe/London"))
    after_midnight = late + timedelta(hours=1)
    assert daypart_at(rules, late) == "late"
    assert daypart_at(rules, after_midnight) == "late"
    assert daypart_at(rules, late + timedelta(hours=3)) is None
    assert allowed(song(explicit="unknown"), rules, after_midnight).rule == "explicit"


def test_a_daypart_block_names_its_own_crates_and_falls_back_to_zone_then_venue():
    zone_default = RuleRow("zone", ZONE, crate_ids=frozenset({"c1"}))
    brunch = RuleRow("daypart", ZONE, daypart_id="brunch", crate_ids=frozenset({"c2"}))
    rules = snap([zone_default, brunch])
    assert allowed(song(crate_ids=frozenset({"c2"})), rules, NOW, daypart_id="brunch").allowed
    assert allowed(song(crate_ids=frozenset({"c2"})), rules, NOW).rule == "crates"
    assert allowed(song(crate_ids=frozenset({"c9"})), snap(), NOW).allowed  # venue pool


def test_the_pool_relaxes_only_in_order_and_says_so():
    rules = [RuleRow("zone", ZONE, bpm_min=100, bpm_max=110, half_double=False)]
    songs = [song("a", bpm=105.0), song("b", bpm=140.0, artist="B")]
    recent = RecentPlays.of([(songs[0], NOW - timedelta(minutes=45))])
    result = effective_pool(songs, snap(rules), NOW, recent=recent, minimum=1)
    assert result.relaxed == ("song_spacing",)
    assert [s.song_id for s in result.songs] == ["a"]
    assert "Bar is repeating songs sooner than usual: 1 songs fit" in result.messages[0]
    bigger = effective_pool(songs, snap(rules), NOW, recent=recent, minimum=2)
    assert bigger.relaxed == RELAX_ORDER


def test_relaxing_never_admits_explicit_blocked_or_out_of_crate_songs():
    songs = [song("x", explicit="explicit"), song("y", crate_ids=frozenset({"c9"})),
             song("z")]
    rules = snap([RuleRow("zone", ZONE, crate_ids=frozenset({"c1"}))], [entry("song", "z")])
    result = effective_pool(songs, rules, NOW, minimum=5)
    assert result.songs == ()
    assert set(result.relaxed) == set(RELAX_ORDER)


def test_the_pool_counts_unknown_songs():
    result = effective_pool([song("a", explicit="unknown"), song("b")], snap(), NOW)
    assert result.unknown_count == 1


# ---- saves, horizons, clean edits and kiosks -----------------------------------------------

def test_a_save_that_empties_a_block_is_refused_and_a_short_one_warns():
    library = [song(f"s{i}") for i in range(10)]
    empty = snap([RuleRow("zone", ZONE, crate_ids=frozenset({"none"}))])
    assert validate_blocks(empty, library, [(None, "all day")], NOW).refusals == (
        "Bar all day would have no songs allowed",)
    short = validate_blocks(snap(), library, [(None, "all day")], NOW)
    assert short.ok and "under 2 hours" in short.warnings[0]
    long = validate_blocks(snap(), [song(f"s{i}") for i in range(60)], [(None, "all day")], NOW)
    assert long.ok and not long.warnings


def test_a_new_snapshot_drops_refused_songs_and_moves_off_the_current_one_on_request():
    facts = {s.song_id: s for s in (song("a"), song("b", explicit="explicit"), song("c"))}
    stricter = snap(version=2)
    kept = horizon_after_change(["a", "b"], stricter, facts=facts, at=NOW, playing_id="b")
    assert kept.keep == ("a",) and kept.dropped == (("b", "explicit"),)
    assert kept.current == "finish"
    moved = horizon_after_change(["a"], stricter, facts=facts, at=NOW, playing_id="b",
                                 take_it_off_now=True)
    assert moved.current == "move_off" and moved.move_within_s <= 30


def test_a_clean_edit_is_offered_for_a_refused_original():
    rules = snap(clean_links={"orig": "edit"})
    assert clean_swap("orig", rules) == "edit"
    assert clean_swap("other", rules) is None


def test_offline_kiosks_tighten_at_once_and_loosen_only_after_reconnect():
    loose = snap(version=1)
    tight = snap(entries=[entry("song", "s1")], version=2)
    held = kiosk_snapshot_merge(loose, tight, online=False)
    assert not allowed(song(), held, NOW).allowed
    loosened = kiosk_snapshot_merge(tight, snap(version=3), online=False)
    assert not allowed(song(), loosened, NOW).allowed  # the older, stricter one still holds
    assert allowed(song(), kiosk_snapshot_merge(tight, snap(version=3), online=True), NOW).allowed


def test_a_snapshot_survives_the_trip_to_a_kiosk():
    rules = snap([RuleRow("zone", ZONE, bpm_min=90, bpm_max=115),
                  RuleRow("daypart", ZONE, daypart_id="d", windows=((0, 600, 720),))],
                 [entry("artist", "Nope")], [override()], explicit_flags={"s9": "explicit"})
    back = snapshot_io.from_json(snapshot_io.to_json(rules))
    for facts in (song(), song(artist="Nope"), song("s9"), song(bpm=150.0)):
        assert allowed(facts, back, NOW) == allowed(facts, rules, NOW)


def test_artist_variants_list_every_spelling_with_features():
    names = ["Beyonce", "Beyoncé", "Beyoncé feat. Jay-Z", "Jay-Z"]
    assert artist_variants("beyonce", names) == ["Beyonce", "Beyoncé", "Beyoncé feat. Jay-Z"]
    assert "jay z" in credits("Beyoncé feat. Jay-Z")


# ---- volume caps and quiet hours ------------------------------------------------------------

def test_staff_volume_is_held_to_the_cap_and_quiet_hours_ramp_down_over_thirty_seconds():
    london = ZoneInfo("Europe/London")
    rules = VolumeRules(cap=0.8, quiet=(QuietWindow("23:00", "07:00", 0.3),),
                        time_zone="Europe/London")
    day = datetime(2026, 11, 16, 20, 0, tzinfo=london)
    assert clamp(1.0, rules, day) == 0.8
    start = datetime(2026, 11, 16, 23, 0, tzinfo=london)
    assert 0.3 < cap_at(rules, start + timedelta(seconds=15)) < 0.8
    assert cap_at(rules, start + timedelta(seconds=30)) == pytest.approx(0.3)
    assert cap_at(rules, start + timedelta(hours=8, minutes=30)) == 0.8  # next morning
    assert step(0.6, rules, start + timedelta(hours=8)) == 0.6  # leaving never raises


def test_quiet_hours_hold_on_a_dst_night():
    london = ZoneInfo("Europe/London")
    rules = VolumeRules(cap=1.0, quiet=(QuietWindow("00:30", "03:00", 0.2),),
                        time_zone="Europe/London")
    night = datetime(2026, 10, 25, 2, 30, tzinfo=london)  # clocks went back at 02:00
    assert cap_at(rules, night) == pytest.approx(0.2)


# ---- properties ----------------------------------------------------------------------------

modes = st.sampled_from([None, "off", "no_explicit", "clean_only"])
bounds = st.one_of(st.none(), st.floats(min_value=60, max_value=180))
songs_st = st.builds(
    SongFacts, song_id=st.sampled_from(["s1", "s2", "s3"]), title=st.just("T"),
    artist=st.sampled_from(["A", "B feat. C"]), bpm=st.floats(min_value=50, max_value=200),
    energy=st.floats(min_value=0, max_value=1),
    explicit=st.sampled_from(["explicit", "clean", "unknown"]),
    crate_ids=st.frozensets(st.sampled_from(["c1", "c2", "c3"]), max_size=2))


@st.composite
def levels(draw):
    rows = []
    for level, level_id in (("organisation", ORG), ("venue", VENUE), ("zone", ZONE)):
        low, high = draw(bounds), draw(bounds)
        if low is not None and high is not None and low > high:
            low, high = high, low
        crates = draw(st.one_of(st.none(), st.frozensets(st.sampled_from(["c1", "c2", "c3"]),
                                                         min_size=1)))
        rows.append(RuleRow(level, level_id, filter_mode=draw(modes), bpm_min=low, bpm_max=high,
                            crate_ids=crates))
    return rows


daypart_rows = st.builds(
    RuleRow, level=st.just("daypart"), level_id=st.just(ZONE), daypart_id=st.just("d"),
    filter_mode=modes, bpm_min=bounds, energy_max=st.one_of(st.none(), st.floats(0, 1)),
    crate_ids=st.one_of(st.none(), st.frozensets(st.sampled_from(["c1", "c2"]), min_size=1)))


@settings(max_examples=150, deadline=None)
@given(levels(), daypart_rows, songs_st)
def test_a_daypart_only_narrows_its_zone(rows, part, facts):
    """Whatever the organisation, venue and zone refuse, a daypart block never allows (crates
    aside: a block names its own crates, which replace the zone's defaults)."""
    base = allowed(facts, snap(rows), NOW)
    inner = allowed(facts, snap([*rows, part]), NOW, daypart_id="d")
    if not base.allowed and base.rule != "crates":
        assert not inner.allowed


@settings(max_examples=150, deadline=None)
@given(levels(), st.sampled_from(["no_explicit", "clean_only"]), songs_st)
def test_an_organisation_explicit_filter_holds_whatever_venues_and_zones_say(rows, mode, facts):
    org = RuleRow("organisation", ORG, filter_mode=mode)
    if allowed(facts, snap([org]), NOW).rule == "explicit":
        decision = allowed(facts, snap([org, *rows[1:]]), NOW)
        assert not decision.allowed


@settings(max_examples=150, deadline=None)
@given(levels(), songs_st)
def test_answers_are_deterministic_and_refusals_are_named(rows, facts):
    first, second = allowed(facts, snap(rows), NOW), allowed(facts, snap(rows), NOW)
    assert first == second
    if not first.allowed:
        assert first.rule and first.detail


@settings(max_examples=150, deadline=None)
@given(levels(), songs_st, st.sets(st.sampled_from(RELAX_ORDER)))
def test_relaxing_never_admits_a_song_a_hard_rule_refuses(rows, facts, relax):
    strict = allowed(facts, snap(rows), NOW)
    relaxed = allowed(facts, snap(rows), NOW, relax=relax)
    if not strict.allowed and strict.rule in NEVER_RELAX:
        assert not relaxed.allowed and relaxed.rule == strict.rule


def test_two_hundred_thousand_songs_check_without_scanning_the_blocklist():
    entries = [entry("artist", f"Blocked {i}") for i in range(5000)]
    rules = snap(entries=entries)
    started = datetime.now(UTC)
    library = [song(f"s{i}", artist=f"Artist {i % 900}") for i in range(200_000)]
    allowed_count = sum(1 for s in library if allowed(s, rules, NOW).allowed)
    assert allowed_count == 200_000
    assert (datetime.now(UTC) - started).total_seconds() < 30
