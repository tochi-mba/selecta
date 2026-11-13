"""The venue's look on the guest page, and the accent colour's contrast check (ADR-0451).

The accent colour fills two things only: the header band (the venue's name sits on it) and the
primary button (its label sits on it). The text on the accent is one of the two ink colours the
standard tokens already use (`web/src/styles/tokens.css`: the dark theme's `--accent-ink`
#14140a and the light theme's #f5f2e9). The page picks whichever ink reads better on the accent
and uses that same ink in both themes, because the band and the button keep the accent fill in
both. The colour is used only when that text reaches 4.5:1 in the light theme and the dark
theme; otherwise the guest page keeps the standard tokens and the manager is told why, in words.

Theme values (tokens.css):
- dark: background --bg #100f0c, accent ink #14140a
- light: background --bg #f5f2e9, accent ink #f5f2e9
"""

from __future__ import annotations

import re
from dataclasses import dataclass

MIN_CONTRAST = 4.5
THEMES = {
    "dark": {"bg": "#100f0c", "ink": "#14140a"},
    "light": {"bg": "#f5f2e9", "ink": "#f5f2e9"},
}
INKS = ("#14140a", "#f5f2e9")
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def _channel(value: int) -> float:
    c = value / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(colour: str) -> float:
    r, g, b = (int(colour[i : i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * _channel(r) + 0.7152 * _channel(g) + 0.0722 * _channel(b)


def contrast(first: str, second: str) -> float:
    a, b = sorted((luminance(first), luminance(second)), reverse=True)
    return (a + 0.05) / (b + 0.05)


def is_colour(text: object) -> bool:
    return isinstance(text, str) and bool(_HEX.match(text))


@dataclass(frozen=True)
class AccentDecision:
    used: bool
    accent: str | None  # lowercase #rrggbb when used
    ink: str | None
    ratios: dict[str, float]  # per theme, text on the accent
    reason: str | None  # for the manager when the accent isn't used


def check_accent(colour: str | None) -> AccentDecision:
    if colour is None:
        return AccentDecision(False, None, None, {}, None)
    if not is_colour(colour):
        return AccentDecision(
            False, None, None, {}, "Pick a colour as #RRGGBB, for example #1d4ed8."
        )
    colour = colour.lower()
    ink = max(INKS, key=lambda candidate: contrast(colour, candidate))
    ratios = {theme: round(contrast(colour, ink), 2) for theme in THEMES}
    if min(ratios.values()) >= MIN_CONTRAST:
        return AccentDecision(True, colour, ink, ratios, None)
    best = min(ratios.values())
    return AccentDecision(
        False, None, None, ratios,
        f"Text on {colour} only reaches {best}:1 contrast; it needs 4.5:1 in the light and "
        "dark themes to stay readable, so the guest page uses the standard colours. Try a "
        "darker or lighter shade.",
    )


def guest_branding(
    *, venue_name: str, zone_name: str, logo_url: str | None, welcome: str | None,
    accent: str | None, branding_on: bool,
) -> dict:
    """What the guest page shows about the venue. Without the branding flag, names only."""
    shown: dict = {"venue_name": venue_name, "zone_name": zone_name, "footer": "Powered by SelectaDJ"}
    if not branding_on:
        return {**shown, "logo_url": None, "welcome": None, "accent": None, "accent_ink": None}
    decision = check_accent(accent)
    return {
        **shown,
        "logo_url": logo_url,
        "welcome": welcome,
        "accent": decision.accent,
        "accent_ink": decision.ink,
    }


__all__ = ["AccentDecision", "check_accent", "contrast", "guest_branding", "luminance"]
