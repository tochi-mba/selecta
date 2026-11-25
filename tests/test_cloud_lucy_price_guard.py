"""The guard on a model price changed in a running database (ADR-0487 rule 10, LM-0487-09,
`ai.price_guard`).

One usage unit is a millionth of a US dollar at the price of the deployment that answered, so a
new price on a `model_deployments` row changes how fast every allowance is spent. The pure check
is covered as tables first, then `registry.save_deployment`, the one place a stored price is
written.
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest
from cloud_admin_kit import audit_actions

from selecta.ai import price_guard as guard
from selecta.ai import registry
from selecta.ai.registry import Prices
from selecta.persistence import transaction

DEFAULTS = {d.id: d for d in registry.DEFAULT_DEPLOYMENTS}
SONNET = DEFAULTS["sonnet-medium"]
OLD = Prices(1.0, 5.0)
WHY = "provider list price went up on 2027-02-01"
MARKED = f"{WHY}, report 2027-02-03 {guard.MARKER}"


def check(new: Prices, reason: str = WHY, old: Prices = OLD) -> list[str]:
    return guard.check("sonnet-medium", old, new, reason=reason)


def test_the_marker_and_the_threshold_are_the_ones_the_procedure_names():
    assert (guard.MARKER, guard.THRESHOLD_PERCENT) == ("[lm-price-change]", 20)


ALLOWED = {
    "the same prices need no reason": (OLD, ""),
    "a small rise with a reason": (Prices(1.1, 5.5), WHY),
    "a small cut with a reason": (Prices(0.9, 4.5), WHY),
    "exactly a fifth up": (Prices(1.2, 6.0), WHY),
    "exactly a fifth down": (Prices(0.8, 4.0), WHY),
    "a large rise with the marker": (Prices(2.0, 10.0), MARKED),
    "a large cut with the marker": (Prices(0.5, 2.5), MARKED),
}


@pytest.mark.parametrize(("new", "reason"), ALLOWED.values(), ids=ALLOWED.keys())
def test_a_price_change_inside_the_rules_is_allowed(new, reason):
    assert check(new, reason) == []


REFUSED = {
    "a small rise with no reason": (Prices(1.1, 5.0), "", ["needs a reason"]),
    "a blank reason": (Prices(1.0, 5.1), "   ", ["needs a reason"]),
    "a reason that is only the marker": (Prices(2.0, 5.0), guard.MARKER, ["needs a reason"]),
    "a large rise without the marker": (Prices(1.3, 5.0), WHY, [guard.MARKER]),
    "a large cut without the marker": (Prices(1.0, 3.0), WHY, [guard.MARKER]),
    "only the output price moves far": (Prices(1.0, 6.5), WHY, ["output price"]),
    "a large change with nothing said": (Prices(3.0, 5.0), "", ["needs a reason", guard.MARKER]),
}


@pytest.mark.parametrize(("new", "reason", "says"), REFUSED.values(), ids=REFUSED.keys())
def test_a_price_change_that_breaks_a_rule_is_refused_in_a_sentence(new, reason, says):
    refusals = check(new, reason)
    assert len(refusals) == len(says), refusals
    for refusal, words in zip(refusals, says, strict=True):
        assert words in refusal and "sonnet-medium" in refusal
        assert chr(0x2014) not in refusal


def test_a_large_change_names_both_figures_and_the_procedure():
    (refusal,) = check(Prices(1.5, 5.0))
    assert "from 1 to 1.5" in refusal and "+50%" in refusal and guard.PROCEDURE in refusal


def test_a_price_that_was_nothing_counts_as_a_large_change():
    assert guard.MARKER in check(Prices(1.0, 5.0), old=Prices(0.0, 0.0))[0]


# The stored row ----------------------------------------------------------------------------------


@pytest.fixture
def seeded(cloud_engine):
    with transaction(cloud_engine) as conn:
        registry.seed_defaults(conn)
    return cloud_engine


def stored(engine, deployment_id: str = SONNET.id) -> Prices:
    with transaction(engine) as conn:
        return registry.load_deployments(conn)[deployment_id].prices


def priced(scale_in: float, scale_out: float | None = None) -> registry.Deployment:
    scale_out = scale_in if scale_out is None else scale_out
    return replace(SONNET, prices=Prices(SONNET.prices.input_usd_per_mtok * scale_in,
                                         SONNET.prices.output_usd_per_mtok * scale_out))


def price_audits(engine) -> list[dict]:
    return audit_actions(engine, action=guard.AUDIT_ACTION)


def test_a_stored_price_does_not_change_without_a_reason(seeded):
    with pytest.raises(registry.RegistryError, match="needs a reason"), transaction(seeded) as conn:
        registry.save_deployment(conn, priced(1.05))
    assert stored(seeded) == SONNET.prices and price_audits(seeded) == []


def test_a_small_change_with_a_reason_is_saved_and_audited_with_both_figures(seeded):
    wanted = priced(1.1, 0.9)
    with transaction(seeded) as conn:
        registry.save_deployment(conn, wanted, reason=WHY, actor_id="staff-1")

    assert stored(seeded) == wanted.prices
    (row,) = price_audits(seeded)
    assert (row["actor_id"], row["resource_type"], row["resource_id"]) == (
        "staff-1", "model_deployment", SONNET.id)
    assert row["reason"] == WHY and row["result"] == "success"
    assert row["metadata"]["old"] == {
        "input_usd_per_mtok": SONNET.prices.input_usd_per_mtok,
        "output_usd_per_mtok": SONNET.prices.output_usd_per_mtok,
    }
    assert row["metadata"]["new"] == {
        "input_usd_per_mtok": wanted.prices.input_usd_per_mtok,
        "output_usd_per_mtok": wanted.prices.output_usd_per_mtok,
    }
    assert row["metadata"]["marker"] is False


def test_a_large_change_is_refused_without_the_marker_and_saved_with_it(seeded):
    wanted = priced(1.5)
    with pytest.raises(registry.RegistryError, match="lm-price-change"), \
            transaction(seeded) as conn:
        registry.save_deployment(conn, wanted, reason=WHY)
    assert stored(seeded) == SONNET.prices and price_audits(seeded) == []

    with transaction(seeded) as conn:
        registry.save_deployment(conn, wanted, reason=MARKED)
    assert stored(seeded) == wanted.prices
    (row,) = price_audits(seeded)
    assert row["metadata"]["marker"] is True and row["actor_id"] is None


def test_a_large_cut_is_held_to_the_same_rule(seeded):
    with pytest.raises(registry.RegistryError, match="lm-price-change"), \
            transaction(seeded) as conn:
        registry.save_deployment(conn, priced(1.0, 0.5), reason=WHY)
    assert stored(seeded) == SONNET.prices


def test_a_save_that_leaves_the_prices_alone_needs_no_reason_and_no_audit_row(seeded):
    with transaction(seeded) as conn:  # what the staged rollout and the drain switch do
        registry.save_deployment(conn, replace(SONNET, rollout_percent=25, concurrency=3))
    with transaction(seeded) as conn:
        saved = registry.load_deployments(conn)[SONNET.id]
    assert (saved.rollout_percent, saved.concurrency) == (25, 3)
    assert price_audits(seeded) == []


def test_a_new_deployment_is_added_without_the_guard(seeded):
    fresh = replace(SONNET, id="sonnet-next", prices=Prices(9.0, 99.0))
    with transaction(seeded) as conn:
        registry.save_deployment(conn, fresh)
    assert stored(seeded, "sonnet-next") == fresh.prices and price_audits(seeded) == []


def test_seeding_again_never_touches_a_stored_price(seeded):
    with transaction(seeded) as conn:
        registry.save_deployment(conn, priced(1.1), reason=WHY)
        registry.seed_defaults(conn)
    assert stored(seeded) == priced(1.1).prices
    assert len(price_audits(seeded)) == 1


WRITES = ("update(model_deployments)", "model_deployments.update(",
          "insert(model_deployments)", "model_deployments.insert(",
          "UPDATE model_deployments", "INSERT INTO model_deployments")


def test_only_the_registry_writes_the_deployments_table():
    """`save_deployment` is the one statement that writes a price, so the guard cannot be walked
    round. A new writer must go through it or carry the same check."""
    src = Path(registry.__file__).resolve().parents[1]
    writers = set()
    for path in src.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if "migrations" not in path.parts and any(word in text for word in WRITES):
            writers.add(path.relative_to(src).as_posix())
    assert writers == {"ai/registry.py"}
