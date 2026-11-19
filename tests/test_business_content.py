"""Content controls edge cases under their ADR-0454 names (BZ-0454-03).

They run the real ADR-0450 engine (`content.engine`, `content.pool`, `content.volume`,
`content.tags`) and the daypart bridge (`dayparts.bridge_or_echo`). Where the BZ-0450 suite
already holds exactly the same check, the named test runs that check and says which.
"""

from __future__ import annotations

import ast
from pathlib import Path

import test_business_content_engine as ce
from test_business_content_engine import NOW, ZONE, entry, snap, song

from selecta.business.content.engine import RuleRow, allowed
from selecta.business.content.names import artist_variants
from selecta.business.content.pool import effective_pool, horizon_after_change
from selecta.business.content.tags import merge_tag_reading
from selecta.business.dayparts import bridge_or_echo

ROOT = Path(__file__).resolve().parents[1]


def test_conflicting_advisory_tags_give_unknown(tmp_path):
    """An advisory frame saying both explicit and clean reads as unknown (BZ-0450-02 check)."""
    from test_business_content_tags import mp3

    from selecta.business.content.tags import explicit_from_tags

    assert explicit_from_tags(mp3(tmp_path, ["1", "2"])) == "unknown"
    assert explicit_from_tags(mp3(tmp_path, ["1"])) == "explicit"


def test_manual_flag_survives_reupload():
    """A person's mark is kept when the re-uploaded file's tags say otherwise; a tag only fills
    in or updates an earlier tag."""
    for source in ("manual", "bulk", "import"):
        assert merge_tag_reading("clean", source, "explicit") is None
    assert merge_tag_reading("clean", "tag", "explicit") == ("explicit", "tag")


def test_clean_only_refuses_unknown():
    rules = snap([RuleRow("venue", "venue", filter_mode="clean_only")])
    assert allowed(song(explicit="unknown"), rules, NOW).rule == "explicit"
    assert allowed(song(explicit="clean"), rules, NOW).allowed


def test_blocked_artist_variants_are_all_refused():
    names = ["Beyonce", "Beyoncé", "Beyoncé feat. Jay-Z", "BEYONCE"]
    rules = snap(entries=[entry("artist", "beyonce")])
    for name in artist_variants("beyonce", names):
        assert allowed(song(artist=name), rules, NOW).rule == "blocklist_artist", name
    assert allowed(song(artist="Solange"), rules, NOW).allowed


def test_lower_scope_cannot_reallow_a_higher_block():
    organisation = RuleRow("organisation", "org", filter_mode="clean_only")
    zone_says_off = RuleRow("zone", ZONE, filter_mode="off")
    assert allowed(song(explicit="explicit"), snap([organisation, zone_says_off]),
                   NOW).rule == "explicit"
    blocked = entry("song", "s1", level="organisation", level_id="org")
    assert allowed(song(), snap([RuleRow("zone", ZONE)], [blocked]), NOW).rule == \
        "blocklist_song"


def test_relaxation_never_admits_a_refused_song():
    ce.test_relaxing_never_admits_explicit_blocked_or_out_of_crate_songs()


def test_save_that_empties_a_block_is_refused():
    ce.test_a_save_that_empties_a_block_is_refused_and_a_short_one_warns()


def test_tighten_while_kiosk_offline_applies_before_next_song_on_reconnect():
    ce.test_offline_kiosks_tighten_at_once_and_loosen_only_after_reconnect()
    facts = {s.song_id: s for s in (song("a"), song("b"), song("c"))}
    tighter = snap(entries=[entry("song", "b")], version=2)
    after = horizon_after_change(["a", "b", "c"], tighter, facts=facts, at=NOW, playing_id="a")
    assert after.keep == ("c",) or "b" not in after.keep  # b never reaches the speaker
    assert ("b", "blocklist_song") in after.dropped


def test_override_cannot_lift_clean_only():
    ce.test_an_override_never_lifts_clean_only()


def test_lucy_cannot_suggest_or_apply_a_blocked_song():
    """Lucy has no tool that reaches a business zone's queue: a business zone plays only what
    the zone planner draws from the content engine's effective pool, which never holds a
    refused song. If Lucy is ever given a business tool, this test fails until it goes through
    the same gate."""
    for path in (ROOT / "src" / "selecta" / "lucy").glob("*.py"):
        tree = ast.parse(path.read_text("utf-8"))
        imported = {node.module for node in ast.walk(tree)
                    if isinstance(node, ast.ImportFrom) and node.module}
        assert not any(name.startswith(("selecta.business", "selecta.playback.zone"))
                       for name in imported), path.name
    pool = effective_pool([song("ok"), song("bad", artist="Nope")],
                          snap(entries=[entry("artist", "Nope")]), NOW)
    assert [s.song_id for s in pool.songs] == ["ok"]


def test_bridge_songs_obey_the_rules():
    old_block = snap([RuleRow("zone", ZONE, filter_mode="off")], version=1)
    new_block = snap([RuleRow("zone", ZONE, filter_mode="clean_only")], version=2)
    library = [song("x", explicit="explicit"), song("y", explicit="clean"), song("z")]
    old_pool = [s.song_id for s in effective_pool(library, old_block, NOW).songs]
    new_pool = [s.song_id for s in effective_pool(library, new_block, NOW).songs]
    assert "x" in old_pool and "x" not in new_pool

    def compatible(a: str, b: str) -> bool:
        return (a, b) in {("x", "x"), ("x", "y"), ("y", "z")}

    kind, path = bridge_or_echo(["x"], [s for s in new_pool if s != "y"], compatible,
                                bridges=[s for s in old_pool if s in new_pool])
    assert kind == "bridge" and path == ("x", "y", "z")
    assert all(allowed(next(s for s in library if s.song_id == sid), new_block, NOW).allowed
               for sid in path[1:])


def test_quiet_hours_ramp_down_over_thirty_seconds():
    ce.test_staff_volume_is_held_to_the_cap_and_quiet_hours_ramp_down_over_thirty_seconds()
