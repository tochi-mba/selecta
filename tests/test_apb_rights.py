"""Venue music and model rights clearance (ADR-0434, AV-0434-01, -03, -04)."""

from __future__ import annotations

from pathlib import Path

import pytest

from selecta import flags
from selecta.modes import models as model_register
from selecta.venueops import rights
from selecta.venueops.rights import (
    ContentRights,
    ContentState,
    Decision,
    Operation,
    RightsRefused,
    gate,
    key_method,
)

ROOT = Path(__file__).resolve().parents[1]
NOW = 1_800_000_000.0
CLEARED = ContentRights(
    "song-1", ContentState.CLEARED, frozenset({"GB"}),
    frozenset(op.value for op in Operation), expires_at=NOW + 86_400,
)


def test_flag_exists_and_defaults_off():
    assert flags.resolve("")["venue.rights_gate"].on is False


def test_matrix_covers_every_operation_and_state():
    table = rights.matrix()
    assert set(table.operations) == {op.value for op in Operation}
    for op, row in table.operations.items():
        assert set(row["content"]) == {s.value for s in ContentState}, op
        assert all(Decision(d) for d in row["content"].values())


def test_cleared_content_allowed_in_its_territory_only():
    assert gate("play_in_venue", CLEARED, territory="GB", now=NOW).allowed
    assert gate("play_in_venue", CLEARED, territory="FR", now=NOW).decision is Decision.REFUSE


def test_expired_and_unlisted_operation_refused():
    later = gate("play_in_venue", CLEARED, territory="GB", now=NOW + 2 * 86_400)
    assert later.decision is Decision.REFUSE and "expired" in later.reasons[0]
    narrow = ContentRights("s", ContentState.CLEARED, frozenset({"GB"}),
                           frozenset({"play_in_venue"}))
    assert gate("export", narrow, territory="GB", now=NOW).decision is Decision.REFUSE


def test_unknown_and_personal_content():
    unknown = ContentRights("s")
    assert gate("play_in_venue", unknown, territory="GB").decision is Decision.NEEDS_REVIEW
    assert gate("render_seam", unknown, territory="GB").decision is Decision.REFUSE
    personal = ContentRights("s", ContentState.PERSONAL_ONLY)
    assert gate("play_in_venue", personal, territory="GB").decision is Decision.REFUSE


@pytest.mark.parametrize("op", [op.value for op in Operation])
def test_every_operation_goes_through_the_gate_and_personal_use_is_unchanged(op):
    assert gate(op, ContentRights("s"), territory="GB", commercial=False).allowed
    with pytest.raises(RightsRefused):
        rights.require(op, ContentRights("s", ContentState.BLOCKED), territory="GB")


def test_skey_refused_in_commercial_mode_with_chroma_fallback():
    result = gate("analyse_with_model", CLEARED, territory="GB", model_id="skey", now=NOW)
    assert result.decision is Decision.REFUSE and result.fallback == "chroma_key"
    assert key_method(commercial=True) == "chroma_key"
    assert key_method(commercial=False) == "skey"


def test_model_needed_for_model_operations():
    assert gate("stem_separate", CLEARED, territory="GB", now=NOW).decision is Decision.REFUSE
    stems = gate("stem_separate", CLEARED, territory="GB", now=NOW, model_id="demucs.htdemucs")
    assert stems.decision is Decision.NEEDS_REVIEW
    beats = gate("analyse_with_model", CLEARED, territory="GB", now=NOW,
                 model_id="beat_this.final0")
    assert beats.allowed
    assert gate("analyse_with_model", CLEARED, territory="GB", now=NOW,
                model_id="mystery").decision is Decision.REFUSE


def test_every_allowlist_model_reviewed_and_never_looser():
    assert rights.unreviewed_models() == []
    for model_id, status in model_register.register().items():
        decided, _ = rights.model_decision(model_id)
        if status == "blocked":
            assert decided is Decision.REFUSE, model_id
        if status == "review":
            assert decided is not Decision.ALLOW, model_id


def test_supplier_research_is_framed_as_unverified():
    text = (ROOT / "docs/autopilot/licensed-supplier-research.md").read_text("utf-8")
    assert "unverified" in text.lower() and "\u2014" not in text
