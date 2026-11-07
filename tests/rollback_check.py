"""Can an older build read what this one saved, and can this one pick it back up afterwards?

    python tests/rollback_check.py path/to/older/checkout

Builds a home with this checkout's code and saves the things a person would hate to lose: a draft, a
tempo correction, mix settings, a rating and a finished export's record. Then an older checkout
reads that same home, in its own process, and says what it finds. Then this one reads it again.
All three reports have to match. Only made-up songs are involved.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read_everything(home: Path) -> dict:
    """What a person would look for, as this checkout's own server reports it."""
    from fastapi.testclient import TestClient

    from selecta.api import create_app
    from selecta.config import Settings

    app = create_app(Settings(home), ROOT / "web" / "dist", prepare_links=False)
    with TestClient(app, headers={"host": "127.0.0.1"}) as client:
        status = client.get("/api/status").json()
        mix = client.get("/api/mix").json()
        drafts = client.get("/api/drafts").json()["drafts"]
        draft = client.get(f"/api/mix?draft={drafts[0]['id']}").json() if drafts else None
        song = client.get("/api/songs/3").json()
        jobs = client.get("/api/exports/jobs").json()["jobs"]
        return {
            "code_from": str(Path(sys.modules["selecta"].__file__).parent.parent.parent),
            "report": {
                "songs": status["counts"]["total"],
                "steering": status["steering"],
                "mix": [item["song_id"] for item in mix["mix"]],
                "seam": mix["mix"][1]["seam"]["settings"],
                "drafts": [(item["name"], item["id"]) for item in drafts],
                "draft_songs": [item["song_id"] for item in draft["mix"]] if draft else [],
                "corrected_bpm": song.get("bpm"),
                "export_jobs": [(job["id"], job["state"], job["name"]) for job in jobs],
            },
        }


def save_things(home: Path) -> None:
    from e2e_server import build
    from fastapi.testclient import TestClient

    from selecta.api import create_app

    settings = build(home)
    app = create_app(settings, ROOT / "web" / "dist", prepare_links=False)
    with TestClient(app, headers={"host": "127.0.0.1"}) as client:
        made = client.post("/api/drafts", json={"name": "Saturday"}).json()
        draft = made.get("id") or client.get("/api/drafts").json()["drafts"][0]["id"]
        client.post(f"/api/mix/songs?draft={draft}", json={"song_id": 5}).raise_for_status()
        client.post(f"/api/mix/songs?draft={draft}", json={"song_id": 6}).raise_for_status()
        client.post("/api/steer", json={"action": "mix_language", "value": "punchy"})
        client.post("/api/mix/1/seam", json={"move": "cut_on_one"}).raise_for_status()
        client.post("/api/songs/3/correct", json={"bpm": 238}).raise_for_status()
    # a job's record, as a finished export leaves it
    jobs = home / "exports" / "jobs"
    jobs.mkdir(parents=True, exist_ok=True)
    (home / "exports" / "kept.flac").write_bytes(b"fLaC")
    job = {
        "id": "0" * 32,
        "state": "ready",
        "scope": "current",
        "draft": None,
        "mix_name": "Your mix",
        "songs": [],
        "seams": [],
        "seams_total": 0,
        "seams_ready": 0,
        "seconds_estimate": 1,
        "name": "kept.flac",
        "created_at": 1.0,
        "last_progress_at": 1.0,
        "seconds": 1,
        "error": None,
    }
    (jobs / f"{job['id']}.json").write_text(json.dumps(job), "utf-8")


def main() -> int:
    if sys.argv[1:2] == ["--read"]:
        print(json.dumps(read_everything(Path(sys.argv[2]))))
        return 0
    older = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory(
        prefix="selecta-rollback-", ignore_cleanup_errors=True
    ) as folder:
        home = Path(folder) / "home"
        home.mkdir()
        os.environ["SELECTA_HOME"] = str(home)
        sys.path.insert(0, str(Path(__file__).parent))
        save_things(home)

        def report_from(source: Path, label: str) -> dict:
            env = {**os.environ, "PYTHONPATH": f"{source / 'src'}{os.pathsep}{ROOT / 'tests'}"}
            done = subprocess.run(
                [sys.executable, str(Path(__file__).resolve()), "--read", str(home)],
                capture_output=True,
                text=True,
                check=False,
                env=env,
                cwd=folder,
            )
            if done.returncode:
                raise SystemExit(f"{label} couldn't read it:\n{done.stderr[-2000:]}")
            answer = json.loads(done.stdout.strip().splitlines()[-1])
            print(f"{label}: code from {answer['code_from']}")
            return answer["report"]

        before = report_from(ROOT, "this checkout")
        print(json.dumps(before, indent=1))
        rolled_back = report_from(older, "the older checkout")
        forward = report_from(ROOT, "this checkout again")
        same = before == rolled_back == forward
        print("identical across all three" if same else json.dumps(rolled_back, indent=1))
        return 0 if same else 1


if __name__ == "__main__":
    raise SystemExit(main())
