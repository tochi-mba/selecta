"""The k6 load scripts parse and target what their tasks measure (SC-0407-04, SC-0408-03).

Running them needs staging, synthetic users and k6 (with xk6-sse for the stream test); this
checks that each script is valid JavaScript, only calls routes the Cloud API serves, and keeps
the pass/fail thresholds its task promises.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

from selecta import flags

ROOT = Path(__file__).resolve().parents[1]
LOAD = ROOT / "tests" / "load"
SCRIPTS = sorted(LOAD.glob("*.js"))


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
@pytest.mark.parametrize("script", SCRIPTS, ids=lambda path: path.name)
def test_each_script_is_valid_javascript(script, tmp_path):
    module = tmp_path / f"{script.stem}.mjs"
    module.write_text(script.read_text("utf-8"), "utf-8")
    subprocess.run(["node", "--check", str(module)], check=True)


@pytest.mark.parametrize("script", SCRIPTS, ids=lambda path: path.name)
def test_each_script_only_calls_cloud_routes(script):
    text = script.read_text("utf-8")
    paths = set(re.findall(r'"(/api/[a-z0-9/_-]+)"', text))
    paths |= set(re.findall(r"`\$\{API\}(/api/[a-z0-9/_-]+)`", text))
    cloud_routes = {
        route.split(" ", 1)[1]
        for route, owner in flags.route_owners().items()
        if route.startswith("GET ") and "cloud" in flags.registry()[owner].modes
    }
    assert paths and sorted(paths - cloud_routes) == []


def test_the_sse_script_holds_l3_streams_with_routine_reads_alongside():
    text = (LOAD / "sse_connections.js").read_text("utf-8")
    assert 'Number(__ENV.STREAMS || 10000)' in text  # L3: 10,000 active users
    assert 'import sse from "k6/x/sse"' in text
    for threshold in ('sse_first_frame_ms: ["p(95)<25000"]', 'sse_held_open: ["rate>0.99"]',
                      '"http_req_duration{scenario:routine}": ["p(95)<300"]'):
        assert threshold in text
    assert "X-Workspace-ID" in text


def test_the_admin_script_runs_twenty_viewers_against_a_baseline():
    text = (LOAD / "admin_read_isolation.js").read_text("utf-8")
    assert re.search(r"admins: \{[^}]*vus: 20,", text, re.S)
    assert '"customer_latency_ms{phase:baseline}": ["p(95)<300"]' in text
    assert '"customer_latency_ms{phase:with_admins}": ["p(95)<300"]' in text
    assert "before * 1.1" in text and "X-Admin-Session" in text
    assert "startTime: PHASE" in text
