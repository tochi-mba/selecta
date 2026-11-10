"""The machine-readable licence register for what Cloud images ship (ADR-0405, SC-0405-01).

`src/selecta/modes/licence_register.json` has one row per Python package the Cloud services and
workers install (the runtime closure of `uv.lock`, plus the `observability` extra), one per
system tool, and points at `model_allowlist.json` for models. The worker image in
`infra/modal/selecta_workers.py` installs exactly that closure, so a row per locked package is a
row per thing in the image. `tests/test_cloud_licence_register.py` fails when a locked package
has no row, a row's version is stale, or a weights loader skips the model allowlist.

Run `python src/selecta/audit/licence_register.py --write` after changing dependencies: it adds
rows for new packages (status `review` unless the licence is plainly permissive), drops rows
for packages that left the lock, and keeps every hand-written status and note.
"""

from __future__ import annotations

import argparse
import importlib.metadata as metadata
import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LOCK = ROOT / "uv.lock"
REGISTER = ROOT / "src" / "selecta" / "modes" / "licence_register.json"
EXTRAS = ("observability",)
STATUSES = ("allowed", "review", "blocked")
PERMISSIVE = re.compile(
    r"^(MIT|MIT-0|BSD|BSD-2-Clause|BSD-3-Clause|0BSD|ISC|Apache|Apache-2\.0|PSF|Zlib|CC0|"
    r"Apache Software License|BSD License|MIT License|ISC License|Python Software Foundation)",
)


def locked_packages(lock: Path = LOCK) -> dict[str, str]:
    """Package name to version for everything `selecta` (with EXTRAS) installs, without dev."""
    data = tomllib.loads(lock.read_text("utf-8"))
    packages = {package["name"]: package for package in data["package"]}
    root = packages["selecta"]
    wanted = [item["name"] for item in root.get("dependencies", [])]
    for extra in EXTRAS:
        wanted += [item["name"] for item in root.get("optional-dependencies", {}).get(extra, [])]
    found: dict[str, str] = {}
    while wanted:
        name = wanted.pop()
        if name in found or name == "selecta":
            continue
        package = packages[name]
        found[name] = package["version"]
        wanted += [item["name"] for item in package.get("dependencies", [])]
    return dict(sorted(found.items()))


def installed_licence(name: str) -> str:
    """The licence the installed package declares, or "" when it isn't installed or silent."""
    try:
        meta = metadata.metadata(name)
    except metadata.PackageNotFoundError:
        return ""
    expression = meta.get("License-Expression")
    if expression:
        return expression.strip()
    classifiers = [
        item.split(" :: ")[-1]
        for item in meta.get_all("Classifier") or []
        if item.startswith("License ::")
    ]
    if classifiers:
        return "; ".join(classifiers)
    return (meta.get("License") or "").strip().splitlines()[0][:80] if meta.get("License") else ""


def default_status(licence: str) -> str:
    if licence and PERMISSIVE.match(licence) and "GPL" not in licence:
        return "allowed"
    return "review"


def load(path: Path = REGISTER) -> dict:
    return json.loads(path.read_text("utf-8"))


def refreshed(register: dict, lock: Path = LOCK) -> dict:
    """The register with one row per locked package, keeping hand-written statuses and notes."""
    rows = register.get("packages", {})
    packages = {}
    for name, version in locked_packages(lock).items():
        row = dict(rows.get(name, {}))
        licence = row.get("licence") or installed_licence(name) or "Not declared"
        row.setdefault("status", default_status(licence))
        packages[name] = {**row, "version": version, "licence": licence}
        packages[name] = {key: packages[name][key] for key in sorted(packages[name])}
    return {**register, "packages": packages}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--write", action="store_true", help="rewrite the register in place")
    args = parser.parse_args(argv)
    current = load()
    fresh = refreshed(current)
    if fresh == current:
        print("The licence register matches uv.lock.")
        return 0
    if args.write:
        REGISTER.write_text(json.dumps(fresh, indent=2, ensure_ascii=False) + "\n", "utf-8")
        print(f"Updated {REGISTER.relative_to(ROOT)}.")
        return 0
    print("The licence register is out of date; run with --write and review the new rows.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
