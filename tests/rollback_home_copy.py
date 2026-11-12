"""Old-to-new-to-old on a COPY of a real SelectaDJ home, reporting counts only.

    python tests/rollback_home_copy.py path/to/older/checkout [--source HOME] [--keep]

Needs the owner's OK, because it reads their home. It never writes to the source: the database is
read through SQLite's backup API from a read-only connection, and only the records a person would
hate to lose are copied (database, settings, ratings, export job records, operations), into a
neutral folder outside the repo. This checkout, then the older checkout, then this checkout again
each open the copy in their own process and report counts. No song name, artist, path or listener
data is printed: only numbers and pass or fail. The copy is deleted at the end unless --keep.
(S4-0089-09, S4-0111-09, S4-0113-05.)
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# small records only; analysis features, renders, stems, models and exported audio are caches or
# files the person keeps themselves, and are not what a rollback can lose
KEPT_FILES = ("gathered.json", "job-times.json", "storage.json", "pair-book.json")
KEPT_FOLDERS = ("seam-history", "operations", "exports/jobs")


def copy_home(source: Path, target: Path) -> None:
    target.mkdir(parents=True)
    reader = sqlite3.connect(f"{(source / 'selecta.sqlite').as_uri()}?mode=ro", uri=True)
    writer = sqlite3.connect(target / "selecta.sqlite")
    try:
        reader.backup(writer)
    finally:
        writer.close()
        reader.close()
    for name in KEPT_FILES:
        if (source / name).is_file():
            shutil.copy2(source / name, target / name)
    for name in KEPT_FOLDERS:
        if (source / name).is_dir():
            shutil.copytree(source / name, target / name)


def counts(home: Path) -> dict:
    """What this process's code reads from the home, as numbers only."""
    from fastapi.testclient import TestClient

    from selecta.api import create_app
    from selecta.config import Settings

    app = create_app(Settings(home), ROOT / "web" / "dist", prepare_links=False)
    report: dict = {}
    with TestClient(app, headers={"host": "127.0.0.1"}) as client:
        status = client.get("/api/status").json()
        report["songs"] = status["counts"]["total"]
        report["analysed"] = status["counts"].get("analysed")
        report["steering_settings"] = len(status.get("steering", {}))
        report["current_mix_songs"] = len(client.get("/api/mix").json()["mix"])
        drafts = client.get("/api/drafts").json()["drafts"]
        report["drafts"] = len(drafts)
        draft_songs, unreadable = 0, 0
        for draft in drafts:
            answer = client.get(f"/api/mix?draft={draft['id']}")
            if answer.status_code == 200:
                draft_songs += len(answer.json()["mix"])
            else:
                unreadable += 1
        report["draft_songs"] = draft_songs
        report["drafts_unreadable"] = unreadable
        jobs = client.get("/api/exports/jobs")
        report["export_jobs"] = len(jobs.json()["jobs"]) if jobs.status_code == 200 else None
        memory = client.get("/api/memory").json()
        report["ratings_liked"] = memory.get("liked")
        report["ratings_disliked"] = memory.get("disliked")
        report["requests"] = len(client.get("/api/requests").json()["requests"])
    conn = sqlite3.connect(f"{(home / 'selecta.sqlite').as_uri()}?mode=ro", uri=True)
    try:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        report["corrections"] = (
            conn.execute("SELECT COUNT(*) FROM song_overrides").fetchone()[0]
            if "song_overrides" in tables
            else None
        )
        report["preferences"] = (
            conn.execute("SELECT COUNT(*) FROM preferences").fetchone()[0]
            if "preferences" in tables
            else None
        )
    finally:
        conn.close()
    report["seam_history_files"] = len(list((home / "seam-history").glob("*.json")))
    return report


def report_from(source: Path, home: Path, label: str) -> dict:
    env = {**os.environ, "PYTHONPATH": f"{source / 'src'}{os.pathsep}{ROOT / 'tests'}"}
    env["SELECTA_HOME"] = str(home)
    done = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--read", str(home)],
        capture_output=True,
        text=True,
        check=False,
        env=env,
        cwd=home.parent,
    )
    if done.returncode:
        # the error text could name a song or path, so only its type is shown
        last = (done.stderr.strip().splitlines() or ["unknown"])[-1].split(":")[0]
        raise SystemExit(f"{label} couldn't read the copy ({last})")
    return json.loads(done.stdout.strip().splitlines()[-1])


def main() -> int:
    if sys.argv[1:2] == ["--read"]:
        print(json.dumps(counts(Path(sys.argv[2]))))
        return 0
    args = sys.argv[1:]
    older = Path(args[0]).resolve()
    keep = "--keep" in args
    from selecta.config import default_home

    source = Path(args[args.index("--source") + 1]) if "--source" in args else default_home()
    root = Path(Path(tempfile.gettempdir()).anchor) / "selecta-e2e"
    root.mkdir(parents=True, exist_ok=True)
    folder = Path(tempfile.mkdtemp(prefix="home-copy-", dir=root))
    home = folder / "home"
    try:
        copy_home(source, home)
        print(f"copied the home's records ({sum(1 for _ in home.rglob('*'))} files)")
        before = report_from(ROOT, home, "this checkout")
        print("this checkout:", json.dumps(before))
        older_report = report_from(older, home, "the older checkout")
        print("the older checkout:", json.dumps(older_report))
        after = report_from(ROOT, home, "this checkout again")
        print("this checkout again:", json.dumps(after))
        unknown = sorted(key for key, value in older_report.items() if value is None)
        differs = sorted(
            key
            for key in before
            if key not in unknown and before[key] != older_report.get(key)
        )
        if unknown:
            print(f"the older checkout doesn't have: {', '.join(unknown)}")
        if differs:
            print(f"the older checkout reads differently: {', '.join(differs)}")
        same = before == after and not before.get("drafts_unreadable")
        print("nothing lost" if same else "A CHANGE")
        return 0 if same else 1
    finally:
        if keep:
            print(f"kept the copy at {folder}")
        else:
            shutil.rmtree(folder, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
