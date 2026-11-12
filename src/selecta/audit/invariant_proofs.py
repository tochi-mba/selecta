"""Which tests prove the two §15.2 invariants the database can't show (SC-0411-01).

`selecta.audit.invariants` checks invariants 1-7 and 9 from the database after every cloud test.
Invariants 8 (AI output never authorises an action or bypasses limits) and 10 (the UI never shows
"done" without a verified result) leave nothing in the database to read, so their proof is a
fixed set of tests, named here by exact pytest node ID or, for the site, by spec file and test
name.

- `PYTHON` is enforced after each run: in any pytest run that collects the whole cloud test set
  (`tests/test_cloud_*.py`), the session fails if a registered test from a collected module was
  deselected, skipped, failed or never ran (`tests/invariant_gate.py`).
- `SITE` names vitest and Playwright tests that run in the site's own CI jobs; pytest can't run
  them, so `tests/test_cloud_invariant_proofs.py` checks that each named test still exists.
- The same test file checks that every `PYTHON` node ID still collects, so the registry can't rot.
"""

from __future__ import annotations

PYTHON: dict[int, tuple[str, ...]] = {
    8: (
        "tests/test_lucy_agent.py::test_unknown_operations_other_tools_and_bad_plans_never_run",
        "tests/test_lucy_agent.py::test_injected_instructions_in_song_tags_are_data",
        "tests/test_lucy_agent.py::test_every_offered_operation_has_a_tier_that_matches_its_effects",
        "tests/test_lucy_agent.py::test_cycle_and_step_budgets_are_enforced",
        "tests/test_lucy_agent.py::test_spend_cap_stops_tool_rounds",
        "tests/test_lucy_api.py::test_lucy_plans_a_proposal_that_is_not_built",
        "tests/test_lucy_api.py::"
        "test_only_the_current_revision_can_be_approved_and_commits_are_idempotent",
        "tests/test_lucy_api.py::test_save_and_play_needs_its_own_confirmation",
        "tests/test_cloud_ai_routing.py::"
        "test_a_free_request_never_reaches_a_model_a_map_lists_by_mistake",
        "tests/test_cloud_ai_routing.py::test_no_tier_ever_receives_a_deployment_above_its_allowed_set",
        "tests/test_cloud_ai_spend.py::test_the_cycle_cap_stops_a_turn_after_its_last_allowed_call",
        "tests/test_cloud_ai_spend.py::"
        "test_the_cost_cap_admits_a_call_ending_exactly_at_it_and_refuses_one_past_it",
    ),
    10: (
        "tests/test_lucy_agent.py::test_provider_failures_end_truthfully_without_touching_the_mix",
        "tests/test_lucy_agent.py::test_a_newer_turn_supersedes_and_an_older_result_never_publishes",
        "tests/test_lucy_api.py::test_a_crashed_commit_is_reconciled_by_looking_not_guessing",
        "tests/test_lucy_ready.py::test_unverifiable_clips_are_not_ready",
        "tests/test_lucy_ready.py::test_reversed_pairs_and_history_never_count_as_ready",
        "tests/test_cloud_uploads.py::test_only_a_completed_upload_can_be_accepted[sqlite]",
    ),
}

# (spec file under web/, test name exactly as written in the source)
SITE: dict[int, tuple[tuple[str, str], ...]] = {
    8: (
        (
            "src/views/LucyApprove.test.tsx",
            "disables an open confirmation when that revision is no longer current",
        ),
        (
            "src/views/LucyLxApprove.test.tsx",
            "each confirmation names its own consequence: only Save and play mentions replacing "
            "what plays",
        ),
        (
            "e2e/lx-0362-audio-focus.e2e.ts",
            "LX-0362-03 Save and play replaces the playing music only after its own confirmation",
        ),
    ),
    10: (
        ("src/cloud/Billing.test.tsx", "confirms only once the account answer shows the new plan"),
        (
            "src/cloud/Billing.test.tsx",
            "says it is still confirming after a long wait, rather than guessing",
        ),
        (
            "src/cloud/CloudApp.test.tsx",
            "confirms a return from Checkout from the server, not the address",
        ),
        (
            "src/cloud/Uploads.test.tsx",
            "stops with a plain message when a part fails, leaving what landed for next time",
        ),
        (
            "src/views/Lucy.test.tsx",
            "does not confirm strict ready-only approval when current preflight lacks verified "
            "transitions",
        ),
        (
            "src/views/LucyLx.test.tsx",
            "LX-0356-04 says sending, sent, failed, stopped, replaced and interrupted truthfully",
        ),
        (
            "src/views/LibraryLx.test.tsx",
            "a batch confirmation pressed twice sends one request and reports only after the answer",
        ),
        (
            "src/views/sfFlowWorkspace.test.tsx",
            "removes only after a yes, and reports the real amount from the server",
        ),
        (
            "e2e/mi-responsiveness.e2e.ts",
            "MI-0138-08 sending a song request shows it as Adding at once and settles to the "
            "server's answer (${outcome})",
        ),
        (
            "e2e/mp-0290-requests.e2e.ts",
            "MP-0290-06 a late answer cannot bring back a cancelled request",
        ),
    ),
}


def python_ids() -> dict[str, int]:
    """Every registered pytest node ID, with the invariant it proves."""
    return {node: number for number, nodes in PYTHON.items() for node in nodes}


__all__ = ["PYTHON", "SITE", "python_ids"]
