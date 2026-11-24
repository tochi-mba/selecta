"""Lucy in Cloud with several devices on one conversation (ADR-0476 items 15-36).

A gated fake model holds an answer open mid-stream, so a second device can send, stop, delete,
save or join while it runs. Alice is on Premium (`cloud_party`), Carol on Free.
"""

from __future__ import annotations

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, CAROL, auth

from selecta import flags
from selecta.ai import allowance
from selecta.ai.registry import RequestClass, Tier
from selecta.ai.schema import ai_runs, ai_usage
from selecta.lucy import cloud_agent
from selecta.lucy.cloud_schema import lucy_cloud_events, lucy_cloud_messages
from selecta.lucy.providers import TurnResult
from selecta.persistence import transaction

pytest_plugins = ("cloud_party",)
BASE = "/api/lucy-cloud"


class Gated:
    """Says `first`, waits for the test to open the gate, then says `second`."""

    name = "scripted"
    model = "gated"

    def __init__(self, first: str = "Half ", second: str = "and the rest.", calls=None):
        self.first, self.second, self.calls = first, second, list(calls or [])
        self.gate = threading.Event()
        self.started = threading.Event()
        self.systems: list[list[str]] = []

    def tool(self, name, description, schema):
        return {"name": name}

    def user(self, text):
        return {"role": "user", "content": text}

    def results(self, turn, outputs):
        return [{"role": "assistant", "content": turn.text},
                {"role": "user", "content": [{"tool_result": t} for _c, t, _ok in outputs]}]

    async def turn(self, system, messages, tools, on_text):
        self.systems.append(list(system))
        if self.calls:
            from selecta.lucy.providers import ToolCall

            call = self.calls.pop(0)
            return TurnResult(calls=[ToolCall("c1", call["name"], call["input"])])
        await on_text(self.first)
        self.started.set()
        await asyncio.to_thread(self.gate.wait, 20)
        await on_text(self.second)
        return TurnResult(text=self.first + self.second, tokens_in=100, tokens_out=10)


@pytest.fixture
def lucy(party, monkeypatch):
    flags.use("+cloud.local_media +lucy.cloud_conversation")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")
    monkeypatch.setattr(cloud_agent, "FLUSH_SECONDS", 0.0)
    holder = {"provider": Gated()}
    party.app.state.lucy_cloud_provider = lambda settings, plan: holder["provider"]
    party.extra["holder"] = holder
    yield party
    holder["provider"].gate.set()
    cloud_agent.RUNNER.wait()
    flags.use(None)


def gated(party, **options) -> Gated:
    provider = Gated(**options)
    party.extra["holder"]["provider"] = provider
    return provider


def converse(party, token=CAROL) -> str:
    return party.client.post(f"{BASE}/conversations", headers=auth(token), json={}).json()["id"]


def send(party, conversation, text, client_id, device=None, token=CAROL):
    body = {"client_id": client_id, "text": text}
    if device:
        body["device_id"] = device
    return party.client.post(f"{BASE}/conversations/{conversation}/turns", headers=auth(token),
                             json=body)


def snapshot(party, conversation, token=CAROL):
    return party.client.get(f"{BASE}/conversations/{conversation}", headers=auth(token)).json()


def events_after(party, conversation, after, token=CAROL):
    return party.client.get(f"{BASE}/conversations/{conversation}/events.json?after={after}",
                            headers=auth(token)).json()["events"]


# 16 and 17: one turn at a time, decided by the server ------------------------------------


def test_the_device_that_loses_the_race_is_told_which_device_lucy_is_answering(lucy):
    phone = lucy.register(CAROL, "Carol's phone")["device"]["id"]
    laptop = lucy.register(CAROL, "Carol's laptop")["device"]["id"]
    provider = gated(lucy)
    conversation = converse(lucy)
    with ThreadPoolExecutor(2) as pool:
        answers = list(pool.map(
            lambda args: send(lucy, conversation, *args),
            [("from the phone", "p1", phone), ("from the laptop", "l1", laptop)],
        ))
    codes = sorted(a.status_code for a in answers)
    assert codes == [200, 409]
    won = next(a for a in answers if a.status_code == 200)
    lost = next(a for a in answers if a.status_code == 409).json()["detail"]
    assert lost["code"] == "busy"
    sender = "Carol's phone" if won.json()["turn"]["seq"] and any(
        m["content"] == "from the phone" for m in snapshot(lucy, conversation)["messages"]
    ) else "Carol's laptop"
    assert f"Lucy is answering a message from {sender}." in lost["message"]
    provider.gate.set()
    cloud_agent.RUNNER.wait()
    # the losing words never became a turn
    texts = [m["content"] for m in snapshot(lucy, conversation)["messages"] if m["role"] == "user"]
    assert len(texts) == 1


def test_one_send_retried_at_once_is_one_turn_and_order_is_the_servers(lucy):
    provider = gated(lucy)
    provider.gate.set()
    conversation = converse(lucy)
    with ThreadPoolExecutor(2) as pool:
        answers = list(pool.map(lambda _n: send(lucy, conversation, "hello", "same-id"),
                                range(2)))
    cloud_agent.RUNNER.wait()
    assert {a.status_code for a in answers} <= {200, 409}
    turns = {a.json()["turn"]["id"] for a in answers if a.status_code == 200}
    assert len(turns) == 1
    late = send(lucy, conversation, "hello", "same-id")  # a slow retry, after the answer
    assert late.json()["turn"]["id"] in turns and late.json()["new"] is False
    seqs = [m["seq"] for m in snapshot(lucy, conversation)["messages"]]
    assert seqs == sorted(seqs) and len(seqs) == 2


# 18: any device can stop ------------------------------------------------------------------


def test_a_stop_from_another_device_ends_the_answer_everywhere_and_says_so(lucy):
    provider = gated(lucy)
    conversation = converse(lucy)
    send(lucy, conversation, "go on then", "s1")
    assert provider.started.wait(10)
    stopped = lucy.client.post(f"{BASE}/conversations/{conversation}/stop", headers=auth(CAROL))
    assert stopped.json()["stopped"] is True
    provider.gate.set()
    cloud_agent.RUNNER.wait()
    reply = snapshot(lucy, conversation)["messages"][-1]
    assert reply["status"] == "cancelled"
    assert reply["content"].startswith("Half ") and "(Stopped. Nothing was changed.)" in reply[
        "content"]
    assert "and the rest." not in reply["content"]
    with transaction(lucy.engine) as conn:
        assert conn.execute(sa.select(ai_runs.c.outcome)).scalar_one() == "cancelled"


def test_a_stop_mark_alone_stops_a_turn_another_server_is_running(lucy, monkeypatch):
    monkeypatch.setattr(cloud_agent, "STOP_CHECK_SECONDS", 0.0)
    provider = gated(lucy)
    conversation = converse(lucy)
    send(lucy, conversation, "go on then", "s1")
    assert provider.started.wait(10)
    # what the stop route writes, without this process's own signal
    from selecta.lucy import cloud_store

    with transaction(lucy.engine, lucy.workspaces[CAROL]) as conn:
        active = cloud_store.active_turn(conn, lucy.workspaces[CAROL], conversation)
        cloud_store.set_turn(conn, lucy.workspaces[CAROL], active.id, status="stopping")
    provider.gate.set()
    cloud_agent.RUNNER.wait()
    assert snapshot(lucy, conversation)["messages"][-1]["status"] == "cancelled"


# 19: joining mid-answer --------------------------------------------------------------------


def test_a_device_joining_mid_answer_gets_the_text_so_far_then_exactly_the_rest(lucy):
    provider = gated(lucy, first="The first half, ", second="then the second half.")
    conversation = converse(lucy)
    send(lucy, conversation, "tell me", "j1")
    assert provider.started.wait(10)
    joined = snapshot(lucy, conversation)
    partial = joined["messages"][-1]
    assert partial["status"] == "streaming" and partial["content"] == "The first half, "
    provider.gate.set()
    cloud_agent.RUNNER.wait()
    later = events_after(lucy, conversation, joined["cursor"])
    text = partial["content"]
    for event in later:
        if event["type"] == "message.delta" and event["payload"]["message"] == partial["id"]:
            text += event["payload"]["text"]
    done = next(e for e in later if e["type"] == "message.completed")
    assert done["payload"]["content"] == "The first half, then the second half."
    assert text in ("The first half, ", "The first half, then the second half.")
    assert all(e["id"] > joined["cursor"] for e in later)


# 21: a save answered from two devices -------------------------------------------------------


def test_a_proposal_saved_on_one_device_cannot_be_saved_again_from_another(lucy):
    ids = [entry["song_id"] for entry in lucy.client.post(
        "/api/local-media/songs", headers=auth(CAROL),
        json={"songs": [{"content_sha256": f"{n + 7:x}" * 64, "title": f"S{n}", "artist": "A"}
                        for n in range(2)]}).json()["songs"]]
    provider = gated(lucy, calls=[{"name": "propose_new_mix",
                                   "input": {"name": "Two", "song_ids": ids, "summary": "x"}}])
    provider.gate.set()
    conversation = converse(lucy)
    send(lucy, conversation, "make a mix", "m1")
    cloud_agent.RUNNER.wait()
    revision = snapshot(lucy, conversation)["proposal"]["current"]
    tokens = [lucy.client.post(f"{BASE}/approvals", headers=auth(CAROL), json={
        "revision": revision["id"], "hash": revision["hash"], "action": "draft"}).json()["token"]
        for _device in range(2)]
    first = lucy.client.post(f"{BASE}/commits", headers=auth(CAROL),
                             json={"token": tokens[0], "idempotency_key": "laptop-key"})
    second = lucy.client.post(f"{BASE}/commits", headers=auth(CAROL),
                              json={"token": tokens[1], "idempotency_key": "phone-key"})
    assert first.status_code == 200
    assert second.status_code == 409 and second.json()["detail"]["code"] == "already_saved"
    assert len(lucy.client.get("/api/local-media/recipes", headers=auth(CAROL))
               .json()["recipes"]) == 1
    kinds = [e["type"] for e in events_after(lucy, conversation, 0)]
    assert kinds.count("commit.updated") == 1


# 28: delete while answering -----------------------------------------------------------------


def test_a_conversation_deleted_mid_answer_stays_deleted(lucy):
    provider = gated(lucy)
    conversation = converse(lucy)
    send(lucy, conversation, "hello", "d1")
    assert provider.started.wait(10)
    gone = lucy.client.delete(f"{BASE}/conversations/{conversation}", headers=auth(CAROL))
    assert gone.status_code == 200
    provider.gate.set()
    cloud_agent.RUNNER.wait()
    with transaction(lucy.engine) as conn:
        for table in (lucy_cloud_events, lucy_cloud_messages):
            left = conn.execute(sa.select(sa.func.count()).select_from(table)
                                .where(table.c.conversation_id == conversation)).scalar_one()
            assert left == 0
    assert send(lucy, conversation, "hello", "d1").status_code == 404
    # the account's run slot is free for the next conversation
    provider = gated(lucy)
    provider.gate.set()
    assert send(lucy, converse(lucy), "again", "d2").status_code == 200


# 31: the last turn --------------------------------------------------------------------------


def test_two_sends_racing_for_the_last_turn_count_it_once(lucy, monkeypatch):
    monkeypatch.setitem(allowance.ALLOWANCES, Tier.FREE, {RequestClass.EVERYDAY: 1})
    provider = gated(lucy)
    provider.gate.set()
    one, two = converse(lucy), converse(lucy)
    with ThreadPoolExecutor(2) as pool:
        list(pool.map(lambda args: send(lucy, *args), [(one, "hi", "a"), (two, "hi", "b")]))
    cloud_agent.RUNNER.wait()
    with transaction(lucy.engine) as conn:
        used = conn.execute(sa.select(sa.func.coalesce(sa.func.sum(ai_usage.c.turns), 0)))
        assert used.scalar_one() == 1


# 22 and 23: fresh state, and who is speaking --------------------------------------------------


def test_lucy_is_told_the_sending_device_and_fresh_state_each_turn(lucy):
    phone = lucy.register(CAROL, "Kitchen phone")["device"]["id"]
    provider = gated(lucy)
    provider.gate.set()
    conversation = converse(lucy)
    send(lucy, conversation, "play it here", "h1", device=phone)
    cloud_agent.RUNNER.wait()
    block = provider.systems[-1][-1]
    assert block.startswith("Right now (fresh for this message")
    assert "This message was sent from Kitchen phone" in block
    assert "Nothing is playing on any device." in block
    events = events_after(lucy, conversation, 0)
    accepted = next(e for e in events if e["type"] == "turn.accepted")
    assert accepted["payload"]["device"] == "Kitchen phone"


def test_a_device_id_from_another_account_is_ignored(lucy):
    alices = lucy.register(ALICE, "Alice's laptop")["device"]["id"]
    provider = gated(lucy)
    provider.gate.set()
    conversation = converse(lucy)
    send(lucy, conversation, "hi", "x1", device=alices)
    cloud_agent.RUNNER.wait()
    assert "This message's device isn't known" in provider.systems[-1][-1]


def test_practice_lucy_proposes_from_the_catalogue_with_no_ai(lucy, monkeypatch):
    from selecta.devstack import lucy_practice

    monkeypatch.setattr(lucy_practice, "WORD_SECONDS", 0.0)
    lucy.client.post("/api/local-media/songs", headers=auth(CAROL), json={"songs": [
        {"content_sha256": f"{n + 3:x}" * 64, "title": f"P{n}", "artist": "A"} for n in range(3)]})
    lucy.app.state.lucy_cloud_provider = lucy_practice.factory(lucy.engine)
    conversation = converse(lucy)
    send(lucy, conversation, "make me a mix", "p1")
    cloud_agent.RUNNER.wait()
    shown = snapshot(lucy, conversation)
    assert shown["proposal"]["current"]["snapshot"]["title"] == "Practice mix"
    assert "nothing is saved until you press Save" in shown["messages"][-1]["content"]


def test_another_device_reads_the_persons_words_from_the_events_alone(lucy):
    provider = gated(lucy)
    provider.gate.set()
    conversation = converse(lucy)
    cursor = snapshot(lucy, conversation)["cursor"]
    send(lucy, conversation, "words typed on the laptop", "w1")
    cloud_agent.RUNNER.wait()
    events = events_after(lucy, conversation, cursor)
    accepted = [e for e in events if e["type"] == "turn.accepted"]
    assert accepted[0]["payload"]["text"] == "words typed on the laptop"
    # nothing after it may stand in for the person's message with an empty one
    assert not [e for e in events if e["type"] == "message.started"
                and e["payload"].get("role") == "user"]
