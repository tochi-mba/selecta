"""GP-0257-04: what code can measure about low-light comfort in both themes.

Contrast minimums for every text, status and mark role are checked by
tests/test_s4_contrast_pairs.py. These tests add the low-light side worked out from
web/src/styles/tokens.css: in the dark theme no surface glows like a lamp, the reading text is
not pure white at the maximum 21:1 (which halates on a dark screen), and every colour stays warm
rather than blue. How tired eyes feel after an evening on a real display still needs a person.
"""

from selecta.audit import contrast_pairs as c

THEMES = c.themes()
DARK = THEMES["Dark"]
LIGHT = THEMES["Light"]


def colour(theme: dict[str, str], token: str) -> str:
    value = c.resolve(theme, theme[token])
    assert value, token
    return value


def rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def test_no_dark_surface_glows_in_a_dark_room() -> None:
    for token in c.SURFACES:
        assert c.luminance(colour(DARK, token)) <= 0.03, token


def test_dark_surfaces_keep_their_depth_order() -> None:
    levels = [c.luminance(colour(DARK, token)) for token in c.SURFACES]
    assert levels == sorted(levels)


def test_dark_reading_text_is_readable_but_not_glaring_white() -> None:
    text = colour(DARK, "--text")
    assert text.lower() not in ("#ffffff", "#fff")
    ratio = c.contrast(text, colour(DARK, "--surface-base"))
    assert 7 <= ratio <= 18, ratio


def test_both_themes_stay_warm_rather_than_blue() -> None:
    for name, theme in THEMES.items():
        for token in c.SURFACES + ("--text", "--text-soft"):
            red, _, blue = rgb(colour(theme, token))
            assert red >= blue, f"{name} {token}"


def test_no_light_surface_is_pure_white_glare() -> None:
    for token in c.SURFACES:
        assert colour(LIGHT, token).lower() not in ("#ffffff", "#fff"), token
