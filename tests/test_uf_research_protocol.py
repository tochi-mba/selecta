"""UF-0367: the research protocol separates cohorts, scripts the six uncoached scenarios, files friction
with five fields and forbids overclaiming. It is a protocol only: no session result is recorded."""

from pathlib import Path

DOC = (Path(__file__).resolve().parents[1] / "docs/research/uf-research-protocol.md").read_text(
    encoding="utf-8"
)


def section(task: str) -> str:
    start = DOC.index(f"(UF-0367-{task})")
    end = DOC.find("\n## ", start)
    return DOC[start : end if end != -1 else len(DOC)]


def test_three_cohorts_reported_separately() -> None:
    text = section("01")
    for cohort in ("New listeners", "Experienced editors", "Assistive-technology users"):
        assert cohort in text
    assert "never pooled" in text


def test_six_neutral_scenarios_cover_the_named_journeys() -> None:
    text = section("02")
    for task in ("U1 First ready mix", "U2 Exact song", "U3 Lucy proposal", "U4 Seam edit", "U5 Bridge", "U6 Export"):
        assert task in text
    assert "dry run" in text.lower()


def test_measures_threshold_and_matching() -> None:
    measures = section("03")
    for word in ("outcome", "errors", "time", "confusion", "confidence", "recovery"):
        assert word in measures
    assert "90%" in section("04") and "Signed by" in section("04")
    assert "same six cards" in section("05")


def test_vocabulary_friction_and_conclusion_rules() -> None:
    vocab = section("06")
    for word in ("analysed", "mix-ready", "proposal", "draft", "rendering", "playing"):
        assert word in vocab
    friction = section("07")
    for field in ("Route", "Source", "Severity", "Reproduction", "Expected outcome"):
        assert f"| {field} |" in friction
    rules = section("08")
    assert "never claim" in rules and "statistical superiority" in rules


def test_no_result_is_claimed_and_no_em_dash() -> None:
    assert "It is not a result" in DOC
    assert "—" not in DOC
