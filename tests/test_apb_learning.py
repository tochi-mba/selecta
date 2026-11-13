"""Venue learning and privacy-safe memory (ADR-0432, AV-0432-01 to AV-0432-05)."""

from __future__ import annotations

import json

import pytest

from selecta import flags
from selecta.venueops.venue_memory import (
    DAY_S,
    AdaptationCaps,
    FeedbackEvent,
    GuestIdentifierStored,
    Provenance,
    VenueHardLimits,
    VenueMemory,
    blind_pairs,
    guest_token,
    score_blind,
)

NIGHT = "2026-11-13"
T0 = 1_800_000_000.0


def _memory() -> VenueMemory:
    return VenueMemory(salt="venue-salt")


def test_flag_exists_and_defaults_off():
    assert "venue.learning" in flags.registry()
    assert flags.resolve("")["venue.learning"].on is False


def test_provenance_kept_separate():
    m = _memory()
    m.add(FeedbackEvent(NIGHT, T0, Provenance.OWNER, "genre:disco", 1, "owner"))
    m.add(FeedbackEvent(NIGHT, T0, Provenance.STAFF, "genre:disco", 1, "staff"))
    m.add(FeedbackEvent(NIGHT, T0, Provenance.AUTOMATIC, "song:7", -1, "skip"))
    m.record_guest("phone-abc", NIGHT, T0, "genre:house", 1)
    grouped = m.by_provenance()
    assert [len(grouped[p]) for p in Provenance] == [1, 1, 1, 1]


def test_guest_raw_ids_are_never_stored():
    m = _memory()
    m.record_guest("alice@example.com", NIGHT, T0, "genre:house", 1)
    stored = m.to_json()
    assert "alice" not in stored and "venue-salt" not in stored
    with pytest.raises(GuestIdentifierStored):
        FeedbackEvent(NIGHT, T0, Provenance.GUEST, "genre:house", 1, "alice@example.com")


def test_guest_token_is_per_night():
    a = guest_token("phone", "2026-11-13", "s")
    assert a == guest_token("phone", "2026-11-13", "s")
    assert a != guest_token("phone", "2026-11-14", "s")
    assert a != guest_token("phone", "2026-11-13", "other venue")


def test_one_guest_counts_once_per_subject_per_night():
    once, many = _memory(), _memory()
    once.record_guest("p", NIGHT, T0, "genre:house", 1)
    for n in range(50):
        many.record_guest("p", NIGHT, T0 + n, "genre:house", 1)
    assert once.learned_bias() == many.learned_bias()


def test_adaptation_capped_per_night_and_total():
    caps = AdaptationCaps(per_night=0.1, total=0.25)
    m = VenueMemory(salt="s", caps=caps)
    for night in range(10):
        for _n in range(20):
            m.add(FeedbackEvent(f"2026-11-{night + 1:02d}", T0, Provenance.OWNER,
                                "genre:disco", 1, "owner"))
    assert m.learned_bias()["genre:disco"] == pytest.approx(0.25)
    one = VenueMemory(salt="s", caps=caps)
    for _n in range(100):
        one.add(FeedbackEvent(NIGHT, T0, Provenance.OWNER, "genre:disco", 1, "owner"))
    assert one.learned_bias()["genre:disco"] == pytest.approx(0.1)


def test_learning_never_overrides_hard_limits_or_bans():
    m = _memory()
    for night in range(10):
        for _ in range(20):
            m.add(FeedbackEvent(f"2026-11-{night + 1:02d}", T0, Provenance.OWNER,
                                "genre:drill", 1, "owner"))
            m.add(FeedbackEvent(f"2026-11-{night + 1:02d}", T0, Provenance.OWNER,
                                "energy:peak", 1, "owner"))
            m.add(FeedbackEvent(f"2026-11-{night + 1:02d}", T0, Provenance.STAFF,
                                "genre:jazz", -1, "staff"))
    limits = VenueHardLimits(blocked=frozenset({"genre:drill"}), ceilings={"energy:peak": 1.0})
    out = m.apply({"genre:drill": 1.0, "energy:peak": 1.0, "genre:jazz": 1.0}, limits)
    assert "genre:drill" not in out
    assert out["energy:peak"] == 1.0
    assert 0 < out["genre:jazz"] < 1.0  # less, never a permanent ban


def test_caps_reject_zeroing_configuration():
    with pytest.raises(ValueError):
        AdaptationCaps(per_night=0.5, total=1.0)


def test_reset_all_and_by_provenance():
    m = _memory()
    m.add(FeedbackEvent(NIGHT, T0, Provenance.STAFF, "genre:disco", 1, "staff"))
    m.record_guest("p", NIGHT, T0, "genre:house", 1)
    assert m.reset(Provenance.GUEST) == 1
    assert set(m.learned_bias()) == {"genre:disco"}
    assert m.reset() == 1
    assert m.learned_bias() == {}


def test_explanation_is_plain_and_names_sources():
    m = _memory()
    assert m.explain() == ["Nothing learned yet. Autopilot is using the venue's own settings."]
    for _ in range(3):
        m.add(FeedbackEvent(NIGHT, T0, Provenance.STAFF, "genre:disco", 1, "staff"))
    line = m.explain()[0]
    assert "more genre disco" in line and "3 from staff" in line and "\u2014" not in line


def test_retention_purges_old_events_and_round_trips():
    m = VenueMemory(salt="s", retention_days=30)
    m.add(FeedbackEvent(NIGHT, T0 - 31 * DAY_S, Provenance.STAFF, "genre:old", 1, "staff"))
    m.add(FeedbackEvent(NIGHT, T0 - 1 * DAY_S, Provenance.STAFF, "genre:new", 1, "staff"))
    assert m.purge(T0) == 1
    again = VenueMemory.from_json(m.to_json(), salt="s")
    assert [e.subject for e in again.events] == ["genre:new"]
    assert json.loads(m.to_json())["retention_days"] == 30


def test_blind_pairs_hide_which_is_learned_and_score():
    baseline = [["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"]]
    learned = [["a", "x"], ["c", "y"], ["e", "z"], ["g", "w"]]
    pairs, keys = blind_pairs(baseline, learned, seed=3)
    assert len(pairs) == 4 and {p.pair_id for p in pairs} == {k.pair_id for k in keys}
    blob = json.dumps([p.__dict__ for p in pairs])
    assert "learned" not in blob and "baseline" not in blob
    assert pairs == blind_pairs(baseline, learned, seed=3)[0]
    picks = {k.pair_id: k.learned_side for k in keys[:2]} | {keys[2].pair_id: "same"}
    score = score_blind(keys, picks)
    assert (score.learned, score.baseline, score.ties, score.unanswered) == (2, 0, 1, 1)
    assert score.learned_share == 1.0
