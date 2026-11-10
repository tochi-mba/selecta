"""The load ladder and its thresholds (ADR-0411 SC-0411-04, docs/saas/15-stress-testing.md §15.4, §15.6).

- The levels and thresholds in `tests/load/ladder.py` match the proposal's tables, and the k6
  script's `ladder.json` is the same data, so staging runs judge by the same numbers.
- `evaluate` fails a run on every threshold it misses.
- A scaled-down L1 runs locally against the real cloud app over SQLite (many synthetic accounts,
  pending jobs, a cross-tenant probe and repeated idempotent commands) and passes the thresholds.

The full-size rungs need staging and real concurrency; they are not run here.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from cloud_helpers import cloud_settings
from cloud_world import CloudObjects, add_asset, use_fake_storage
from fastapi.testclient import TestClient
from test_cloud_jobs_support import make_store

from selecta.api_cloud import create_cloud_app
from selecta.identity.tokens import BadSignature, Claims
from selecta.persistence import make_engine, migrate
from selecta.work.enqueue import JobSpec

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests" / "load"))
import ladder  # noqa: E402


def _figure(n: int) -> str:
    return f"{n // 1_000_000}M" if n >= 1_000_000 and n % 1_000_000 == 0 else f"{n:,}"


def test_the_levels_match_the_proposal_table():
    doc = (ROOT / "docs" / "saas" / "15-stress-testing.md").read_text(encoding="utf-8")
    for name, level in ladder.LEVELS.items():
        row = next(line for line in doc.splitlines() if line.startswith(f"| {name} "))
        load = row.split("|")[2]
        assert _figure(level.active_users) in load and _figure(level.pending_jobs) in load, row


def test_the_thresholds_match_the_proposal_table():
    doc = (ROOT / "docs" / "saas" / "15-stress-testing.md").read_text(encoding="utf-8")
    assert "| Routine API p95 | < 300 ms" in doc and ladder.THRESHOLDS["routine_p95_ms"] == 300
    assert "| Routine API error rate | < 0.5%" in doc and ladder.THRESHOLDS["routine_error_rate"] == 0.005
    for words, key in [("Duplicate published results", "duplicate_results"),
                       ("Cross-tenant successes", "cross_tenant_successes"),
                       ("Accepted jobs lost", "accepted_jobs_lost")]:
        assert f"| {words} | 0 |" in doc and ladder.THRESHOLDS[key] == 0


def test_k6_reads_the_same_ladder():
    saved = json.loads((ROOT / "tests" / "load" / "ladder.json").read_text(encoding="utf-8"))
    assert saved == ladder.ladder_json(), "run `python tests/load/ladder.py json`"
    script = (ROOT / "tests" / "load" / "k6" / "ladder.js").read_text(encoding="utf-8")
    assert "open('../ladder.json')" in script
    for key in ("routine_p95_ms", "routine_error_rate", "duplicate_results", "cross_tenant_successes"):
        assert f"t.{key}" in script, key


def _report(**over) -> dict:
    data = {"requests": 100, "p95_ms": 120.0, "error_rate": 0.0, "duplicate_results": 0,
            "cross_tenant_successes": 0, "accepted_jobs_lost": 0}
    data.update(over)
    return data


@pytest.mark.parametrize(("over", "words"), [
    ({"p95_ms": 300.0}, "p95"),
    ({"error_rate": 0.006}, "error rate"),
    ({"duplicate_results": 1}, "duplicate results"),
    ({"cross_tenant_successes": 1}, "cross tenant"),
    ({"accepted_jobs_lost": 2}, "accepted jobs lost"),
    ({"requests": 0}, "no requests"),
])
def test_evaluate_fails_each_missed_threshold(over, words):
    failures = ladder.evaluate(_report(**over))
    assert len(failures) == 1 and words in failures[0]


def test_evaluate_passes_a_clean_run_and_throttling_is_not_an_error():
    assert ladder.evaluate(_report()) == []
    report = ladder.Report("L1", 1.0, requests=200, errors=0, throttled=50, latencies_ms=[10.0] * 150)
    assert report.error_rate == 0.0 and ladder.evaluate(report) == []
    assert ladder.percentile([float(n) for n in range(1, 101)], 95) == 95.0


def test_the_check_command_judges_a_saved_summary(tmp_path, capsys):
    good, bad = tmp_path / "good.json", tmp_path / "bad.json"
    good.write_text(json.dumps(_report()), encoding="utf-8")
    bad.write_text(json.dumps(_report(cross_tenant_successes=3)), encoding="utf-8")
    assert ladder.main(["check", str(good)]) == 0
    assert ladder.main(["check", str(bad)]) == 1
    assert "FAIL: cross tenant successes: 3" in capsys.readouterr().out


class ManyListeners:
    """Accepts `listener-N` tokens, each its own account."""

    def verify(self, token: str) -> Claims:
        if not token.startswith("listener-"):
            raise BadSignature("bad test token")
        n = token.split("-", 1)[1]
        return Claims(subject=f"auth0|load{n}", issued_at=1_000, expires_at=10_000,
                      email=f"load{n}@example.test", email_verified=True)


class As:
    """One synthetic user's view of the shared test client."""

    def __init__(self, client: TestClient, token: str) -> None:
        self.client = client
        self.headers = {"Authorization": f"Bearer {token}", "Origin": "https://app.test"}

    def get(self, path: str):
        return self.client.get(path, headers=self.headers)

    def post(self, path: str, json: dict):
        return self.client.post(path, headers=self.headers, json=json)


@pytest.mark.invariants_off("the app owns its own engine; the run counts lost jobs itself")
def test_a_scaled_down_l1_passes_the_thresholds_locally(tmp_path, monkeypatch):
    objects = CloudObjects()
    use_fake_storage(monkeypatch, objects)
    engine = make_engine(f"sqlite:///{tmp_path / 'cloud.sqlite'}")
    migrate.upgrade(engine)
    app = create_cloud_app(cloud_settings(), engine=engine, verifier=ManyListeners())
    scale = 0.1  # 10 of L1's 100 users and 100 of its 1,000 pending jobs
    # One at a time: the in-process client runs every request on one event loop, so more threads
    # would only measure queueing in the test harness. Real concurrency is k6's job on staging.
    try:
        with TestClient(app) as client:
            users = []
            for n in range(int(ladder.LEVELS["L1"].active_users * scale)):
                user = As(client, f"listener-{n}")
                made = user.post("/api/onboarding/complete", {"age_confirmed": True, "timezone": "UTC"})
                assert made.status_code == 201, made.text
                users.append((user, made.json()["workspace_id"]))
            # Someone else's song, which every probe must find missing.
            secret = add_asset(engine, objects, users[0][1], b"RIFF" + b"\0" * 64)
            store = make_store(engine)
            pending = [store.enqueue(JobSpec(ws, "analyse.song", input_ref={"n": n})).job.id
                       for n in range(int(ladder.LEVELS["L1"].pending_jobs * scale))
                       for ws in [users[n % len(users)][1]]]

            def lost() -> int:
                return sum(1 for job_id in pending if store.job(job_id) is None)

            report = ladder.run_level("L1", [u for u, _ in users[1:]], scale=scale, concurrency=1,
                                      other_asset_ids=[secret], count_lost_jobs=lost)
    finally:
        engine.dispose()
    print(json.dumps(report.summary()))
    assert report.requests >= 10 * 9
    assert report.cross_tenant_successes == 0 and report.duplicate_results == 0
    assert ladder.evaluate(report) == []


def test_the_rooms_k6_script_uses_the_real_code_alphabet_and_has_pass_fail_thresholds():
    from selecta.rooms.codes import ALPHABET

    script = (ROOT / "tests" / "load" / "k6" / "rooms.js").read_text(encoding="utf-8")
    assert f"const ALPHABET = '{ALPHABET}';" in script
    for metric in ("room_join_duration", "room_join_failed", "room_vote_duration",
                   "room_vote_failed", "brute_force_rooms_found"):
        assert f"{metric}: [" in script, metric
    assert "iterations: 1000, maxDuration: '10s'" in script and "rate: 10000, timeUnit: '1m'" in script
