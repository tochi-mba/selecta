"""The hosted media revocation drill (ADR-0456, BF-0456-08), scripted end to end.

One drill over the real e2e Cloud server (`tests/e2e_cloud_server.py`, run in-process on a free
port, as `tests/cloud_rehearsal.py` runs it): the production Cloud API with fake sign-in and the
in-memory R2. The grant is the real cutover rule shape (`build_grandfather_rules`: a WORKSPACES
grant, then the trailing catch-all off), so granting and revoking are exactly what the runbook
does: add the workspace to the allowlist, then take it out again.

    grant  -> the drill account uploads a song to completion and its hosted job is claimed
    use    -> a second upload is mid-flight (one part in R2) and a second job is queued
    revoke -> the account leaves the allowlist; then, for that account alone:
              the in-flight upload is refused at every step (sign parts, complete, status)
              and a new plan is refused, all 403 `flag_off`;
              the queued hosted job is drained (never claimed, held as `flag_off`);
              stored media still plays (playback proxy URL answers, the bytes come back);
              the open event stream says `flags.changed` and /api/account reflows;
              a bystander account still holding the grant keeps uploading.

The browser half of the reflow (upload entries leaving an open page with no reload) is
`web/e2e-cloud/flags.cloud.ts`, "hosted media is an account grant". Repeatable: every run builds
a fresh server and database, and nothing here depends on wall-clock order beyond short waits.
"""

from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
from pathlib import Path

import httpx
import pytest
import sqlalchemy as sa

sys.path.insert(0, str(Path(__file__).parent))

from cloud_rehearsal import Rehearsal  # noqa: E402
from test_cloud_jobs_support import make_store, worker  # noqa: E402

from selecta.flags import rules as flag_rules  # noqa: E402
from selecta.flags.rules import RulesCache  # noqa: E402
from selecta.hosted_coexistence.grandfather import build_grandfather_rules  # noqa: E402
from selecta.persistence import transaction  # noqa: E402
from selecta.work import catalogue  # noqa: E402
from selecta.work.cloud_ports import CloudJobFlags  # noqa: E402
from selecta.work.enqueue import JobSpec  # noqa: E402
from selecta.work.schema import jobs  # noqa: E402

HOSTED = "cloud.hosted_media"
DRILL = "revocation-drill"
BYSTANDER = "revocation-bystander"


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@pytest.fixture(scope="module")
def server():
    # The e2e server is built to own its process: it sets SELECTA_* variables and swaps the R2
    # and Stripe clients module-wide. In-process, put all of that back for the tests after us.
    from selecta.billing import api as billing_api
    from selecta.storage import api as storage_api

    environ = dict(os.environ)
    r2_client, stripe_client = storage_api.R2Client, billing_api.HttpStripeClient
    rehearsal = Rehearsal(_free_port())
    try:
        yield rehearsal
    finally:
        rehearsal.close()
        storage_api.R2Client, billing_api.HttpStripeClient = r2_client, stripe_client
        os.environ.clear()
        os.environ.update(environ)


def _grant(r: Rehearsal, workspace_ids: list[str]) -> None:
    """The cutover rule list: these workspaces granted, everyone else caught by the catch-all."""
    with transaction(r.engine) as conn:
        flag_rules.save(conn, HOSTED, build_grandfather_rules(workspace_ids),
                        author="drill", reason="BF-0456-08 revocation drill")
    r.app.state.flag_rules.invalidate()


class _Decided:
    """The real CloudJobFlags answers for the hosted grant, decided before a claim opens its
    write transaction (SQLite's single writer would block the port's own read; see
    test_bf_hosted_jobs._Decided)."""

    def __init__(self, engine, workspace_ids: list[str]):
        real = CloudJobFlags(engine, RulesCache(engine))
        flag_ids = {job.flag_id for job in catalogue.CATALOGUE.values() if job.flag_id}
        self.answers = {
            (ws, flag): real.is_on(ws, flag) for ws in workspace_ids for flag in flag_ids
        }

    def is_on(self, workspace_id: str, flag_id: str) -> bool:
        return self.answers[(workspace_id, flag_id)]


def _wav(r: Rehearsal, seconds: float) -> bytes:
    answer = r.http.get("/test/wav", params={"seconds": seconds})
    answer.raise_for_status()
    return answer.content


def _plan(r: Rehearsal, user: str, name: str, size: int) -> httpx.Response:
    return r.call("POST", "/api/uploads/plan", user, json={"files": [{"name": name, "size": size}]})


def _put_parts(
    r: Rehearsal, user: str, session: dict, data: bytes, numbers: list[int]
) -> httpx.Response:
    signed = r.call(
        "POST", f"/api/uploads/{session['id']}/parts", user, json={"part_numbers": numbers}
    )
    if signed.status_code != 200:
        return signed
    size = session["part_size"]
    for number in numbers:
        url = signed.json()["part_urls"][str(number)]
        put = httpx.put(url, content=data[(number - 1) * size : number * size], timeout=30)
        assert put.status_code == 200, put.text
    return signed


def _upload(r: Rehearsal, user: str, name: str, data: bytes) -> dict:
    """Plan, put every part and complete: the whole upload, as the browser does it."""
    planned = _plan(r, user, name, len(data))
    assert planned.status_code == 201, planned.text
    session = planned.json()["uploads"][0]["session"]
    every = list(range(1, session["part_count"] + 1))
    assert _put_parts(r, user, session, data, every).status_code == 200
    done = r.call("POST", f"/api/uploads/{session['id']}/complete", user)
    assert done.status_code == 200, done.text
    return done.json()


def _code(answer: httpx.Response) -> str | None:
    try:
        detail = answer.json().get("detail")
    except (ValueError, AttributeError):
        return None
    return detail.get("code") if isinstance(detail, dict) else None


def _assets(r: Rehearsal, user: str) -> list[dict]:
    answer = r.call("GET", "/api/assets", user, params={"limit": 100})
    assert answer.status_code == 200, answer.text
    return answer.json()["assets"]


class _Stream:
    """The account's open event stream, read on a thread, as an open page would hold it."""

    def __init__(self, r: Rehearsal, user: str):
        self.topics: list[str] = []
        self.open = threading.Event()
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._read, args=(r, user), daemon=True)
        self.thread.start()
        assert self.open.wait(10), "the event stream never opened"

    def _read(self, r: Rehearsal, user: str) -> None:
        with httpx.Client(base_url=r.base, timeout=httpx.Timeout(30, read=60)) as client:
            with client.stream("GET", "/api/events", headers=r.headers(user)) as answer:
                assert answer.status_code == 200
                self.open.set()
                for line in answer.iter_lines():
                    if self.stop.is_set():
                        return
                    if line.startswith("data: "):
                        self.topics.append(json.loads(line[6:])["topic"])

    def saw(self, topic: str, within: float) -> bool:
        deadline = time.monotonic() + within
        while time.monotonic() < deadline:
            if topic in self.topics:
                return True
            time.sleep(0.1)
        return False

    def close(self) -> None:
        self.stop.set()


def _job(engine, job_id: str):
    with transaction(engine) as conn:
        return conn.execute(sa.select(jobs).where(jobs.c.id == job_id)).one()


def test_grant_use_revoke_drill(server: Rehearsal):
    r = server
    drill = r.seed(DRILL, songs=1)
    bystander = r.seed(BYSTANDER)
    ws, other = drill["workspace_id"], bystander["workspace_id"]
    stored = drill["assets"][0]

    # -- grant: the drill account (and a bystander) on the cutover allowlist ---------------------
    _grant(r, [ws, other])
    account = r.call("GET", "/api/account", DRILL).json()
    assert account["features"][HOSTED] is True and account["features"]["cloud.uploads"] is True
    assert account["experience"]["hosted"] is True

    # -- use: a whole upload lands, and hosted processing is admitted ---------------------------
    song = _wav(r, 2.0)
    finished = _upload(r, DRILL, "Granted.wav", song)
    assert finished["status"] in ("accepted", "completed"), finished
    assert finished["asset_id"]
    before = {asset["id"] for asset in _assets(r, DRILL)}
    assert {stored, finished["asset_id"]} <= before

    store = make_store(r.engine, flags=_Decided(r.engine, [ws]))
    first = store.enqueue(JobSpec(ws, "analyse.song", idempotency_key="drill-granted")).job
    assert first.flag_id == HOSTED
    # The upload queued its own analysis too; both are granted hosted work and both run.
    ran = set()
    for _ in range(2):
        claimed = store.claim("cpu-heavy", worker("cpu-heavy"))
        if claimed is None:
            break
        assert claimed.job.workspace_id == ws and claimed.job.flag_id == HOSTED, claimed.job
        ran.add(claimed.job.id)
        store.start(claimed.attempt_id, claimed.fencing_token)
        store.complete(claimed.attempt_id, claimed.fencing_token, result={"ok": True})
    assert first.id in ran, "a granted hosted job must run"

    # A second upload is mid-flight (one part in R2, not completed) and a second job is queued.
    big = _wav(r, 40.0)
    planned = _plan(r, DRILL, "In flight.wav", len(big))
    assert planned.status_code == 201, planned.text
    in_flight = planned.json()["uploads"][0]["session"]
    assert _put_parts(r, DRILL, in_flight, big, [1]).status_code == 200
    queued = store.enqueue(JobSpec(ws, "seam.render", idempotency_key="drill-queued")).job
    assert queued.flag_id == HOSTED

    stream = _Stream(r, DRILL)
    try:
        time.sleep(2.5)  # the stream has read the rules version once, so a change is news

        # -- revoke: the account leaves the allowlist; the bystander stays ----------------------
        _grant(r, [other])

        # The open page hears it, and its next account read has reflowed.
        assert stream.saw("flags.changed", within=10), f"no flags.changed, saw {stream.topics}"
    finally:
        stream.close()
    account = r.call("GET", "/api/account", DRILL).json()
    assert account["features"][HOSTED] is False
    assert account["features"]["cloud.uploads"] is False
    assert account["features"]["cloud.stored_media"] is True
    assert account["experience"]["hosted"] is False

    # The in-flight upload is refused at every remaining step, and so is a new one.
    for answer in (
        r.call("POST", f"/api/uploads/{in_flight['id']}/parts", DRILL, json={"part_numbers": [2]}),
        r.call("POST", f"/api/uploads/{in_flight['id']}/complete", DRILL),
        r.call("GET", f"/api/uploads/{in_flight['id']}", DRILL),
        _plan(r, DRILL, "After revoke.wav", 1024),
    ):
        assert answer.status_code == 403, answer.text
        assert _code(answer) == "flag_off", answer.text
    assert {asset["id"] for asset in _assets(r, DRILL)} == before, "an upload landed after revoke"

    # Queued hosted work is drained: never claimed, held as flag_off.
    revoked = make_store(r.engine, flags=_Decided(r.engine, [ws]))
    assert revoked.claim("cpu-heavy", worker("cpu-heavy", "drill-2")) is None
    held = _job(r.engine, queued.id)
    assert held.error_class == "flag_off" and held.state in ("blocked", "cancelled"), held

    # Stored media still plays: the seeded song's prepared playback file, and the original of
    # both it and the song uploaded under the grant (this server runs no proxy worker, so a
    # fresh upload has no prepared file; its original is what the player would fall back to).
    proxy = r.call("POST", f"/api/assets/{stored}/playback-proxy", DRILL)
    assert proxy.status_code in (200, 201, 202), proxy.text
    assert proxy.json().get("status") == "ready", proxy.text
    urls = [proxy.json()["url"]]
    for asset_id in (stored, finished["asset_id"]):
        original = r.call("GET", f"/api/assets/{asset_id}/playback-url", DRILL)
        assert original.status_code == 200, original.text
        urls.append(original.json()["url"])
    for url in urls:
        audio = httpx.get(url, timeout=30)
        assert audio.status_code == 200 and len(audio.content) > 1000, url

    # Only the drill account lost the grant: the bystander still uploads.
    assert r.call("GET", "/api/account", BYSTANDER).json()["features"][HOSTED] is True
    assert _upload(r, BYSTANDER, "Bystander.wav", _wav(r, 1.0))["asset_id"]

    # Repeatable: granting again restores uploads for the drill account.
    _grant(r, [ws, other])
    assert _plan(r, DRILL, "Granted again.wav", 1024).status_code == 201
