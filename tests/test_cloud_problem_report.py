"""A broken page's support reference reaches the server log (product audit, observability)."""

from __future__ import annotations

import logging

from cloud_helpers import make_cloud_app
from fastapi.testclient import TestClient


def test_an_anonymous_report_is_refused_and_a_malformed_one_never_logs(tmp_path, caplog):
    app, engine, _ = make_cloud_app(tmp_path)
    try:
        client = TestClient(app)
        body = {"reference": "R-ABCD-EF23", "kind": "page_crash", "where": "/library"}
        assert client.post("/api/account/problem-report", json=body).status_code == 401
        with caplog.at_level(logging.WARNING):
            client.post("/api/account/problem-report",
                        json={**body, "reference": "<script>"},
                        headers={"Authorization": "Bearer nope"})
        assert "client.problem" not in caplog.text
    finally:
        engine.dispose()
