"""The one place the business test suites (ADR-0454, package BZ-7) meet the product code.

The suites were written before the business code landed (owner's order: code first, tests last,
with BZ-1 to BZ-5 building at the same time). So every test reaches the product only through the
small adapter modules in this package, one per area (`hours.py`, `zones.py`, `kiosk.py`, ...).
Each adapter names the exact module and function the ADR promises and resolves it with `need`.

When the final test pass finds that a product function landed under another name or shape,
fix the adapter, not the tests: the tests state venue behaviour, the adapter states where the
code lives.

`need` resolves lazily, inside a test, never at import time, so one missing function fails the
tests that use it (with the ADR and the dotted name) and never stops the rest from collecting.
A missing contract is a FAILURE, never a skip: a skipped business test would let a release gate
pass on nothing (ADR-0454, gate P2).
"""

from __future__ import annotations

import importlib
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest


class ContractMissing(AssertionError):
    """The product does not (yet) provide what an ADR promised."""


def need(dotted: str, adr: str) -> Any:
    """Return the object at `package.module:attr` (or `package.module.attr`), or fail clearly.

    `adr` is the ADR or checklist id that promises it, so the failure says who owns the fix.
    """
    if ":" in dotted:
        module_name, _, attr_path = dotted.partition(":")
    else:
        module_name, _, attr_path = dotted.rpartition(".")
    try:
        target: Any = importlib.import_module(module_name)
    except ImportError as error:
        pytest.fail(
            f"Contract missing ({adr}): module {module_name} cannot be imported: {error}",
            pytrace=False,
        )
    for part in attr_path.split(".") if attr_path else ():
        if not hasattr(target, part):
            pytest.fail(
                f"Contract missing ({adr}): {module_name} has no {attr_path}",
                pytrace=False,
            )
        target = getattr(target, part)
    return target


def need_module(name: str, adr: str) -> Any:
    """Return an imported module, or fail with the ADR that promises it."""
    try:
        return importlib.import_module(name)
    except ImportError as error:
        pytest.fail(f"Contract missing ({adr}): module {name}: {error}", pytrace=False)


@dataclass
class FrozenClock:
    """A settable UTC clock for tests that cross openings, closes, DST nights and grace ends.

    Pass `clock.now` wherever the product takes a `now` callable; move it with `advance` or
    `set`. It never reads the real time.
    """

    current: datetime = field(default_factory=lambda: datetime(2026, 11, 13, 12, 0, tzinfo=UTC))

    def now(self) -> datetime:
        return self.current

    def advance(self, **delta: float) -> datetime:
        self.current = self.current + timedelta(**delta)
        return self.current

    def set(self, moment: datetime) -> datetime:
        if moment.tzinfo is None:
            raise ValueError("FrozenClock needs an aware datetime")
        self.current = moment.astimezone(UTC)
        return self.current

    @property
    def as_callable(self) -> Callable[[], datetime]:
        return self.now
