"""Starting the cloud app runs none of the local app's start-up side effects (SC-0392-02).

The local app, when it starts, forgets unfinished seam jobs, starts the seam worker, watches
the music folder for new songs, warms up the library and may restore a backup. None of that
belongs in a shared, multi-tenant web process. This builds the cloud app the way `selecta web`
does (`api.serve()` with `SELECTA_MODE=cloud`), runs its whole lifespan under a TestClient with
a few requests, and checks that:

- no local start-up hook is ever called;
- no subprocess is started;
- every thread started is one a bare FastAPI app under the same TestClient also starts (the
  client's event loop portal and AnyIO's worker threads for sync routes), and none of them runs
  Selecta code.
"""

from __future__ import annotations

import multiprocessing
import subprocess
import threading
from collections import Counter

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import selecta.api_cloud
import selecta.homes
import selecta.routes.library
from selecta import api
from selecta.persistence import make_engine, migrate, new_id


class StartedThreads:
    """Records every thread started while it is installed, as (thread class, target module)."""

    def __init__(self, monkeypatch) -> None:
        self.kinds: Counter[tuple[str, str]] = Counter()
        original = threading.Thread.start
        recorder = self

        def start(thread: threading.Thread) -> None:
            recorder.kinds[kind(thread)] += 1
            original(thread)

        monkeypatch.setattr(threading.Thread, "start", start)


def kind(thread: threading.Thread) -> tuple[str, str]:
    target = getattr(thread, "_target", None)
    owner = type(thread)
    return f"{owner.__module__}.{owner.__qualname__}", getattr(target, "__module__", "") or ""


def exercise(app: FastAPI) -> None:
    """The lifespan, start to finish, with requests that reach sync and async routes."""
    with TestClient(app, base_url="http://testserver") as client:
        for path in ("/api/status", "/api/ready", "/api/account"):
            client.get(path)


def bare_app() -> FastAPI:
    app = FastAPI()

    @app.get("/api/status")
    async def status() -> dict:
        return {}

    @app.get("/api/ready")
    def ready() -> dict:
        return {}

    @app.get("/api/account")
    def account() -> dict:
        return {}

    return app


CLOUD_ENV = {
    "SELECTA_MODE": "cloud",
    "SELECTA_DATABASE_URL": "postgresql+psycopg://user:pass@localhost/selecta",
    "SELECTA_WORKOS_CLIENT_ID": "client_test",
    "SELECTA_AUTH_ISSUER": "https://issuer.test",
    "SELECTA_AUTH_AUDIENCE": "selecta-test",
    "SELECTA_ALLOWED_HOSTS": "testserver",
    "SELECTA_ALLOWED_ORIGINS": "https://app.test",
    "SELECTA_WORKOS_API_KEY": "sk_test_startup",
    "SELECTA_WORKOS_WEBHOOK_SECRET": "whsec_test_startup",
}


@pytest.fixture
def cloud_env(monkeypatch, tmp_path):
    """Cloud mode configured from the environment, over a migrated SQLite file."""
    engine = make_engine(f"sqlite:///{tmp_path / 'cloud.sqlite'}")
    migrate.upgrade(engine)
    for name, value in CLOUD_ENV.items():
        monkeypatch.setenv(name, value)
    # The settings must name PostgreSQL; the test database is SQLite, so hand it over here.
    monkeypatch.setattr(selecta.api_cloud, "make_engine", lambda _url, **_options: engine)
    yield engine
    engine.dispose()


def baseline_threads() -> set[tuple[str, str]]:
    """The thread kinds a bare FastAPI app starts under the same TestClient and requests."""
    with pytest.MonkeyPatch.context() as patch:
        threads = StartedThreads(patch)
        exercise(bare_app())
    return set(threads.kinds)


def forbid_local_start_up(monkeypatch) -> list[str]:
    """Replace each local start-up hook, and each way to start a process, with a recorder."""
    called: list[str] = []

    def forbidden(name: str):
        def hook(*_args, **_kwargs):
            called.append(name)
            raise AssertionError(f"{name} ran while the cloud app started")

        return hook

    hooks = {
        (api.SeamStore, "forget_unfinished"): "SeamStore.forget_unfinished",
        (api.SeamStore, "start"): "the seam worker",
        (api, "create_app"): "the local app factory",
        (api, "activate_pending_restore"): "a pending local restore",
        (selecta.homes, "gather_if_needed"): "gathering old homes",
        # The folder watcher and the warm-up are built here and in create_app.
        (api, "library_routes"): "the library routes and folder watcher",
        (subprocess, "Popen"): "a subprocess",
        (multiprocessing.Process, "start"): "a child process",
    }
    for (owner, attribute), name in hooks.items():
        monkeypatch.setattr(owner, attribute, forbidden(name))
    return called


def test_a_bare_app_under_the_test_client_sets_the_thread_baseline():
    allowed = baseline_threads()
    assert allowed, "the baseline should see the client's own threads"
    assert not any(module.startswith("selecta") for _cls, module in allowed)


def test_starting_the_cloud_app_runs_no_local_side_effects_threads_or_subprocesses(
    monkeypatch, cloud_env
):
    allowed = baseline_threads()
    called = forbid_local_start_up(monkeypatch)
    threads = StartedThreads(monkeypatch)
    app = api.serve()
    assert app.state.runtime_mode == "cloud"
    exercise(app)

    assert called == []
    unexpected = sorted(set(threads.kinds) - allowed)
    assert unexpected == [], f"threads beyond the TestClient baseline: {unexpected}"
    assert not any(module.startswith("selecta") for _cls, module in threads.kinds)


def test_the_local_hooks_this_test_forbids_still_exist():
    """If a hook is renamed, the guard above would replace nothing; fail here instead."""
    assert callable(api.SeamStore.forget_unfinished) and callable(api.SeamStore.start)
    assert api.library_routes is selecta.routes.library.add_routes
    assert callable(api.activate_pending_restore) and callable(selecta.homes.gather_if_needed)


def test_the_thread_recorder_sees_a_thread_that_runs_selecta_code(monkeypatch):
    threads = StartedThreads(monkeypatch)
    thread = threading.Thread(target=new_id, daemon=True)
    thread.start()
    thread.join()
    assert ("threading.Thread", "selecta.persistence") in threads.kinds
