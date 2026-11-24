"""Inventory the screens and dialogs in web/src and which of the five states each shows (product
audit, area L inventory 2).

    uv run python scripts/audit/screens.py > build/screens.md

A screen is a .tsx file (not a test) in one of the page folders that renders a page, a panel, a
card or a dialog. For each, the source is searched for signs of the five states: loading
(Skeleton, aria-busy, "Loading" or "…"), empty (an empty-state component or "No …" / "nothing"
words), error (Problem, role="alert", an error state), offline (useNeedsConnection, offline
words, isOnline) and flag-off (flagOn or accountFlagOn). They are leads for a person to check,
not proof: a "-" means nothing was found in the file itself (a parent may still handle it).
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "web" / "src"
FOLDERS = ("cloud", "views", "admin", "business", "venueops", "autopilot", "kiosk", "guest",
           "display", "rooms", "lucy", "shell", "devices")
SIGNS = {
    "loading": re.compile(r"Skeleton|aria-busy|Loading|Opening…|Checking…|GateLoading|…'"),
    "empty": re.compile(r"Empty|EmptyState|>No |'No |\"No |nothing (yet|here)|Nothing (yet|here)"),
    "error": re.compile(
        r"<Problem|role=\"alert\"|role='alert'|setError|error &&|Notice tone=\"danger\""
    ),
    "offline": re.compile(r"useNeedsConnection|offline|isOnline|ConnectionBanner|needs-connection",
                          re.I),
    "flag-off": re.compile(r"flagOn\(|accountFlagOn\(|useFlags\("),
}
SCREEN = re.compile(
    r"<(main|section|Dialog|ConfirmDialog|SettingsCard|Drawer)\b|className=\"(page|panel)"
)


def main() -> None:
    rows = []
    for folder in FOLDERS:
        for path in sorted((ROOT / folder).rglob("*.tsx")):
            if ".test." in path.name or "gallery" in path.parts:
                continue
            text = path.read_text(encoding="utf-8")
            if not SCREEN.search(text):
                continue
            marks = ["yes" if sign.search(text) else "-" for sign in SIGNS.values()]
            rows.append((str(path.relative_to(ROOT)).replace("\\", "/"), *marks))
    print("| Screen | " + " | ".join(SIGNS) + " |")
    print("|---|" + "---|" * len(SIGNS))
    for row in rows:
        print("| " + " | ".join(row) + " |")
    print()
    missing = {name: sum(row[index + 1] == "-" for row in rows) for index, name in enumerate(SIGNS)}
    print(f"Totals: {len(rows)} screens; with no sign in their own file: "
          + ", ".join(f"{name} {count}" for name, count in missing.items()) + ".")


if __name__ == "__main__":
    main()
