"""One unreadable export record can't take the whole list of exports down with it.

Found by a rollback rehearsal: a job file that was cut short, or written by something else,
made GET /api/exports/jobs fail outright, so Workspace and Activity lost every export, good
ones included.
"""

from __future__ import annotations

import json
import time


def _records(tmp_path):
    folder = tmp_path / "exports" / "jobs"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def test_bad_records_are_left_out_and_good_ones_still_listed(client, tmp_path):
    folder = _records(tmp_path)
    good = {"id": "good", "state": "ready", "created_at": time.time(), "name": "gone.flac"}
    (folder / "good.json").write_text(json.dumps(good), "utf-8")
    (folder / "missing-fields.json").write_text(json.dumps({"id": "missing-fields"}), "utf-8")
    (folder / "not-a-job.json").write_text("[1, 2, 3]", "utf-8")
    (folder / "cut-short.json").write_text('{"id": "cut-short", "state": "prep', "utf-8")

    answer = client.get("/api/exports/jobs")

    assert answer.status_code == 200
    jobs = answer.json()["jobs"]
    assert [job["id"] for job in jobs] == ["good"]
    # its file has gone, and it says so rather than offering a link
    assert jobs[0]["state"] == "expired"


def test_a_bad_record_reads_as_missing_not_as_an_error(client, tmp_path):
    folder = _records(tmp_path)
    (folder / "missing-fields.json").write_text(json.dumps({"id": "missing-fields"}), "utf-8")

    assert client.get("/api/exports/jobs/missing-fields").status_code == 404


def test_a_job_under_way_without_progress_times_still_shows(client, tmp_path):
    folder = _records(tmp_path)
    started = time.time() - 30
    record = {"id": "old", "state": "preparing", "created_at": started}
    (folder / "old.json").write_text(json.dumps(record), "utf-8")

    jobs = client.get("/api/exports/jobs").json()["jobs"]

    # nothing in this server is working on it, so it was interrupted, and it never claims otherwise
    assert [(job["id"], job["state"]) for job in jobs] == [("old", "interrupted")]
