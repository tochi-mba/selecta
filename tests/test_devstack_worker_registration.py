"""Regression tests for local Cloud worker startup and transient SQLite contention."""

from __future__ import annotations

import sqlite3
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy.exc import OperationalError

from selecta.devstack.worker import _register_with_retry
from selecta.workers.runner import LocalRunner


def _sqlite_error(message: str) -> OperationalError:
    return OperationalError("BEGIN IMMEDIATE", {}, sqlite3.OperationalError(message))


def test_sqlite_lock_during_registration_is_retried() -> None:
    register = Mock(side_effect=[_sqlite_error("database is locked"), None])
    runner = SimpleNamespace(pool="cpu-light", register=register)
    _register_with_retry(runner, timeout_s=1.0, retry_s=0.0)
    assert register.call_count == 2


def test_non_lock_database_error_is_not_swallowed() -> None:
    register = Mock(side_effect=_sqlite_error("no such table: workers"))
    runner = SimpleNamespace(pool="cpu-light", register=register)
    with pytest.raises(OperationalError, match="no such table"):
        _register_with_retry(runner, timeout_s=5.0, retry_s=0.0)
    register.assert_called_once_with()


def test_persistent_sqlite_lock_reports_actionable_failure() -> None:
    register = Mock(side_effect=_sqlite_error("database is locked"))
    runner = SimpleNamespace(pool="cpu-light", register=register)
    with pytest.raises(RuntimeError, match="Stop other Selecta development processes"):
        _register_with_retry(runner, timeout_s=0.0, retry_s=0.0)
    register.assert_called_once_with()


def test_registration_can_be_staged_before_claim_threads() -> None:
    store = Mock()
    store.config.heartbeat_s = 5
    runner = LocalRunner(store, "cpu-light", {}, name="dev-cpu-light", threads=2)
    runner.register()
    assert store.register_worker.call_count == 2
    assert runner._threads == []
    runner.register()
    assert store.register_worker.call_count == 2
