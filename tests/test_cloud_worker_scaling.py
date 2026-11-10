"""Worker scale-out benchmark and the gateway storm load test (ADR-0396 SC-0396-04, SC-0396-06).

`tests/load/worker_scaling.py` measures jobs per second for 1 to 32 workers and names the
bottleneck; here it runs small on SQLite to prove the harness, and its analysis is unit tested.
`tests/load/k6/gateway_storm.js` with `tests/load/compare_p95.py` is the staging load test for
gateway isolation; here it is checked as code against the routes that really exist. The staging
runs themselves (real workers through the gateway, the k6 storm) are separate.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

LOAD = Path(__file__).resolve().parent / "load"
sys.path.insert(0, str(LOAD))

import compare_p95  # noqa: E402
import worker_scaling  # noqa: E402
from worker_scaling import Run  # noqa: E402

from selecta.persistence import transaction  # noqa: E402
from selecta.work.schema import jobs  # noqa: E402

STORM = LOAD / "k6" / "gateway_storm.js"


def test_analysis_finds_a_monotonic_rise_and_its_bottleneck():
    runs = [Run(1, 10, 1.0), Run(2, 20, 1.0), Run(4, 38, 1.0), Run(8, 40, 1.0)]
    result = worker_scaling.analyse(runs)
    assert result.monotonic and result.bottleneck == 8
    assert worker_scaling.analyse(runs[:3]).bottleneck is None


def test_analysis_reports_a_fall_as_not_monotonic():
    result = worker_scaling.analyse([Run(1, 10, 1.0), Run(2, 25, 1.0), Run(4, 20, 1.0)])
    assert not result.monotonic and result.bottleneck == 4


def test_the_benchmark_drains_every_job_and_scales_with_workers(sqlite_engine):
    result = worker_scaling.benchmark(sqlite_engine, [1, 2, 4], jobs_per_worker=6, work_s=0.2)
    assert [run.jobs for run in result.runs] == [6, 12, 24]
    # SQLite has one writer, so the claim soon becomes the bottleneck; it still rises at first.
    assert result.runs[-1].per_second > result.runs[0].per_second
    with transaction(sqlite_engine) as connection:
        states = {row.state for row in connection.execute(jobs.select())}
    assert states == {"succeeded"}


def test_the_storm_uses_only_routes_the_api_and_gateway_serve():
    script = STORM.read_text("utf-8")
    api = (Path(__file__).resolve().parents[1] / "src" / "selecta" / "api_cloud.py").read_text(
        "utf-8")
    gateway = (Path(__file__).resolve().parents[1] / "src" / "selecta" / "work" /
               "gateway_api.py").read_text("utf-8")
    for route in re.findall(r"'(/api/[a-z/]+)'", script):
        assert f'@app.get("{route}")' in api, route
    for route in re.findall(r"\$\{GATEWAY\}(/internal/workers/[a-z]+)", script):
        assert f'@app.post("{route}"' in gateway, route
    assert "'http_req_duration{scenario:customers}': ['p(95)<300']" in script
    assert "__ENV.CUSTOMER_TOKEN" in script and "Bearer ey" not in script


def summary(p95: float) -> dict:
    return {"metrics": {compare_p95.METRIC: {"p(95)": p95, "avg": p95 / 2}}}


@pytest.mark.parametrize(
    ("baseline", "storm", "same"),
    [(120.0, 125.0, True), (120.0, 135.0, True), (300.0, 329.0, True), (120.0, 160.0, False)],
)
def test_customer_p95_counts_as_unchanged_within_ten_percent_or_twenty_ms(
    tmp_path, baseline, storm, same
):
    files = []
    for name, value in (("baseline", baseline), ("storm", storm)):
        path = tmp_path / f"{name}.json"
        path.write_text(json.dumps(summary(value)), "utf-8")
        files.append(str(path))
    assert compare_p95.main(files) == (0 if same else 1)
