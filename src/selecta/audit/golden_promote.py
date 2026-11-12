"""S4-0112-06: a named person promotes reviewed screenshot candidates to golden baselines.

    python -m selecta.audit.golden_promote --candidates <test output folder> \
        --name library-1280-dark --reviewer "Full Name" --device "Surface Laptop 5, Windows 11" \
        --sha <commit the candidate was captured at>

Only a person runs this, after looking at each candidate. Candidates come from
web/e2e/s4-0112-golden.e2e.ts, whose manifests name the commit and browser each image was taken
with. Promotion refuses a missing reviewer or device, a SHA that is not the manifest's commit, and a
name with no candidate, then copies the image to docs/verification/goldens/s4-0112/ and records
reviewer, date, device, SHA and browser in approved.json there. The spec compares against those and
never writes them. The person also adds a row to docs/adr/completion/visual-evidence.md.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
GOLDENS = ROOT / "docs" / "verification" / "goldens" / "s4-0112"
SHA = re.compile(r"[0-9a-f]{7,40}")


class Refused(ValueError):
    """The promotion would make an unreviewed or unattributed golden."""


def _manifests(candidates: Path) -> dict[str, tuple[dict, dict, Path]]:
    """Each captured view by name, with its manifest and the folder holding its image."""
    found: dict[str, tuple[dict, dict, Path]] = {}
    for manifest_path in sorted(candidates.rglob("s4-0112-manifest-*.json")):
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for capture in manifest.get("captures", []):
            found[capture["name"]] = (manifest, capture, manifest_path.parent)
    return found


def promote(
    candidates: Path,
    names: list[str],
    reviewer: str,
    device: str,
    sha: str,
    goldens: Path = GOLDENS,
    today: dt.date | None = None,
) -> list[dict]:
    if not names:
        raise Refused("name at least one candidate to approve")
    if len(reviewer.strip().split()) < 2:
        raise Refused("the reviewer is a person's full name")
    if not device.strip():
        raise Refused("name the device the candidates were reviewed on")
    if not SHA.fullmatch(sha):
        raise Refused("the SHA is the exact commit the candidates were captured at")
    found = _manifests(candidates)
    chosen = []
    for name in names:
        if name not in found:
            raise Refused(f"no candidate named {name} in {candidates}")
        manifest, capture, folder = found[name]
        if manifest.get("status") != "candidate-not-independently-verified":
            raise Refused(f"{name} does not come from a candidate manifest")
        if not str(manifest.get("commit", "")).startswith(sha):
            raise Refused(f"{name} was captured at {manifest.get('commit')}, not {sha}")
        image = folder / capture["file"]
        if not image.is_file():
            raise Refused(f"{image} is missing")
        chosen.append((name, manifest, capture, image))
    goldens.mkdir(parents=True, exist_ok=True)
    register = goldens / "approved.json"
    data = (
        json.loads(register.read_text(encoding="utf-8")) if register.exists() else {"approvals": []}
    )
    date = (today or dt.date.today()).isoformat()
    added = []
    for name, manifest, capture, image in chosen:
        file = f"{name}.png"
        shutil.copyfile(image, goldens / file)
        entry = {
            "name": name,
            "file": file,
            "reviewer": reviewer.strip(),
            "date": date,
            "device": device.strip(),
            "sha": manifest["commit"],
            "browser": manifest.get("browser", ""),
            "fixture": manifest.get("fixture", ""),
            "theme": capture.get("theme"),
            "viewport": f"{capture.get('width')}x{capture.get('height')}",
        }
        data["approvals"] = [row for row in data["approvals"] if row["name"] != name] + [entry]
        added.append(entry)
    register.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8", newline="\n")
    return added


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--candidates", type=Path, required=True)
    parser.add_argument("--name", action="append", default=[], dest="names")
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--sha", required=True)
    args = parser.parse_args()
    try:
        added = promote(args.candidates, args.names, args.reviewer, args.device, args.sha)
    except Refused as refusal:
        raise SystemExit(f"Refused: {refusal}") from None
    for entry in added:
        print(f"approved {entry['name']} by {entry['reviewer']} at {entry['sha']}")


if __name__ == "__main__":
    main()
