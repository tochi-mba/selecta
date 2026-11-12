"""S4-0089-02, -07, -10 and S4-0113-09, -10: the generated governance evidence stays true.

The API inventory and the PR #28 changed-path audit are regenerated from the live app and git and
must match the committed files. The release report's computed verdict must stay NO-GO until CI,
rollback, defects and verification all have proof, so a scaffold can never read as a GO.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from pydantic import BaseModel

from selecta.audit import s4_governance as gov

ROOT = Path(__file__).resolve().parents[1]


class Body(BaseModel):
    name: str


def _tiny_app() -> FastAPI:
    app = FastAPI()

    @app.get("/api/things")
    def things():
        """List the things.

        More detail that the inventory leaves out."""
        return []

    @app.post("/api/things")
    def make(body: Body):
        return body

    @app.api_route("/api/both", methods=["GET", "HEAD"])
    def both():
        return {}

    @app.get("/not-api")
    def page():
        return {}

    return app


def test_api_rows_classify_side_effects_and_owners():
    owners = {"GET /api/things": "core.things", "GET /api/both": "core.both"}
    rows = gov.api_rows(_tiny_app(), owners)
    keyed = {(row.method, row.path): row for row in rows}
    assert set(keyed) == {("GET", "/api/things"), ("POST", "/api/things"), ("GET", "/api/both")}
    assert keyed[("GET", "/api/things")].effect == "reads"
    assert keyed[("GET", "/api/things")].does == "List the things."
    assert keyed[("POST", "/api/things")].effect == "changes state"
    assert keyed[("POST", "/api/things")].flag == "UNOWNED"
    assert keyed[("POST", "/api/things")].body == "Body"
    text = gov.api_markdown(rows)
    assert "1 have no feature-flag owner" in text and "—" not in text


def test_committed_api_inventory_matches_the_live_app_and_every_route_has_an_owner():
    rows = gov.live_api_rows()
    assert len(rows) > 100
    assert [f"{r.method} {r.path}" for r in rows if r.flag == "UNOWNED"] == []
    assert (ROOT / gov.API_DOC).read_text("utf-8") == gov.api_markdown(rows), (
        "run python -m selecta.audit.s4_governance --write"
    )


def test_path_kinds():
    assert gov.path_kind("docs/adr/x.md") == "docs"
    assert gov.path_kind("README.md") == "docs"
    assert gov.path_kind("web/src/App.tsx") == "runtime"
    assert gov.path_kind("web/src/App.test.tsx") == "test"
    assert gov.path_kind(".github/workflows/test.yml") == "ci"


@pytest.mark.skipif(not gov.has_commit(gov.PR28_MERGE), reason="shallow clone without PR #28")
def test_pr28_boundary_audit_lists_the_runtime_paths():
    rows = gov.boundary_rows()
    runtime = [row.path for row in rows if row.kind == "runtime"]
    assert len(runtime) == 14 and all(path.startswith("web/src/") for path in runtime)
    assert all(row.commits for row in rows)
    assert (ROOT / gov.BOUNDARY_DOC).read_text("utf-8") == gov.boundary_markdown(rows)


def test_phases_follow_checklist_order():
    text = "\n".join(
        [
            "### [ADR-0001 - One](a.md)",
            "**Phase:** 0 Baseline. **Decision:** Accepted.",
            "- [ ] **S4-0001-01 - a.** **Implementation: Implemented (2026-11-10).**",
            "- [ ] **S4-0001-02 - b.** **Implementation: In progress (2026-11-10).**",
            "### [ADR-0002 - Two](b.md)",
            "**Phase:** 1 Foundations. **Decision:** Accepted.",
            "- [ ] **S4-0002-01 - c.** **Implementation: Not started.**",
        ]
    )
    assert gov.phases(text) == [
        ("0 Baseline", "ADR-0001", 1, 2),
        ("1 Foundations", "ADR-0002", 0, 1),
    ]


def test_rollback_log_parsing():
    good = "this checkout again sees exactly the same\nnothing lost\nexit=0\n"
    bad = "this checkout again sees A CHANGE\n{}\nexit=1\n"
    assert gov.parse_rollback_log(good, "old")["passed"] is True
    assert gov.parse_rollback_log(bad, "old")["passed"] is False
    assert gov.parse_rollback_log("[slot] waiting\nexit=1\n", "old")["passed"] is False


def _facts(**extra) -> gov.ReleaseFacts:
    base = dict(
        head="a" * 40,
        branch="main",
        main_head="a" * 40,
        today="2026-11-12",
        merges=["abc Merge pull request #29"],
        counts={"Implemented": 2},
        verified=2,
        total=2,
        phases=[("0 Baseline", "ADR-0089", 2, 2)],
        ci_runs=[{"headSha": "a" * 40, "conclusion": "success", "workflowName": "test"}],
        rollback={"older": "9b663f9", "passed": True, "exit": 0, "notes": []},
    )
    base.update(extra)
    return gov.ReleaseFacts(**base)


def test_verdict_is_no_go_until_every_gate_has_proof():
    assert gov.computed_verdict(_facts()) == ("ready for owner GO", [])
    cases = {
        "ci_runs": None,
        "rollback": None,
        "open_p0": ["audio overlap"],
        "verified": 1,
    }
    for name, value in cases.items():
        verdict, why = gov.computed_verdict(_facts(**{name: value}))
        assert verdict == "NO-GO" and why, name
    failing = [{"headSha": "a" * 40, "conclusion": "failure"}]
    assert gov.computed_verdict(_facts(ci_runs=failing))[0] == "NO-GO"
    other_head = [{"headSha": "b" * 40, "conclusion": "success"}]
    assert gov.computed_verdict(_facts(ci_runs=other_head))[0] == "NO-GO"


def test_report_leaves_the_owner_verdict_blank():
    text = gov.report_markdown(_facts(verified=0))
    assert "**NO-GO** because:" in text
    assert "| GO or NO-GO |  |" in text
    assert "nothing lost" in text and "ADR-0089" in text and "—" not in text
