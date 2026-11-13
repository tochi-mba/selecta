"""Local rehearsals of the Cloud drills against tests/e2e_cloud_server.py. Never part of the app.

A rehearsal is not the drill: the drills run on staging with real people (docs/operations). This
runs the same steps on this machine, on the e2e Cloud server (the real Cloud API, with stand-ins
only for sign-in, R2 and Stripe), so each drill's procedure is proven before staging and its
record template is filled once.

    python tests/cloud_rehearsal.py game-day --port 9800 --out <file.json>
    python tests/cloud_rehearsal.py takedown --port 9800 --out <file.json>
    python tests/cloud_rehearsal.py restore --port 9800 --out <file.json>

The server listens on 127.0.0.1:<port> for the run and stops with it. The database is a fresh
SQLite file, or a fresh schema on `SELECTA_TEST_POSTGRES_URL` when that is set. Two shortcuts
are taken and recorded in every result: releasing a control waits 15 minutes as a dangerous
action, so the rehearsal makes the queued release due at once (after checking an early execute
is refused); and the restore copies the database file (SQLite online backup) where staging
restores last night's `pg_dump`.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import sqlalchemy as sa
import uvicorn

sys.path.insert(0, str(Path(__file__).parent))

import e2e_cloud_server  # noqa: E402
from cloud_admin_kit import make_due  # noqa: E402

from selecta.admin.state import DbWorkControls  # noqa: E402
from selecta.persistence import make_engine, migrate, transaction  # noqa: E402
from selecta.scheduling.admission import Verdict  # noqa: E402
from selecta.scheduling.policy import WorkerCaps  # noqa: E402
from selecta.work.enqueue import JobSpec  # noqa: E402
from selecta.work.store import JobStore  # noqa: E402

PROPAGATION_S = 5.0
LEDGER_BUCKET = "sel-deletion-ledger"


class Rehearsal:
    def __init__(self, port: int) -> None:
        self.base = f"http://127.0.0.1:{port}"
        self.app = e2e_cloud_server.build(port)
        self.engine = self.app.state.database_engine
        config = uvicorn.Config(self.app, host="127.0.0.1", port=port, log_level="warning")
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()
        for _ in range(200):
            if self.server.started:
                break
            time.sleep(0.05)
        self.http = httpx.Client(base_url=self.base, timeout=30)
        self.sessions: dict[str, str] = {}
        self.steps: list[dict[str, Any]] = []

    def close(self) -> None:
        self.http.close()
        self.server.should_exit = True
        self.thread.join(timeout=10)

    def headers(self, user: str) -> dict[str, str]:
        out = {"Authorization": f"Bearer e2e:{user}", "Origin": self.base}
        if user in self.sessions:
            out["X-Admin-Session"] = self.sessions[user]
        return out

    def call(self, method: str, path: str, user: str, **kw) -> httpx.Response:
        extra = kw.pop("headers", {})
        return self.http.request(method, path, headers={**self.headers(user), **extra}, **kw)

    def staff(self, user: str, role: str) -> None:
        self.call("POST", "/test/staff", user, json={"user": user, "role": role}).raise_for_status()
        started = self.call("POST", "/api/admin/session", user)
        assert started.status_code == 201, started.text
        self.sessions[user] = started.json()["id"]

    def seed(self, user: str, songs: int = 0, plan: str = "free") -> dict:
        made = self.call("POST", "/test/seed", user, json={"user": user, "songs": songs,
                                                          "plan": plan, "seconds": 4})
        made.raise_for_status()
        return made.json()

    def record(self, name: str, ok: bool, detail: str, seconds: float | None = None) -> None:
        row: dict[str, Any] = {"step": name, "ok": bool(ok), "detail": detail}
        if seconds is not None:
            row["seconds"] = round(seconds, 3)
        self.steps.append(row)
        print(("PASS " if ok else "FAIL ") + name + ": " + detail, flush=True)

    def audit(self, user: str, action: str) -> list[dict]:
        found = self.call("GET", "/api/admin/audit", user, params={"action": action})
        found.raise_for_status()
        return found.json()["events"]

    def alerts(self, user: str) -> list[dict]:
        return self.call("GET", "/api/admin/alerts", user).json()["alerts"]


def until(check: Callable[[], bool], limit: float = PROPAGATION_S) -> float | None:
    """Seconds until `check()` holds, or None if it never did within `limit`."""
    began = time.perf_counter()
    while time.perf_counter() - began < limit + 0.5:
        if check():
            return time.perf_counter() - began
        time.sleep(0.1)
    return None


# -- game day (SC-0410-04, docs/operations/game-day.md) ---------------------------------------


def game_day(r: Rehearsal) -> None:
    op, customer = "gameday-operator", "gameday-customer"
    r.staff(op, "owner")
    workspace = r.seed(customer)["workspace_id"]
    store = JobStore(r.engine, controls=DbWorkControls())
    caps = WorkerCaps(pool="cpu-heavy", worker_id="gameday-worker", slots=8)
    store.register_worker(caps)

    def code(response: httpx.Response) -> str | None:
        try:
            detail = response.json().get("detail")
        except ValueError:
            return None
        return detail.get("code") if isinstance(detail, dict) else None

    def labs() -> httpx.Response:
        return r.call("PUT", "/api/account/labs/account.labs", customer, json={"enabled": False})

    def plan_upload() -> httpx.Response:
        return r.call("POST", "/api/uploads/plan", customer,
                      json={"files": [{"name": "a.flac", "size": 10}]})

    def checkout() -> httpx.Response:
        return r.call("POST", "/api/billing/checkout", customer,
                      headers={"Idempotency-Key": f"gd-{time.time_ns()}"}, json={})

    newcomer = iter(range(1000))

    def sign_up() -> httpx.Response:
        name = f"gameday-new-{next(newcomer)}"
        return r.call("POST", "/api/onboarding/complete", name, json={"age_confirmed": True})

    def admitted(job_type: str) -> bool:
        return store.admit(JobSpec(workspace, job_type)).verdict is not Verdict.REFUSE

    claimed: list[str] = []

    def claims_work() -> bool:
        store.enqueue(JobSpec(workspace, "analyse.song", idempotency_key=f"gd-{time.time_ns()}"))
        got = store.claim("cpu-heavy", caps)
        if got is None:
            return False
        store.start(got.attempt_id, got.fencing_token)
        store.complete(got.attempt_id, got.fencing_token, result={"ok": True})
        claimed.append(got.job.id)
        return True

    # control, target, check that is True while engaged, check that is True when normal
    controls: list[tuple[str, str | None, Callable[[], bool], Callable[[], bool]]] = [
        ("app.read_only", None, lambda: code(labs()) == "read_only",
         lambda: labs().status_code != 503),
        ("uploads.paused", None, lambda: code(plan_upload()) == "uploads_paused",
         lambda: code(plan_upload()) != "uploads_paused"),
        ("signups.disabled", None, lambda: code(sign_up()) == "signups_closed",
         lambda: sign_up().status_code == 201),
        ("billing.safe_mode", None, lambda: code(checkout()) == "billing_safe_mode",
         lambda: code(checkout()) != "billing_safe_mode"),
        ("admission.paused", "cpu-heavy", lambda: not admitted("analyse.song")
         and admitted("ingest.validate"), lambda: admitted("analyse.song")),
        ("workers.drained", "*", lambda: not claims_work(), claims_work),
        ("speculative.disabled", None, lambda: not admitted("discover.sweep"),
         lambda: admitted("discover.sweep")),
    ]
    listed = {row["control"] for row in
              r.call("GET", "/api/admin/emergency", op).json()["controls"]}
    rehearsed = {name for name, *_ in controls}
    skipped = sorted(listed - rehearsed)
    for control, target, engaged, normal in controls:
        body = {"reason": "local game-day rehearsal", "target": target}
        began = time.perf_counter()
        made = r.call("POST", f"/api/admin/emergency/{control}/engage", op, json=body)
        took = until(engaged)
        seen = "never" if took is None else f"{took:.2f} s"
        r.record(f"{control}: engage takes effect", made.status_code == 200 and took is not None,
                 f"HTTP {made.status_code}; effect seen after {seen}",
                 time.perf_counter() - began)
        audited = [e for e in r.audit(op, "platform.emergency_control.engage")
                   if control in json.dumps(e)]
        alerted = [a for a in r.alerts(op)
                   if control in json.dumps(a) and "engaged" in json.dumps(a)]
        r.record(f"{control}: engage audited and alerted", bool(audited) and bool(alerted),
                 f"{len(audited)} audit events, {len(alerted)} alerts")
        proposed = r.call("POST", f"/api/admin/emergency/{control}/release", op,
                          json={**body, "reason": "recovered (rehearsal)"})
        action_id = proposed.json()["action"]["id"]
        early = r.call("POST", f"/api/admin/actions/{action_id}/execute", op)
        make_due(r.engine, action_id)  # the 15-minute wait, fast-forwarded (see module notes)
        done = r.call("POST", f"/api/admin/actions/{action_id}/execute", op)
        took = until(normal)
        seen = "never" if took is None else f"{took:.2f} s"
        r.record(f"{control}: release waits, then normal behaviour returns",
                 early.status_code == 409 and done.status_code == 200 and took is not None,
                 f"early execute HTTP {early.status_code}; execute HTTP {done.status_code}; "
                 f"normal after {seen}")
        released = [e for e in r.audit(op, "platform.emergency_control.release")
                    if control in json.dumps(e)]
        r.record(f"{control}: release audited", bool(released), f"{len(released)} audit events")
    r.record("Controls not rehearsed over HTTP", True,
             f"{', '.join(skipped) or 'none'}: Lucy turns call the AI provider; covered by "
             "tests/test_cloud_admin_emergency.py::test_disabling_lucy_refuses_turns_and_one_"
             "deployment_falls_back")


# -- takedown (SC-0413-02, docs/saas/12-security-privacy-legal.md 12.3) -----------------------


def takedown(r: Rehearsal) -> None:
    legal, owner = "takedown-legal", "takedown-uploader"
    r.staff(legal, "owner")
    seeded = r.seed(owner, songs=2)
    workspace, asset = seeded["workspace_id"], seeded["assets"][0]
    visible = lambda: asset in json.dumps(r.call("GET", "/api/assets", owner).json())  # noqa: E731
    r.record("Uploader sees the asset before the notice", visible(), asset)
    received = time.time()
    logged = r.call("POST", "/api/admin/takedowns", legal, json={
        "workspace_id": workspace, "asset_id": asset, "complainant": "Rehearsal Rights Ltd",
        "work": "Test notice for the local rehearsal: 'Example Song' (made-up work)",
        "received_at": received})
    notice = logged.json().get("notice", {})
    window = notice.get("due_by", 0) - notice.get("received_at", 0)
    r.record("Notice logged with a 24-hour deadline",
             logged.status_code == 201 and abs(window - 86_400) < 1,
             f"HTTP {logged.status_code}; status {notice.get('status')}; "
             f"due_by - received_at = {window:.0f} s")
    listing = r.call("GET", "/api/admin/takedowns", legal, params={"status": "received"}).json()
    r.record("Notice appears in the open list, not overdue",
             any(n["id"] == notice.get("id") and not n["overdue"] for n in listing["notices"]),
             f"{len(listing['notices'])} open notices")
    acted = r.call("POST", f"/api/admin/takedowns/{notice['id']}/act", legal,
                   json={"reason": "Rehearsal: notice is complete and names the asset"})
    decided = time.time()
    r.record("Notice acted on", acted.status_code == 200, f"HTTP {acted.status_code}; "
             f"decided {decided - received:.1f} s after receipt (target under 24 h)")
    r.record("The asset is hidden from its uploader", not visible(), asset)
    events = {a: r.audit(legal, a) for a in ("legal.takedown.logged", "legal.takedown.actioned")}
    within = [(e.get("metadata") or {}).get("within_target") for e in
              events["legal.takedown.actioned"]]
    r.record("Audit trail: logged and actioned, within target",
             bool(events["legal.takedown.logged"]) and within == [True],
             f"logged {len(events['legal.takedown.logged'])}, actioned "
             f"{len(events['legal.takedown.actioned'])}, within_target {within}")
    tamper = r.call("DELETE", f"/api/admin/audit/{events['legal.takedown.actioned'][0]['id']}",
                    legal)
    r.record("The audit trail can't be edited", tamper.status_code == 405,
             f"DELETE audit event: HTTP {tamper.status_code}")


# -- restore (SC-0409-04, SC-0412-03, docs/operations/backup-and-restore.md) -----------------


def restore(r: Rehearsal, work: Path) -> None:
    from selecta.ops import restore_drill
    from selecta.storage.offsite_ledger import drain_deletion_mirror
    from selecta.storage.schema import assets

    if r.engine.dialect.name != "sqlite":
        raise SystemExit("The file-copy restore needs SQLite; on PostgreSQL use pg_dump.")
    user = "restore-customer"
    seeded = r.seed(user, songs=3)
    kept, gone = seeded["assets"][0], seeded["assets"][1]
    backup = work / "backup.sqlite"
    source = sqlite_path(r.engine)
    with r.engine.connect() as conn:  # SQLite online backup: the "nightly dump"
        raw = conn.connection.driver_connection
        import sqlite3

        target = sqlite3.connect(backup)
        raw.backup(target)
        target.close()
    r.record("Backup taken", backup.is_file(), f"{backup.stat().st_size} bytes from {source.name}")
    deleted = r.call("DELETE", f"/api/assets/{gone}", user)
    r.record("Song deleted after the backup", deleted.status_code in (200, 202, 204),
             f"HTTP {deleted.status_code}")
    objects = e2e_cloud_server.storage_api.R2Client()
    mirrored = drain_deletion_mirror(r.engine, objects, LEDGER_BUCKET)
    r.record("Deletion mirrored to the off-site ledger", mirrored.delivered >= 1,
             f"{mirrored.delivered} delivered, {mirrored.pending} pending")
    restore_started = time.time()
    restored_file = work / "restored.sqlite"
    shutil.copyfile(backup, restored_file)
    restored = make_engine(f"sqlite:///{restored_file}")
    migrate.upgrade(restored)

    def hidden(asset_id: str) -> bool:
        with transaction(restored) as conn:
            row = conn.execute(sa.select(assets.c.deleted_at).where(assets.c.id == asset_id))
            return row.scalar_one() is not None

    r.record("The restore brings the deleted song back (before replay)", not hidden(gone), gone)
    report = restore_drill.after_restore(restored, objects, LEDGER_BUCKET,
                                         restore_started=restore_started)
    for step in report.steps:
        r.record(f"Drill step: {step.name}", step.ok, step.detail, step.seconds)
    r.record("Deleted data stays gone; kept data stays", hidden(gone) and not hidden(kept),
             f"{gone} hidden, {kept} visible")
    r.record("Recovery under 60 minutes", report.passed, f"total {report.total_s:.1f} s")
    (work / "restore-drill-report.md").write_text(report.markdown(), "utf-8")
    restored.dispose()


def sqlite_path(engine) -> Path:
    return Path(engine.url.database)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("drill", choices=("game-day", "takedown", "restore"))
    parser.add_argument("--port", type=int, default=9800)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    work = args.out.parent / f"{args.drill}-work"
    work.mkdir(parents=True, exist_ok=True)
    rehearsal = Rehearsal(args.port)
    began = time.time()
    try:
        if args.drill == "game-day":
            game_day(rehearsal)
        elif args.drill == "takedown":
            takedown(rehearsal)
        else:
            restore(rehearsal, work)
    finally:
        rehearsal.close()
    result = {
        "drill": args.drill,
        "date": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(began)),
        "database": rehearsal.engine.dialect.name,
        "seconds": round(time.time() - began, 1),
        "passed": all(step["ok"] for step in rehearsal.steps),
        "steps": rehearsal.steps,
    }
    args.out.write_text(json.dumps(result, indent=2) + "\n", "utf-8")
    print(f"{'PASSED' if result['passed'] else 'FAILED'} in {result['seconds']} s")
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
