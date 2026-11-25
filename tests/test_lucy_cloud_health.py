"""Cloud Lucy says when she can't reach her models (ADR-0476; staging incident 2026-11-24).

Provider failures log one line and, when they are configuration, one alert an hour; the
self-check reports per tier; a model that fails steps down quietly; suggested first asks
come from music only; Cloud's save dialog and pill say what is true.
"""

from __future__ import annotations

import logging

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, CAROL, auth

from selecta import flags
from selecta.admin.schema import platform_alerts
from selecta.lucy import cloud_agent, cloud_health
from selecta.lucy.cloud_tools import looks_spoken, music_artists
from selecta.lucy.providers import ProviderError, ScriptedProvider
from selecta.persistence import transaction

pytest_plugins = ("cloud_party",)
BASE = "/api/lucy-cloud"


class Cause(Exception):
    """Stands in for the SDK's status error: a status and the provider's own words."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status
        self.body = {"error": {"type": "invalid_request_error", "message": message}}


def failure(status: int, message: str) -> ProviderError:
    try:
        raise ProviderError("The provider returned an error.", "provider", status >= 500) \
            from Cause(status, message)
    except ProviderError as error:
        return error


class Failing:
    name = "scripted"
    model = "failing"

    def __init__(self, problem: ProviderError) -> None:
        self.problem = problem

    def tool(self, name, description, schema):
        return {"name": name}

    def user(self, text):
        return {"role": "user", "content": text}

    async def turn(self, system, messages, tools, on_text):
        raise self.problem


@pytest.fixture
def lucy(party, monkeypatch):
    flags.use("+cloud.local_media +lucy.cloud_conversation")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")
    yield party
    cloud_agent.RUNNER.wait()
    flags.use(None)


def alerts(engine) -> list[str]:
    with transaction(engine) as conn:
        return list(conn.execute(sa.select(platform_alerts.c.summary)
                                 .where(platform_alerts.c.kind == cloud_health.ALERT_KIND))
                    .scalars())


def turn(party, token, text="hi"):
    made = party.client.post(f"{BASE}/conversations", headers=auth(token), json={}).json()
    party.client.post(f"{BASE}/conversations/{made['id']}/turns", headers=auth(token),
                      json={"client_id": "c1", "text": text})
    cloud_agent.RUNNER.wait()
    shown = party.client.get(f"{BASE}/conversations/{made['id']}", headers=auth(token)).json()
    return shown["messages"][-1]


# No silent failures ----------------------------------------------------------------------------


def test_a_missing_workspace_header_logs_a_line_and_raises_one_alert_an_hour(lucy, caplog):
    problem = failure(400, "This API key is not scoped to a workspace, so this request must "
                           "include the anthropic-workspace-id header.")
    assert problem.configuration and problem.status == 400
    lucy.app.state.lucy_cloud_provider = lambda settings, plan: Failing(problem)
    with caplog.at_level(logging.WARNING, logger="selecta.lucy.cloud"):
        reply = turn(lucy, CAROL)
        turn(lucy, CAROL)
    assert reply["status"] == "failed"
    lines = [r.getMessage() for r in caplog.records if "lucy provider failure" in r.getMessage()]
    assert lines and "status=400" in lines[0] and "deployment=haiku-low" in lines[0]
    assert "test-key-not-real" not in " ".join(lines)
    assert alerts(lucy.engine) == [
        "Lucy can't reach Anthropic: the workspace header is missing. Fix: set "
        "ANTHROPIC_WORKSPACE_ID to the Anthropic workspace for this key, or use a "
        "workspace-scoped key."]


def test_a_busy_provider_logs_but_raises_no_alert(lucy, caplog):
    lucy.app.state.lucy_cloud_provider = lambda settings, plan: Failing(
        failure(529, "Overloaded"))
    with caplog.at_level(logging.WARNING, logger="selecta.lucy.cloud"):
        reply = turn(lucy, CAROL)
    assert "Lucy is busy right now" in reply["content"]
    assert any("status=529" in r.getMessage() for r in caplog.records)
    assert alerts(lucy.engine) == []


@pytest.mark.parametrize(("status", "words", "reason"), [
    (401, "invalid x-api-key", "the API key was refused"),
    (403, "no access", "this key may not use claude-x"),
    (404, "model not found", "the model claude-x isn't available"),
])
def test_each_configuration_failure_is_explained(status, words, reason):
    assert cloud_health.explain(status, words, "claude-x")[0] == reason
    assert failure(status, words).configuration


# Step down on errors ----------------------------------------------------------------------------


def test_opus_failing_for_a_passing_reason_steps_down_to_sonnet_quietly(lucy):
    seen = []

    def factory(settings, plan):
        seen.append(plan.deployment.id)
        if plan.deployment.id == "opus-high":
            return Failing(failure(529, "Overloaded"))
        return ScriptedProvider([{"chunks": ["Answered by the next model."]}])

    lucy.app.state.lucy_cloud_provider = factory
    reply = turn(lucy, ALICE)
    assert seen == ["opus-high", "sonnet-medium"]
    assert reply["status"] == "complete" and reply["content"] == "Answered by the next model."


def test_a_refused_key_does_not_step_down(lucy):
    seen = []

    def factory(settings, plan):
        seen.append(plan.deployment.id)
        return Failing(failure(401, "invalid x-api-key"))

    lucy.app.state.lucy_cloud_provider = factory
    reply = turn(lucy, ALICE)
    assert seen == ["opus-high"] and reply["status"] == "failed"


# The self-check ----------------------------------------------------------------------------------


def test_the_self_check_reports_each_tier_and_says_ready_or_why(lucy, monkeypatch):
    asked = []

    def probe(deployment, key):
        asked.append(deployment.id)
        if deployment.id == "opus-high":
            return False, "the workspace header is missing", "set ANTHROPIC_WORKSPACE_ID"
        return True, "ready", ""

    monkeypatch.setattr(cloud_health, "_probe", probe)
    results = cloud_health.check(lucy.engine)
    assert {r.tier: r.deployment for r in results} == {
        "free": "haiku-low", "standard": "sonnet-medium", "premium": "opus-high"}
    assert sorted(asked) == ["haiku-low", "opus-high", "sonnet-medium"]
    assert cloud_health.summary(results) == (
        "Lucy: premium (opus-high): the workspace header is missing")
    monkeypatch.setattr(cloud_health, "_probe", lambda d, k: (True, "ready", ""))
    assert cloud_health.summary(cloud_health.check(lucy.engine)) == "Lucy: ready"


def test_the_self_check_says_when_no_key_is_set(lucy, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    results = cloud_health.check(lucy.engine)
    assert all(not r.ok and r.reason == "no API key is set" for r in results)
    assert results[0].fix == "set ANTHROPIC_API_KEY"


def test_the_self_check_runs_at_startup_only_where_asked(monkeypatch):
    monkeypatch.delenv("SELECTA_LUCY_SELF_CHECK", raising=False)
    monkeypatch.setenv("SELECTA_ENV", "staging")
    assert cloud_health.wanted()
    monkeypatch.setenv("SELECTA_ENV", "development")
    assert not cloud_health.wanted()
    monkeypatch.setenv("SELECTA_LUCY_SELF_CHECK", "1")
    assert cloud_health.wanted()


# Music-only suggestions --------------------------------------------------------------------------


def test_spoken_word_artists_are_never_suggested():
    songs = [
        {"id": 1, "title": "Chapter 1", "artist": "J.K. Rowling", "album": "Audiobook",
         "duration_s": 1800},
        {"id": 2, "title": "Chapter 2", "artist": "J.K. Rowling", "album": None,
         "duration_s": 1900},
        {"id": 3, "title": "The Way of Zen, Part 1", "artist": "Alan Watts",
         "album": "Lecture", "duration_s": 3000},
        {"id": 4, "title": "Ye", "artist": "Burna Boy", "album": None, "duration_s": 231},
        {"id": 5, "title": "Essence", "artist": "Wizkid", "album": None, "duration_s": 249},
        {"id": 6, "title": "Joro", "artist": "Wizkid", "album": None, "duration_s": 264},
    ]
    assert looks_spoken(songs[0]) and not looks_spoken(songs[3])
    assert [a for a, _n in music_artists(songs)] == ["Wizkid", "Burna Boy"]
    # a song a device holds now puts its artist first
    assert [a for a, _n in music_artists(songs, {4: 1})] == ["Burna Boy", "Wizkid"]


# The save dialog and the pill -----------------------------------------------------------------


def test_a_saved_proposal_says_so_and_the_dialog_names_length_and_device(lucy):
    made = lucy.client.post("/api/local-media/songs", headers=auth(CAROL), json={"songs": [
        {"content_sha256": f"{n + 31:064x}", "title": f"H{n}", "artist": "A",
         "duration_s": 200.0} for n in range(2)]}).json()["songs"]
    ids = [entry["song_id"] for entry in made]
    lucy.app.state.lucy_cloud_provider = lambda settings, plan: ScriptedProvider([
        {"calls": [{"name": "propose_new_mix",
                    "input": {"name": "Two", "song_ids": ids, "summary": "x"}}]},
        {"chunks": ["Here."]}])
    conversation = lucy.client.post(f"{BASE}/conversations", headers=auth(CAROL),
                                    json={}).json()["id"]
    lucy.client.post(f"{BASE}/conversations/{conversation}/turns", headers=auth(CAROL),
                     json={"client_id": "s1", "text": "make a mix"})
    cloud_agent.RUNNER.wait()
    revision = lucy.client.get(f"{BASE}/conversations/{conversation}",
                               headers=auth(CAROL)).json()["proposal"]["current"]
    assert revision["snapshot"]["versions"]["saved"] is False
    approved = lucy.client.post(f"{BASE}/approvals", headers=auth(CAROL), json={
        "revision": revision["id"], "hash": revision["hash"], "action": "draft_and_play"}).json()
    assert approved["preflight"]["seconds"] == 400 and approved["preflight"]["plays_on"] is None
    lucy.client.post(f"{BASE}/commits", headers=auth(CAROL), json={
        "token": approved["token"], "idempotency_key": "k1", "confirm_play": True})
    after = lucy.client.get(f"{BASE}/revisions/{revision['id']}", headers=auth(CAROL)).json()
    assert after["snapshot"]["versions"]["saved"] is True
    assert after["snapshot"]["versions"]["played"] is True
