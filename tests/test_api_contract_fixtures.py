"""T0075: the server's pre-2.0 contracts, kept as fixtures, still hold.

`tests/fixtures/api_contracts_baseline.json` records two things:

* every route the pre-redesign server (main `911c981`) offered, method and path,
  read from that commit's `src/selecta/api.py`;
* the response shape of each of its read routes against the made-up library
  used by `test_api_contracts.py`.

Evolution is additive (ADR-0026): new fields and routes are fine, but a route
that disappears, a field that vanishes or a field that changes type would break
an older page or script, so it fails here. Re-capture deliberately with
`SELECTA_CAPTURE_CONTRACTS=1` only when a breaking change has been agreed.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from test_api_contracts import (  # noqa: F401 - pytest fixtures shared with the contract tests
    _somewhere_for_files,
    client,
    conn,
    settings,
)

FIXTURE = Path(__file__).parent / "fixtures" / "api_contracts_baseline.json"
CAPTURE = os.environ.get("SELECTA_CAPTURE_CONTRACTS") == "1"

READS = [
    "/api/status",
    "/api/storage",
    "/api/songs?state=all",
    "/api/songs/1",
    "/api/mix",
    "/api/drafts",
    "/api/requests",
    "/api/discoveries",
    "/api/memory",
    "/api/memory/ratings",
    "/api/links",
    "/api/vibes",
    "/api/listening",
]


def shape(value):
    """The contract of a value: keys and kinds, not the data itself."""
    if isinstance(value, dict):
        return {key: shape(item) for key, item in sorted(value.items())}
    if isinstance(value, list):
        return [shape(value[0])] if value else []
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "str"
    return "null"


def breaks(expected, actual, where="$"):
    """Every way `actual` fails to honour `expected`; extra fields are allowed."""
    if expected == "null" or actual == "null":
        return []  # optional values were and are allowed to be missing
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return [f"{where}: was an object, now {actual!r}"]
        found = []
        for key, item in expected.items():
            if key not in actual:
                found.append(f"{where}.{key}: field removed")
            else:
                found.extend(breaks(item, actual[key], f"{where}.{key}"))
        return found
    if isinstance(expected, list):
        if not isinstance(actual, list):
            return [f"{where}: was a list, now {actual!r}"]
        if expected and actual:
            return breaks(expected[0], actual[0], f"{where}[0]")
        return []
    return [] if expected == actual else [f"{where}: was {expected}, now {actual}"]


def _baseline():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_the_shape_check_allows_additions_and_catches_removals():
    old = {"a": "str", "b": [{"c": "number"}], "d": "null"}
    assert breaks(old, {"a": "str", "b": [{"c": "number", "new": "bool"}], "d": "str", "e": "str"}) == []
    assert breaks(old, {"b": []}) == ["$.a: field removed"]
    assert breaks(old, {"a": "number", "b": [{"c": "number"}]}) == ["$.a: was str, now number"]
    assert breaks(old, {"a": "str", "b": {"c": "number"}}) == ["$.b: was a list, now {'c': 'number'}"]


def test_every_pre_redesign_route_is_still_offered(client):  # noqa: F811
    offered = {
        (method.lower(), route.path)
        for route in client.app.routes
        for method in (getattr(route, "methods", None) or ())
    }
    routes = [tuple(pair) for pair in _baseline()["routes"]]
    assert len(routes) == 73
    assert [pair for pair in routes if pair not in offered] == []


@pytest.mark.parametrize("address", READS)
def test_each_read_still_answers_with_its_recorded_shape(client, address):  # noqa: F811
    response = client.get(address)
    assert response.status_code == 200, response.text
    actual = shape(response.json())
    if CAPTURE:
        data = _baseline()
        data["responses"][address] = actual
        FIXTURE.write_text(json.dumps(data, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        return
    expected = _baseline()["responses"][address]
    assert breaks(expected, actual) == []
