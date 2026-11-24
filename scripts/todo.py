"""The repo's to-do list: one small Markdown file per item under `docs/todo/items/`.

One file per item means two people (or agents) adding or closing items at the same time never
edit the same file, so there is nothing to merge. Run from the repo root:

    python scripts/todo.py add "Title" --area lucy --priority high --who claude --source "..."
    python scripts/todo.py list [--status open] [--area lucy] [--who owner]
    python scripts/todo.py done T-20261124-a1b2 --commit abc1234 [--note "..."]
    python scripts/todo.py set T-20261124-a1b2 --status doing
    python scripts/todo.py check

`check` is what the test runs: every file parses, ids match file names, and every value is one
the lists below allow. docs/todo/README.md explains the fields.
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ITEMS = ROOT / "docs" / "todo" / "items"

STATUSES = ("open", "doing", "blocked", "done", "dropped")
PRIORITIES = ("now", "high", "normal", "later")
WHO = ("claude", "owner", "either")
AREAS = (
    "admin",
    "billing",
    "branding",
    "ci",
    "devices",
    "docs",
    "editor",
    "infra",
    "legal",
    "library",
    "local-app",
    "lucy",
    "rooms",
    "security",
    "shell",
    "storage",
)
FIELDS = ("id", "title", "area", "status", "priority", "who", "created", "source", "commit")
ID = re.compile(r"T-\d{8}-[0-9a-f]{4}")
PRIORITY_ORDER = {name: place for place, name in enumerate(PRIORITIES)}


def parse(path: Path) -> tuple[dict[str, str], str]:
    """An item's fields and its free-text body. The header is plain `key: value` lines between
    two `---` lines, so it needs no YAML library."""
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError(f"{path.name}: the first line must be ---")
    try:
        end = lines.index("---", 1)
    except ValueError as problem:
        raise ValueError(f"{path.name}: the header has no closing ---") from problem
    fields: dict[str, str] = {}
    for line in lines[1:end]:
        if not line.strip():
            continue
        key, colon, value = line.partition(":")
        if not colon:
            raise ValueError(f"{path.name}: '{line}' is not 'key: value'")
        fields[key.strip()] = value.strip()
    return fields, "\n".join(lines[end + 1 :]).strip()


def render(fields: dict[str, str], body: str) -> str:
    header = "\n".join(f"{key}: {fields.get(key, '')}".rstrip() for key in FIELDS)
    return f"---\n{header}\n---\n\n{body.strip()}\n"


def problems(path: Path) -> list[str]:
    try:
        fields, body = parse(path)
    except ValueError as problem:
        return [str(problem)]
    found = []
    name = path.name
    for key in ("id", "title", "area", "status", "priority", "who", "created"):
        if not fields.get(key):
            found.append(f"{name}: '{key}' is missing")
    unknown = sorted(set(fields) - set(FIELDS))
    if unknown:
        found.append(f"{name}: unknown field(s) {', '.join(unknown)}")
    item_id = fields.get("id", "")
    if item_id and not ID.fullmatch(item_id):
        found.append(f"{name}: id '{item_id}' is not T-YYYYMMDD-xxxx")
    if item_id and not name.startswith(item_id + "-"):
        found.append(f"{name}: the file name must start with its id '{item_id}-'")
    for key, allowed in (("status", STATUSES), ("priority", PRIORITIES), ("who", WHO)):
        value = fields.get(key)
        if value and value not in allowed:
            found.append(f"{name}: {key} '{value}' is not one of {', '.join(allowed)}")
    if fields.get("area") and fields["area"] not in AREAS:
        found.append(f"{name}: area '{fields['area']}' is not one of {', '.join(AREAS)}")
    if fields.get("status") == "done" and not (fields.get("commit") or body):
        found.append(f"{name}: a done item needs a commit or a note saying how it was settled")
    if "—" in path.read_text(encoding="utf-8"):
        found.append(f"{name}: has an em dash")
    return found


def every_item() -> list[Path]:
    return sorted(ITEMS.glob("T-*.md")) if ITEMS.is_dir() else []


def find(item_id: str) -> Path:
    matches = [path for path in every_item() if path.name.startswith(item_id)]
    if len(matches) != 1:
        sys.exit(f"{item_id}: found {len(matches)} items, need exactly one")
    return matches[0]


def slug(title: str) -> str:
    words = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return words[:48].rstrip("-") or "item"


def add(args: argparse.Namespace) -> None:
    ITEMS.mkdir(parents=True, exist_ok=True)
    today = dt.date.today()
    item_id = f"T-{today:%Y%m%d}-{secrets.token_hex(2)}"
    fields = {
        "id": item_id,
        "title": args.title,
        "area": args.area,
        "status": "open",
        "priority": args.priority,
        "who": args.who,
        "created": today.isoformat(),
        "source": args.source or "",
        "commit": "",
    }
    path = ITEMS / f"{item_id}-{slug(args.title)}.md"
    path.write_text(render(fields, args.body or ""), encoding="utf-8", newline="\n")
    print(path.relative_to(ROOT).as_posix())


def change(args: argparse.Namespace, status: str | None) -> None:
    path = find(args.id)
    fields, body = parse(path)
    if status:
        fields["status"] = status
    for key in ("priority", "who", "area"):
        value = getattr(args, key, None)
        if value:
            fields[key] = value
    if getattr(args, "commit", None):
        fields["commit"] = args.commit
    if getattr(args, "note", None):
        body = f"{body}\n\n{dt.date.today().isoformat()}: {args.note}".strip()
    path.write_text(render(fields, body), encoding="utf-8", newline="\n")
    print(f"{fields['id']}: {fields['status']}")


def listing(args: argparse.Namespace) -> None:
    rows = []
    for path in every_item():
        fields, _ = parse(path)
        if args.status == "active" and fields["status"] in ("done", "dropped"):
            continue
        if args.status not in ("active", "all") and fields["status"] != args.status:
            continue
        if args.area and fields["area"] != args.area:
            continue
        if args.who and fields["who"] != args.who:
            continue
        rows.append(fields)
    rows.sort(key=lambda row: (PRIORITY_ORDER.get(row["priority"], 9), row["area"], row["id"]))
    for row in rows:
        print(
            f"{row['id']}  {row['priority']:<6} {row['status']:<7} {row['who']:<6} "
            f"{row['area']:<9} {row['title']}"
        )
    print(f"{len(rows)} item(s)")


def check(_: argparse.Namespace) -> None:
    found = [line for path in every_item() for line in problems(path)]
    ids = [parse(path)[0].get("id") for path in every_item() if not problems(path)]
    found += [f"id {one} is used twice" for one in sorted({i for i in ids if ids.count(i) > 1})]
    for line in found:
        print(line)
    if found:
        sys.exit(1)
    print(f"{len(every_item())} item(s), all well formed")


def main() -> None:
    parser = argparse.ArgumentParser(description="The repo's to-do list.")
    commands = parser.add_subparsers(dest="command", required=True)

    new = commands.add_parser("add", help="add an item")
    new.add_argument("title")
    new.add_argument("--area", required=True, choices=AREAS)
    new.add_argument("--priority", default="normal", choices=PRIORITIES)
    new.add_argument("--who", default="claude", choices=WHO)
    new.add_argument("--source", help="where it came from: a doc, a walkthrough, a PR")
    new.add_argument("--body", help="what is wrong and what good looks like")
    new.set_defaults(run=add)

    show = commands.add_parser("list", help="list items")
    show.add_argument("--status", default="active", choices=(*STATUSES, "active", "all"))
    show.add_argument("--area", choices=AREAS)
    show.add_argument("--who", choices=WHO)
    show.set_defaults(run=listing)

    close = commands.add_parser("done", help="mark an item done")
    close.add_argument("id")
    close.add_argument("--commit")
    close.add_argument("--note")
    close.set_defaults(run=lambda args: change(args, "done"))

    edit = commands.add_parser("set", help="change an item's status, priority, who or area")
    edit.add_argument("id")
    edit.add_argument("--status", choices=STATUSES)
    edit.add_argument("--priority", choices=PRIORITIES)
    edit.add_argument("--who", choices=WHO)
    edit.add_argument("--area", choices=AREAS)
    edit.add_argument("--note")
    edit.set_defaults(run=lambda args: change(args, args.status))

    commands.add_parser("check", help="check every item is well formed").set_defaults(run=check)

    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
