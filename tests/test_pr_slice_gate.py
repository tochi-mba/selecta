"""EX-0114-05: a PR description must name an owner, its verification and its rollback."""

from pathlib import Path

from selecta.audit import pr_slice_gate

TEMPLATE = Path(__file__).resolve().parents[1] / ".github/pull_request_template.md"


def test_the_template_asks_for_all_three_and_an_unfilled_one_fails():
    body = TEMPLATE.read_text(encoding="utf-8")
    for label in pr_slice_gate.FIELDS:
        assert f"**{label}:**" in body
    assert [p.split(":")[0] for p in pr_slice_gate.missing(body)] == list(pr_slice_gate.FIELDS)


def test_a_filled_description_passes(tmp_path, capsys):
    body = TEMPLATE.read_text(encoding="utf-8")
    body = body.replace("- **Owner:**", "- **Owner:** Tochi")
    body = body.replace("- **Verification:**", "- **Verification:** tests/test_x.py 3/3 at abc123")
    body = body.replace("- **Rollback:**", "- **Rollback:** turn off flag `mixes.x`")
    path = tmp_path / "body.md"
    path.write_text(body, encoding="utf-8")
    assert pr_slice_gate.missing(body) == []
    assert pr_slice_gate.main([str(path)]) == 0
    assert "owner, verification and rollback are named" in capsys.readouterr().out


def test_a_dash_or_tbd_does_not_count_as_named():
    body = "- **Owner:** -\n- **Verification:** TBD\n- **Rollback:** revert abc123\n"
    assert [p.split(":")[0] for p in pr_slice_gate.missing(body)] == ["Owner", "Verification"]
