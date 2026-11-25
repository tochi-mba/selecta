"""Shadow recording changes nothing a member or the old ledger can see (ADR-0487 rule 1).

The same turns are run for two Premium accounts, one with `lucy.usage_shadow` off and one with
it on. Everything the turn model writes must be identical; only the new ledger differs.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, BOB, auth
from test_lucy_cloud import converse, events, lucy, script, send, snapshot  # noqa: F401

from selecta import flags
from selecta.ai import usage_units
from selecta.ai.schema import ai_runs, ai_spend_daily, ai_usage
from selecta.ai.usage_schema import lucy_usage_ledger, lucy_usage_state
from selecta.persistence import transaction

pytest_plugins = ("cloud_party",)
BUILD = "+cloud.local_media +lucy.cloud_conversation"
RUN_COLUMNS = ("tier", "request_class", "requested_class", "allowance_class", "deployment_id",
               "fallback_used", "limited", "outcome", "tokens_in", "tokens_out", "cost_usd",
               "reserved_usd", "error_code", "prompt_version")
TURNS = [
    ("hi", [{"chunks": ["Hello!"]}]),
    ("play Rema", [{"error": "The provider took too long.", "code": "timeout"}]),
    ("make a 1 hour mix for a house party", [{"chunks": ["Here is a mix."]}]),
    ("what's playing next?", [{"chunks": ["Burna Boy."]}]),
]


def run_all(party, token: str) -> list[list[dict]]:
    logs = []
    for text, steps in TURNS:
        script(party, steps)
        conversation = converse(party, token)
        send(party, token, conversation, text)
        logs.append([{"type": e["type"], "payload": _plain(e["payload"])}
                     for e in events(party, token, conversation)])
    return logs


def _plain(payload):
    """An event payload without ids and clock values, which differ between any two runs."""
    if isinstance(payload, dict):
        return {key: _plain(value) for key, value in payload.items()
                if key not in {"message", "run", "turn", "id", "at", "seq", "ms", "elapsed_ms",
                               "started_at", "created_at"}}
    if isinstance(payload, list):
        return [_plain(item) for item in payload]
    return payload


def rows(party, table, workspace: str, columns) -> list[tuple]:
    with transaction(party.engine) as conn:
        found = conn.execute(
            sa.select(*[table.c[name] for name in columns])
            .where(table.c.workspace_id == workspace).order_by(table.c.id)
        ).all()
    return [tuple(row) for row in found]


def spent(party) -> tuple[float, float]:
    with transaction(party.engine) as conn:
        row = conn.execute(sa.select(
            sa.func.coalesce(sa.func.sum(ai_spend_daily.c.spent_usd), 0.0),
            sa.func.coalesce(sa.func.sum(ai_spend_daily.c.reserved_usd), 0.0))).one()
    return float(row[0]), float(row[1])


def count(party, table, workspace: str) -> int:
    with transaction(party.engine) as conn:
        return conn.scalar(sa.select(sa.func.count()).select_from(table)
                           .where(table.c.workspace_id == workspace))


def test_shadow_recording_leaves_the_turn_model_rows_and_events_identical(lucy):  # noqa: F811
    alice, bob = lucy.workspaces[ALICE], lucy.workspaces[BOB]
    before = spent(lucy)

    flags.use(f"{BUILD} -lucy.usage_shadow")
    off_events = run_all(lucy, ALICE)
    middle = spent(lucy)
    flags.use(f"{BUILD} +lucy.usage_shadow")
    on_events = run_all(lucy, BOB)
    after = spent(lucy)

    assert rows(lucy, ai_runs, alice, RUN_COLUMNS) == rows(lucy, ai_runs, bob, RUN_COLUMNS)
    usage_columns = ("month", "request_class", "turns", "tokens_in", "tokens_out",
                     "cache_read_tokens", "cost_usd")
    assert sorted(rows(lucy, ai_usage, alice, usage_columns)) == sorted(
        rows(lucy, ai_usage, bob, usage_columns))
    assert on_events == off_events
    assert middle[0] - before[0] == pytest.approx(after[0] - middle[0])
    assert middle[1] - before[1] == pytest.approx(after[1] - middle[1])

    # only the new ledger differs: nothing for the account with shadow off, a row per run on
    assert count(lucy, lucy_usage_ledger, alice) == 0 and count(lucy, lucy_usage_state, alice) == 0
    assert count(lucy, lucy_usage_ledger, bob) == len(TURNS)


def test_the_pages_get_exactly_the_same_keys_with_shadow_on_and_off(lucy):  # noqa: F811
    def keys(token):
        account = lucy.client.get("/api/account", headers=auth(token)).json()
        settings = lucy.client.get("/api/account/lucy", headers=auth(token)).json()
        return sorted(account), sorted(account["usage"]), sorted(settings)

    flags.use(f"{BUILD} -lucy.usage_shadow")
    off = keys(ALICE)
    flags.use(f"{BUILD} +lucy.usage_shadow")
    script(lucy, [{"chunks": ["Hello!"]}])
    send(lucy, ALICE, converse(lucy, ALICE), "hi")
    assert keys(ALICE) == off  # no usage_windows, no lucy_windows: shadow shows nothing


@pytest.mark.parametrize("broken", ["record_shadow", "settle"])
def test_a_failure_in_shadow_code_never_breaks_a_turn(lucy, monkeypatch, broken):  # noqa: F811
    flags.use(f"{BUILD} +lucy.usage_shadow")

    def explode(*args, **kwargs):
        raise RuntimeError("shadow ledger is broken")

    monkeypatch.setattr(usage_units, broken, explode)
    script(lucy, [{"chunks": ["Hello!"]}])
    conversation = converse(lucy, ALICE)

    assert send(lucy, ALICE, conversation, "hi").status_code == 200
    reply = snapshot(lucy, ALICE, conversation)["messages"][-1]
    assert reply["content"] == "Hello!" and reply["status"] == "complete"
    assert rows(lucy, ai_runs, lucy.workspaces[ALICE], ("outcome",)) == [("completed",)]
