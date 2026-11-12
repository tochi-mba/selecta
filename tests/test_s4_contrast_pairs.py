"""S4-0090-05, S4-0090-10 and S4-0091-08: the contrast pair table from tokens.css stays measured."""

from selecta.audit import contrast_pairs as cp


def test_the_table_in_docs_is_up_to_date():
    assert cp.OUT.read_text("utf-8") == cp.markdown(), (
        "run: python -m selecta.audit.contrast_pairs --write"
    )


def test_every_pair_meets_its_minimum_or_is_a_listed_exception():
    assert [f"{p.theme} {p.fg} on {p.bg} {p.ratio}" for p in cp.failures(cp.pairs())] == []


def test_no_exception_is_left_over_after_its_pair_was_fixed():
    assert cp.stale_exceptions(cp.pairs()) == []


def test_both_themes_measure_every_text_status_and_mark_role_on_every_surface():
    found = cp.pairs()
    for theme in ("Dark", "Light"):
        measured = {(p.fg, p.bg) for p in found if p.theme == theme}
        for role in (*cp.TEXT_ROLES, *cp.STATUS_ROLES, *cp.MARK_ROLES):
            for surface in cp.SURFACES:
                assert (role, surface) in measured, f"{theme} {role} on {surface} is unmeasured"
        assert ("--primary-ink", "--primary-fill") in measured


def test_the_system_light_colours_are_the_light_theme_colours():
    # no unmeasured light-mode fallback: matching the computer gives exactly the measured Light
    assert cp.system_light_matches()


def test_statuses_stay_distinct_colours_in_each_theme():
    for name, theme in cp.themes().items():
        colours = [cp.resolve(theme, f"var({role})") for role in cp.DISTINCT_STATUSES]
        assert len(set(colours)) == len(colours), f"{name}: {colours}"
        for i, a in enumerate(colours):
            for b in colours[i + 1 :]:
                # not two near-identical shades a listener could confuse
                assert max(abs(x - y) for x, y in zip(cp._rgb(a), cp._rgb(b), strict=True)) > 0.2


def test_light_status_and_text_colours_differ_from_dark():
    dark, light = cp.themes()["Dark"], cp.themes()["Light"]
    for role in ("--text", "--text-soft", "--status-ready", "--status-warning", "--status-request"):
        assert cp.resolve(dark, f"var({role})") != cp.resolve(light, f"var({role})"), role


def test_disabled_and_caption_text_stay_readable():
    # S4-0091-08: disabled controls are WCAG-exempt, but they must not vanish on any surface
    for p in cp.pairs():
        if p.kind == "disabled (exempt)":
            assert p.ratio >= 2.5, f"{p.theme} disabled text on {p.bg} {p.ratio}"
    for p in cp.pairs():
        if p.fg == "--text-soft" and p.kind == "text":
            assert p.ratio >= 4.5, f"{p.theme} caption text on {p.bg} {p.ratio}"


def test_a_failing_pair_is_reported(tmp_path):
    css = cp.TOKENS.read_text("utf-8").replace("--soft: #a8a292;", "--soft: #3b382f;", 1)
    bad = cp.failures(cp.pairs(css))
    assert any(p.fg == "--text-soft" and p.theme == "Dark" for p in bad)
