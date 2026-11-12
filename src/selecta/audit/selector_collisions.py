"""S4-0091-04: the selector-collision inventory of the shared stylesheets.

Reads the sheets web/src/main.tsx loads, in load order, and lists (1) every selector written
identically in more than one sheet and (2) every class styled by more than one sheet, each with a
proposed canonical owner: the earliest-loaded sheet that styles the class as the subject of a rule
without a feature scope in front of it, else the earliest sheet that styles it at all. The
hand-written verdicts for the seven shared class names stay in docs/adr/completion/css-ownership.md.

    python -m selecta.audit.selector_collisions --write
    python -m selecta.audit.selector_collisions --check

The write command regenerates ``docs/verification/s4-selector-collisions.md``.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / "web" / "src"
OUT = ROOT / "docs" / "verification" / "s4-selector-collisions.md"
IMPORT = re.compile(r"^import '\./(.+?\.css)';", re.M)


def load_order() -> list[str]:
    sheets = IMPORT.findall((WEB / "main.tsx").read_text("utf-8"))
    return [s for s in sheets if s != "styles/tokens.css"]


def _rules(css: str) -> list[str]:
    """Every selector (one per comma part) of every style rule, at-rule wrappers included."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    found: list[str] = []
    for match in re.finditer(r"([^{}@;]+)\{", css):
        head = match.group(1).strip()
        if not head or head.startswith(("from", "to")) or re.fullmatch(r"[\d.%\s,]+", head):
            continue
        found += [" ".join(part.split()) for part in _split(head) if part.strip()]
    return found


def _split(head: str) -> list[str]:
    parts, depth, start = [], 0, 0
    for i, ch in enumerate(head):
        depth += ch == "("
        depth -= ch == ")"
        if ch == "," and depth == 0:
            parts.append(head[start:i])
            start = i + 1
    parts.append(head[start:])
    return parts


def _subject(selector: str) -> str:
    return re.split(r"\s*[ >+~]\s*", selector.strip())[-1]


def inventory() -> tuple[dict[str, list[str]], dict[str, list[str]], dict[str, str]]:
    order = load_order()
    selectors: dict[str, list[str]] = defaultdict(list)
    classes: dict[str, list[str]] = defaultdict(list)
    unscoped: dict[str, list[str]] = defaultdict(list)
    for sheet in order:
        seen_sel: set[str] = set()
        seen_cls: set[str] = set()
        for selector in _rules((WEB / sheet).read_text("utf-8")):
            if selector not in seen_sel:
                seen_sel.add(selector)
                selectors[selector].append(sheet)
            for name in re.findall(r"\.([A-Za-z_][\w-]*)", selector):
                if name not in seen_cls:
                    seen_cls.add(name)
                    classes[name].append(sheet)
            subject = _subject(selector)
            if subject == selector:
                for name in re.findall(r"^\.([A-Za-z_][\w-]*)", subject):
                    if sheet not in unscoped[name]:
                        unscoped[name].append(sheet)
    repeated_sel = {s: sheets for s, sheets in selectors.items() if len(sheets) > 1}
    repeated_cls = {c: sheets for c, sheets in classes.items() if len(sheets) > 1}
    owners = {c: (unscoped.get(c) or sheets)[0] for c, sheets in repeated_cls.items()}
    return repeated_sel, repeated_cls, owners


def markdown() -> str:
    repeated_sel, repeated_cls, owners = inventory()
    lines = [
        "# Selecta 4.0 selector-collision inventory (S4-0091-04)",
        "",
        "Generated from the sheets `web/src/main.tsx` loads by "
        "`python -m selecta.audit.selector_collisions --write`; "
        "`tests/test_s4_selector_collisions.py` fails when it falls behind. Load order: "
        + ", ".join(f"`{s}`" for s in load_order())
        + ". The proposed owner is the earliest sheet that styles the class unscoped, else the "
        "earliest that styles it. Verdicts for the seven shared class names are in "
        "`docs/adr/completion/css-ownership.md`. Rules inside media queries count, so a "
        "responsive refinement shows here too; each row is for review, not a defect.",
        "",
        f"## Identical selectors in more than one sheet ({len(repeated_sel)})",
        "",
        "| Selector | Sheets, in load order | Wins the cascade |",
        "|---|---|---|",
    ]
    for selector in sorted(repeated_sel):
        sheets = repeated_sel[selector]
        shown = selector.replace("|", "\\|")
        lines.append(f"| `{shown}` | {', '.join(sheets)} | {sheets[-1]} |")
    lines += [
        "",
        f"## Classes styled by more than one sheet ({len(repeated_cls)})",
        "",
        "| Class | Sheets, in load order | Proposed owner |",
        "|---|---|---|",
    ]
    for name in sorted(repeated_cls):
        lines.append(f"| `.{name}` | {', '.join(repeated_cls[name])} | {owners[name]} |")
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
        return 0
    if not OUT.exists() or OUT.read_text("utf-8") != text:
        print(f"{OUT.relative_to(ROOT)} is out of date; run with --write")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
