"""Lyric display is off by default in cloud mode and the pages close up (SC-0406-03, ADR-0406).

`lyrics.display` carries `cloud_default: false`. In a cloud context every flag that shows lyric
text (and anything that needs one) decides off, so the site, which hides whatever its flags say
is off, closes up around them; lookups stay on for internal use. Local mode is untouched: its
build states are the same with or without the field.
"""

from __future__ import annotations

import dataclasses

from selecta import flags
from selecta.flags import targeting
from selecta.flags.matching import Context, RuleSnapshot

DISPLAY = "lyrics.display"


def needs(flag_id: str) -> set[str]:
    """Every flag that, directly or through others, requires `flag_id`."""
    found, stack = set(), [flag_id]
    while stack:
        current = stack.pop()
        for flag in flags.registry().values():
            if current in flag.requires and flag.id not in found:
                found.add(flag.id)
                stack.append(flag.id)
    return found


def every_decision(mode: str, build: str = "") -> targeting.Decisions:
    registry = flags.registry()
    return targeting.decide_all(
        Context(mode=mode, workspace_id="w", user_id="u"),
        build_states=flags.resolve(build), rules=RuleSnapshot(), entitled=registry,
        plan_gated=(), registry=registry,
    )


def test_in_the_cloud_every_lyric_surface_is_off_and_lookup_stays_on():
    cloud = every_decision("cloud")
    shown = needs(DISPLAY)
    assert {"listen.lyrics", "listen.stage", "listen.word_focus", "discover.word_links"} <= shown
    assert not cloud.on(DISPLAY)
    assert [flag for flag in shown if cloud.on(flag)] == []
    assert cloud.on("lyrics.lookup")
    surfaces = {s for flag in shown for s in flags.registry()[flag].surfaces}
    assert {"listen", "stage", "discover.words"} <= surfaces, "the reflow sweep must cover these"


def test_local_mode_shows_lyrics_exactly_as_before():
    local = every_decision("local")
    assert local.on(DISPLAY) and all(local.on(flag) for flag in needs(DISPLAY))
    plain = {flag_id: dataclasses.replace(flag, cloud_default=None)
             for flag_id, flag in flags.registry().items()}
    assert flags.resolve("", plain) == flags.resolve("")


def test_a_rule_cannot_switch_unlicensed_display_on_only_the_build_can():
    from selecta.flags.matching import Rule, RuleKind

    registry = flags.registry()
    ctx = Context(mode="cloud", workspace_id="w", user_id="u")
    allow = RuleSnapshot(1, {DISPLAY: (Rule(RuleKind.WORKSPACES, {"ids": ["w"], "on": True}),)})
    ruled = targeting.decide(DISPLAY, ctx, build_states=flags.resolve(""), rules=allow,
                             entitled=registry, plan_gated=(), registry=registry)
    assert not ruled.on
    assert every_decision("cloud", f"+{DISPLAY}").on("listen.lyrics")


def test_cloud_default_must_be_true_or_false():
    flag = dataclasses.replace(flags.registry()[DISPLAY], cloud_default="no")
    assert any("cloud_default" in problem for problem in flags.problems({DISPLAY: flag}))
