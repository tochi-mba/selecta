"""EX-0129-01 and EX-0129-04: the blind study's API never names a method, and a retried, raced or
delayed answer is stored once, against the listener and trial that gave it."""

import asyncio
import json
import sqlite3
import time

import httpx

from fastapi.testclient import TestClient

import selecta.listening as listening
from selecta.api import create_app
from selecta.config import Settings


def study(tmp_path):
    settings = Settings(tmp_path)
    client = TestClient(create_app(settings, tmp_path / "no-web"))
    with sqlite3.connect(settings.db_path) as conn:
        trials = listening.create_trials(
            conn,
            "pilot",
            [
                {"pair": "secret-pair-1", "conditions": ["study-ourMethod", "study-baseline"]},
                {"pair": "secret-pair-2", "conditions": ["study-renderX", "study-renderY"]},
            ],
            seed=7,
        )
        conn.execute(
            "INSERT INTO listening_methods VALUES('study-ourMethod','SpectralBlend','v9')"
        )
    return settings, client, trials


def rows(settings, *columns):
    with sqlite3.connect(settings.db_path) as conn:
        return conn.execute(
            f"SELECT {','.join(columns)} FROM listening_responses ORDER BY trial,listener"
        ).fetchall()


def answer(choice="a", listener="ana", grade=4):
    return {
        "listener": listener,
        "setup": "headphones",
        "choice": choice,
        "quality": {"a": {"grade": grade, "tags": []}},
    }


def test_public_study_api_names_no_method_renderer_pair_or_condition(tmp_path):
    _, client, trials = study(tmp_path)
    shown = client.get("/api/listening", params={"study": "pilot"})
    assert shown.status_code == 200
    assert shown.json() == [{"id": trial, "options": ["a", "b"]} for trial in trials]
    text = json.dumps(shown.json()).casefold()
    for secret in ("secret-pair", "ourmethod", "baseline", "spectralblend", "render", "v9"):
        assert secret not in text
    saved = client.post(f"/api/listening/{trials[0]}/response", json=answer())
    assert saved.json() == {"saved": True}
    missing = client.get(f"/api/listening/{trials[0]}/a/audio")
    assert missing.status_code == 404
    assert "ourmethod" not in missing.text.casefold() and "study-" not in missing.text


def test_a_lost_acknowledgement_retry_stores_the_answer_once(tmp_path):
    settings, client, trials = study(tmp_path)
    headers = {"x-operation-id": "listening-retry-1"}
    first = client.post(f"/api/listening/{trials[0]}/response", json=answer(), headers=headers)
    again = client.post(f"/api/listening/{trials[0]}/response", json=answer(), headers=headers)
    assert first.json() == again.json() == {"saved": True}
    assert rows(settings, "trial", "listener", "choice") == [(trials[0], "ana", "a")]
    # the same operation ID can't be reused to slip in a different answer
    hijack = client.post(
        f"/api/listening/{trials[0]}/response", json=answer("b"), headers=headers
    )
    assert hijack.status_code == 409
    assert rows(settings, "choice") == [("a",)]


def test_a_race_while_the_first_answer_is_still_saving_waits_and_stores_once(tmp_path, monkeypatch):
    settings, client, trials = study(tmp_path)
    real, calls = listening.respond, []

    def slow(*args, **kwargs):
        calls.append(args[1:4])
        time.sleep(0.4)
        return real(*args, **kwargs)

    monkeypatch.setattr(listening, "respond", slow)
    headers = {"x-operation-id": "listening-race-1"}

    async def race():
        transport = httpx.ASGITransport(app=client.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1") as http:
            url = f"/api/listening/{trials[0]}/response"
            return await asyncio.gather(
                *(http.post(url, json=answer(), headers=headers) for _ in range(3))
            )

    results = asyncio.run(race())
    assert [r.status_code for r in results] == [200, 200, 200]
    assert len(calls) == 1, "only the first copy reached the study"
    assert rows(settings, "trial", "listener", "choice") == [(trials[0], "ana", "a")]


def test_answers_stay_with_their_own_listener_and_trial(tmp_path):
    settings, client, trials = study(tmp_path)
    client.post(
        f"/api/listening/{trials[0]}/response",
        json=answer("a", "ana", 5),
        headers={"x-operation-id": "listening-ana-0"},
    )
    client.post(
        f"/api/listening/{trials[0]}/response",
        json=answer("b", "ben", 1),
        headers={"x-operation-id": "listening-ben-0"},
    )
    client.post(
        f"/api/listening/{trials[1]}/response",
        json=answer("tie", "ana", 3),
        headers={"x-operation-id": "listening-ana-1"},
    )
    # a delayed late copy of Ana's first answer replays its stored result, it is not a new row
    late = client.post(
        f"/api/listening/{trials[0]}/response",
        json=answer("a", "ana", 5),
        headers={"x-operation-id": "listening-ana-0"},
    )
    assert late.json() == {"saved": True}
    assert sorted(rows(settings, "trial", "listener", "choice")) == sorted(
        [(trials[0], "ana", "a"), (trials[0], "ben", "b"), (trials[1], "ana", "tie")]
    )
    with sqlite3.connect(settings.db_path) as conn:
        grades = sorted(conn.execute("SELECT trial,listener,grade FROM listening_quality"))
    assert grades == sorted([(trials[0], "ana", 5), (trials[0], "ben", 1), (trials[1], "ana", 3)])


def test_an_unknown_trial_or_bad_answer_saves_nothing_and_says_why(tmp_path):
    settings, client, trials = study(tmp_path)
    unknown = client.post("/api/listening/nope/response", json=answer())
    assert unknown.status_code == 400 and "Unknown listening trial" in unknown.json()["detail"]
    bad = client.post(f"/api/listening/{trials[0]}/response", json=answer("maybe"))
    assert bad.status_code == 400 and "cannot_judge" in bad.json()["detail"]
    nobody = client.post(f"/api/listening/{trials[0]}/response", json=answer(listener=" "))
    assert nobody.status_code == 400 and "listener" in nobody.json()["detail"]
    assert rows(settings, "trial") == []
