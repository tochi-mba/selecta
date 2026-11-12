"""S4-0090-10: the contrast pair table, worked out from web/src/styles/tokens.css.

Every foreground role is measured against every surface it can sit on, in Dark and in Light, with
WCAG 2.2 relative luminance. Text needs 4.5:1, non-text marks (control edges, focus, selection,
artwork) need 3:1, and decoration and disabled controls are listed for information only. A pair
below its minimum must appear in EXCEPTIONS with a reason, and the owner reviews that list.

    python -m selecta.audit.contrast_pairs --write   # regenerate docs/verification/s4-contrast-pairs.md
    python -m selecta.audit.contrast_pairs --check   # exit 1 when the table is out of date or failing

Read-only apart from --write.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TOKENS = ROOT / "web" / "src" / "styles" / "tokens.css"
OUT = ROOT / "docs" / "verification" / "s4-contrast-pairs.md"

DARK_HEAD = ":root {"
LIGHT_HEAD = ":root[data-theme='light'] {"
SYSTEM_LIGHT_HEAD = ":root:not([data-theme='dark']) {"
# style.css: button:disabled { opacity: 0.42 }
DISABLED_OPACITY = 0.42

SURFACES = ("--surface-base", "--surface-raised", "--surface-control", "--surface-overlay")
TEXT_ROLES = ("--text", "--text-soft", "--link")
STATUS_ROLES = (
    "--status-ready",
    "--status-working",
    "--status-planned",
    "--status-warning",
    "--status-failed",
    "--status-recovering",
    "--status-request",
    "--danger",
)
MARK_ROLES = (
    "--edge-interactive",
    "--edge-focus",
    "--edge-selected",
    "--edge-error",
    "--edge-overlay",
    "--motif",
)
# statuses a listener has to tell apart at a glance (S4-0090-05)
DISTINCT_STATUSES = ("--status-ready", "--status-warning", "--status-request", "--status-working")

# (theme, foreground, background) -> why it may stay below its minimum. The owner reviews this list.
EXCEPTIONS: dict[tuple[str, str, str], str] = {}


@dataclass(frozen=True)
class Pair:
    theme: str
    kind: str
    fg: str
    bg: str
    fg_hex: str
    bg_hex: str
    ratio: float
    minimum: float | None

    @property
    def passes(self) -> bool:
        return self.minimum is None or self.ratio >= self.minimum

    @property
    def exception(self) -> str | None:
        return EXCEPTIONS.get((self.theme, self.fg, self.bg))


def _strip(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def block(css: str, head: str) -> dict[str, str]:
    """The custom properties declared directly in the first block that starts with `head`."""
    start = css.index(head)
    depth = 0
    end = start
    for i in range(css.index("{", start), len(css)):
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    body = _strip(css[start:end])
    return {m[1]: m[2].strip() for m in re.finditer(r"(--[a-z0-9-]+):\s*([^;]+);", body)}


def themes(css: str | None = None) -> dict[str, dict[str, str]]:
    css = css if css is not None else TOKENS.read_text("utf-8")
    dark = block(css, DARK_HEAD)
    return {"Dark": dark, "Light": {**dark, **block(css, LIGHT_HEAD)}}


def _rgb(value: str) -> tuple[float, float, float]:
    clean = value.lstrip("#")
    return tuple(int(clean[i : i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def _hex(rgb: tuple[float, ...]) -> str:
    return "#" + "".join(f"{round(c * 255):02x}" for c in rgb)


def resolve(theme: dict[str, str], value: str) -> str | None:
    """A var() chain or `color-mix(in srgb, A N%, B)` as #rrggbb; None when it involves transparency."""
    v = value.strip()
    ref = re.fullmatch(r"var\((--[a-z0-9-]+)\)", v)
    if ref:
        return resolve(theme, theme[ref[1]])
    mix = re.fullmatch(r"color-mix\(in srgb, (.+?) (\d+)%, (.+)\)", v)
    if mix:
        a, b = resolve(theme, mix[1]), resolve(theme, mix[3])
        if a is None or b is None:
            return None
        t = int(mix[2]) / 100
        return _hex(tuple(x * t + y * (1 - t) for x, y in zip(_rgb(a), _rgb(b), strict=True)))
    if re.fullmatch(r"#[0-9a-fA-F]{6}", v):
        return v.lower()
    return None


def luminance(value: str) -> float:
    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (lin(c) for c in _rgb(value))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: str, b: str) -> float:
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def over(fg: str, bg: str, alpha: float) -> str:
    return _hex(tuple(f * alpha + b * (1 - alpha) for f, b in zip(_rgb(fg), _rgb(bg), strict=True)))


def pairs(css: str | None = None) -> list[Pair]:
    found: list[Pair] = []
    for name, theme in themes(css).items():

        def add(kind: str, fg: str, bg: str, minimum: float | None, alpha: float = 1.0) -> None:
            fg_hex, bg_hex = resolve(theme, f"var({fg})"), resolve(theme, f"var({bg})")
            if fg_hex is None or bg_hex is None:
                return
            shown = over(fg_hex, bg_hex, alpha) if alpha < 1 else fg_hex
            ratio = round(contrast(shown, bg_hex), 2)
            found.append(Pair(name, kind, fg, bg, shown, bg_hex, ratio, minimum))

        for surface in (*SURFACES, "--surface-selected"):
            for role in TEXT_ROLES:
                add("text", role, surface, 4.5)
        for surface in SURFACES:
            for role in STATUS_ROLES:
                add("status text", role, surface, 4.5)
            for role in MARK_ROLES:
                add("non-text mark", role, surface, 3.0)
            add("decoration", "--edge-decorative", surface, None)
        add("action", "--primary-ink", "--primary-fill", 4.5)
        for surface in SURFACES:
            add("action edge", "--primary-edge", surface, 3.0)
        if resolve(theme, "var(--word-fill)") is not None:
            add("action", "--word-ink", "--word-fill", 4.5)
        else:
            for surface in SURFACES:
                add("action", "--word-ink", surface, 4.5)
        for surface in ("--surface-control", "--surface-base"):
            add("disabled (exempt)", "--text", surface, None, DISABLED_OPACITY)
    return found


def failures(found: list[Pair]) -> list[Pair]:
    return [p for p in found if not p.passes and p.exception is None]


def stale_exceptions(found: list[Pair]) -> list[tuple[str, str, str]]:
    failing = {(p.theme, p.fg, p.bg) for p in found if not p.passes}
    return [key for key in EXCEPTIONS if key not in failing]


def system_light_matches(css: str | None = None) -> bool:
    """The light colours used when the computer asks for light equal the ones Light chooses."""
    css = css if css is not None else TOKENS.read_text("utf-8")
    return block(css, SYSTEM_LIGHT_HEAD) == block(css, LIGHT_HEAD)


def markdown(css: str | None = None) -> str:
    found = pairs(css)
    lines = [
        "# Selecta 4.0 contrast pair table (S4-0090-10)",
        "",
        "Generated from `web/src/styles/tokens.css` by "
        "`python -m selecta.audit.contrast_pairs --write`; `tests/test_s4_contrast_pairs.py` fails "
        "when it falls behind or a pair drops below its minimum without a listed exception.",
        "",
        "Minimums: text 4.5:1, non-text marks 3:1 (WCAG 2.2 1.4.3 and 1.4.11). Decoration and "
        f"disabled controls (text at opacity {DISABLED_OPACITY}) are WCAG-exempt and shown for "
        "information. The system-light block equals the Light block: "
        f"{'yes' if system_light_matches(css) else 'NO'}.",
        "",
        "## Exceptions for owner review",
        "",
    ]
    excepted = [p for p in found if p.exception]
    if excepted:
        lines += [f"- {p.theme} `{p.fg}` on `{p.bg}` {p.ratio}:1: {p.exception}" for p in excepted]
    else:
        lines.append("None: every measured pair meets its minimum.")
    lines.append("")
    for name in ("Dark", "Light"):
        lines += [
            f"## {name}",
            "",
            "| Kind | Foreground | Background | Colours | Ratio | Minimum | Result |",
            "|---|---|---|---|---|---|---|",
        ]
        for p in (p for p in found if p.theme == name):
            minimum = f"{p.minimum}:1" if p.minimum else "none"
            result = "pass" if p.passes else ("exception" if p.exception else "FAIL")
            if p.minimum is None:
                result = "info"
            lines.append(
                f"| {p.kind} | `{p.fg}` | `{p.bg}` | {p.fg_hex} on {p.bg_hex} | {p.ratio}:1 "
                f"| {minimum} | {result} |"
            )
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--write", action="store_true")
    group.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    text = markdown()
    if args.write:
        OUT.write_text(text, "utf-8", newline="\n")
        print(f"wrote {OUT.relative_to(ROOT)}")
    bad = failures(pairs())
    for p in bad:
        print(f"FAIL {p.theme} {p.fg} on {p.bg}: {p.ratio}:1 < {p.minimum}:1")
    if args.check and (not OUT.exists() or OUT.read_text("utf-8") != text):
        print(f"{OUT.relative_to(ROOT)} is out of date; run with --write")
        return 1
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
