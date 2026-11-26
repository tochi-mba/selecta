"""Run the tests with `core.engine_store` on, and count store calls against the old path.

Set `SELECTA_TEST_ENGINE_STORE=1` (conftest registers this plugin) to prove the store under the
existing tests before the flag's default changes. Every flag setting a test makes still applies:
`+core.engine_store` is added after it, unless the test names the flag itself, so a test that
turns the store off keeps it off, and so does `flags.use("")`, which the store's own proofs use
for the flag off.

The summary says how many store transactions ran (`EngineStore.read` and `write`) and how many
statements Selecta's own modules ran on a raw `sqlite3` connection outside the modules that stay
raw on purpose (docs/engineering/engine-store.md, the remainder table). Set
`SELECTA_TEST_ENGINE_STORE_COUNTS` to a file path to have the counts written there as JSON.
"""

from __future__ import annotations

import collections
import json
import os
import sqlite3
import sys
import threading

import pytest

ENV = "SELECTA_TEST_ENGINE_STORE"
COUNTS_ENV = "SELECTA_TEST_ENGINE_STORE_COUNTS"
FLAG = "core.engine_store"

# Modules that stay on raw sqlite3 with the flag on, by design (the remainder table), and the
# old path a switched module keeps for a caller holding writes of its own. Their statements
# are not "old path" calls.
RAW_ON_PURPOSE = (
    "selecta.db",
    "selecta.local_upgrade",
    "selecta.homes",
    "selecta.recovery",
    "selecta.backup",
    "selecta.cache_care",
    "selecta.api",
    "selecta.engine_store",
    "selecta.devstack",
    "selecta.workers.local_seams",
    "selecta.workers.local_analysis",
    "selecta.lucy.schema",
)


def wanted() -> bool:
    return os.environ.get(ENV, "").strip() not in ("", "0")


def with_store(text: str | None, *, asked: bool = False) -> str:
    """`text` with the store on. A test's explicit empty setting (`flags.use("")`) asks for the
    build exactly; the store's own proofs use it for "flag off", so it is left alone."""
    text = text or ""
    if FLAG in text or (asked and not text.strip()):
        return text
    return f"{text} +{FLAG}".strip()


class EngineStoreOn:
    """The plugin. Patches `selecta.flags` for the whole run and counts calls."""

    def __init__(self) -> None:
        self.store = 0
        self.old: collections.Counter[str] = collections.Counter()
        self._lock = threading.Lock()
        self._undo: list[tuple[object, str, object]] = []

    # flags

    def _patch(self, owner: object, name: str, value: object) -> None:
        self._undo.append((owner, name, getattr(owner, name)))
        setattr(owner, name, value)

    def pytest_configure(self, config: pytest.Config) -> None:
        from selecta import engine_store, flags

        def use(text: str | None) -> None:
            flags._states = None if text is None else flags.resolve(with_store(text, asked=True))

        def effective():
            if flags._states is None:
                flags._states = flags.resolve(with_store(os.environ.get(flags.ENV, "")))
            return flags._states

        self._patch(flags, "use", use)
        self._patch(flags, "effective", effective)
        flags._states = None

        plugin = self
        read, write = engine_store.EngineStore.read, engine_store.EngineStore.write

        def counted(method):
            def run(store, *args, **kwargs):
                with plugin._lock:
                    plugin.store += 1
                return method(store, *args, **kwargs)

            run.__doc__ = method.__doc__
            return run

        self._patch(engine_store.EngineStore, "read", counted(read))
        self._patch(engine_store.EngineStore, "write", counted(write))
        self._patch(sqlite3, "connect", self._connect(sqlite3.connect))

    def pytest_unconfigure(self, config: pytest.Config) -> None:
        for owner, name, value in reversed(self._undo):
            setattr(owner, name, value)
        self._undo.clear()

    # old-path counting

    def _connect(self, original):
        plugin = self

        def connect(*args, **kwargs):
            conn = original(*args, **kwargs)
            if _opened_by_sqlalchemy():
                return conn
            try:
                conn.set_trace_callback(plugin._statement)
            except sqlite3.Error:
                pass
            return conn

        return connect

    def _statement(self, _sql: str) -> None:
        module = _caller()
        if module is None or any(_within(module, raw) for raw in RAW_ON_PURPOSE):
            return
        with self._lock:
            self.old[module] += 1

    # report

    def pytest_terminal_summary(self, terminalreporter) -> None:
        total = sum(self.old.values())
        line = f"engine store on: {self.store} store, {total} old"
        terminalreporter.write_line(line)
        for module, count in self.old.most_common(12):
            terminalreporter.write_line(f"  old {count:6d} {module}")
        target = os.environ.get(COUNTS_ENV)
        if target:
            with open(target, "w", encoding="utf-8") as handle:
                json.dump({"store": self.store, "old": dict(self.old)}, handle, indent=1)


def _within(module: str, package: str) -> bool:
    return module == package or module.startswith(package + ".")


def _opened_by_sqlalchemy() -> bool:
    frame = sys._getframe(2)
    while frame is not None:
        if frame.f_globals.get("__name__", "").startswith("sqlalchemy"):
            return True
        frame = frame.f_back
    return False


def _caller() -> str | None:
    """The first Selecta module up the stack from the statement, or None if a test ran it."""
    frame = sys._getframe(2)
    while frame is not None:
        name = frame.f_globals.get("__name__", "")
        if name.startswith("selecta."):
            return name
        if name.startswith(("test_", "conftest")) or "helpers" in name:
            return None
        frame = frame.f_back
    return None
