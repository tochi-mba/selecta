"""Outbox events in commit order, and an event stream that resumes without gaps (SC-0407-01).

Event ids are handed out when a row is inserted, so two transactions can commit in the other
order. Readers walk `seq`, stamped as each transaction commits (migration 7c1e9a4b2f30), so a
reader that has moved past one event can never miss one that commits later.
"""

from __future__ import annotations

import json
import threading
import time

import pytest
from cloud_db import sibling_engine
from cloud_helpers import cloud_settings
from fastapi.testclient import TestClient

from selecta.api_cloud import create_cloud_app
from selecta.identity.tokens import BadSignature, Claims
from selecta.persistence import db_now, transaction
from selecta.work import outbox

TOKEN = "listener-token"


class ShortLivedVerifier:
    """Claims that expire `life` seconds after each check, which is when a stream stops, so a
    test can read a whole stream through the TestClient."""

    def __init__(self, life: float = 1.5) -> None:
        self.life = life

    def verify(self, token: str) -> Claims:
        if token != TOKEN:
            raise BadSignature("unknown test token")
        return Claims(
            subject="user_listener", issued_at=1_000, expires_at=time.time() + self.life,
            email="listener@example.test", email_verified=True,
        )


@pytest.fixture
def http(cloud_engine):
    app = create_cloud_app(cloud_settings(), engine=cloud_engine, verifier=ShortLivedVerifier())
    with TestClient(app) as client:
        answer = client.post(
            "/api/onboarding/complete",
            headers={"Authorization": f"Bearer {TOKEN}", "Origin": "https://app.test"},
            json={"age_confirmed": True},
        )
        assert answer.status_code == 201, answer.text
        client.workspace_id = answer.json()["workspace_id"]
        yield client


def emit(engine, workspace_id: str, *topics: str) -> None:
    for topic in topics:
        with transaction(engine, workspace_id) as connection:
            outbox.emit(connection, topic, workspace_id, {"topic": topic}, db_now(connection))


def read_stream(client, **headers) -> list[tuple[int, str]]:
    """Every (id, topic) frame the stream sends before the short-lived sign-in runs out."""
    answer = client.get("/api/events", headers={"Authorization": f"Bearer {TOKEN}", **headers})
    assert answer.status_code == 200
    frames = []
    for block in answer.text.split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        if "data" in lines:
            frame = json.loads(lines["data"])
            assert int(lines["id"]) == frame["id"]
            frames.append((frame["id"], frame["topic"]))
    return [(i, t) for i, t in frames if t.startswith("order.")]


def test_events_arrive_in_order_with_ids_and_a_reconnect_resumes_without_gaps(http, cloud_engine):
    emit(cloud_engine, http.workspace_id, *(f"order.{n}" for n in range(5)))
    first = read_stream(http)
    assert [topic for _, topic in first] == [f"order.{n}" for n in range(5)]
    ids = [event_id for event_id, _ in first]
    assert ids == sorted(set(ids))

    emit(cloud_engine, http.workspace_id, *(f"order.{n}" for n in range(5, 8)))
    resumed = read_stream(http, **{"Last-Event-ID": str(ids[2])})
    assert [topic for _, topic in resumed] == [f"order.{n}" for n in range(3, 8)]
    assert [event_id for event_id, _ in resumed][:2] == ids[3:]


def test_a_bad_resume_cursor_is_refused(http):
    answer = http.get(
        "/api/events", headers={"Authorization": f"Bearer {TOKEN}", "Last-Event-ID": "soon"}
    )
    assert (answer.status_code, answer.json()["detail"]["code"]) == (400, "invalid_event_cursor")


def test_every_event_gets_a_commit_order_number_on_both_databases(cloud_engine):
    with transaction(cloud_engine, "ws-seq") as connection:
        outbox.emit(connection, "order.a", "ws-seq", {}, db_now(connection))
        outbox.emit(connection, "order.b", "ws-seq", {}, db_now(connection))
    with transaction(cloud_engine) as connection:
        events = outbox.read_after(connection, 0)
    mine = [e for e in events if e.workspace_id == "ws-seq"]
    assert [e.topic for e in mine] == ["order.a", "order.b"]
    assert all(e.seq is not None for e in mine)
    assert mine[0].seq < mine[1].seq


def test_an_event_that_commits_after_a_later_id_is_still_read(postgres_engine):
    """The bug this fixes: transaction A takes the lower id, B the higher; B commits and a reader
    moves past it; then A commits. Walking ids, the reader would never see A's event."""
    other = sibling_engine(postgres_engine)
    try:
        a_inserted, a_may_commit = threading.Event(), threading.Event()
        a_ids: list[int] = []

        def transaction_a() -> None:
            with transaction(other, "ws-late") as connection:
                a_ids.append(outbox.emit(connection, "order.a", "ws-late", {},
                                         db_now(connection)))
                a_inserted.set()
                assert a_may_commit.wait(10)

        thread = threading.Thread(target=transaction_a)
        thread.start()
        assert a_inserted.wait(10)
        with transaction(postgres_engine, "ws-late") as connection:
            b_id = outbox.emit(connection, "order.b", "ws-late", {}, db_now(connection))
        assert a_ids[0] < b_id, "A holds the lower id"

        with transaction(postgres_engine) as connection:
            seen = [e for e in outbox.read_after(connection, 0) if e.workspace_id == "ws-late"]
        assert [e.topic for e in seen] == ["order.b"]
        cursor = seen[-1].seq

        a_may_commit.set()
        thread.join(10)
        with transaction(postgres_engine) as connection:
            later = [e for e in outbox.read_after(connection, cursor)
                     if e.workspace_id == "ws-late"]
        assert [e.topic for e in later] == ["order.a"]
    finally:
        other.dispose()


def test_two_hundred_writers_in_one_workspace_leave_no_gap_for_a_reader_walking_alongside(
    postgres_engine,
):
    """Writers commit in any order while a reader keeps walking from its cursor: it ends up
    with every event exactly once."""
    racing = sibling_engine(postgres_engine, pool_size=20, max_overflow=0, pool_timeout=120)
    try:
        done = threading.Event()
        start = threading.Barrier(200)

        def writer(n: int) -> None:
            start.wait()
            with transaction(racing, "ws-many") as connection:
                outbox.emit(connection, f"order.{n}", "ws-many", {}, db_now(connection))
                time.sleep((n % 7) / 1000)

        heard: list[str] = []

        def reader() -> None:
            cursor = 0
            while True:
                finished = done.is_set()
                with transaction(postgres_engine) as connection:
                    batch = outbox.read_after(connection, cursor, limit=50)
                for event in batch:
                    cursor = event.seq
                    if event.workspace_id == "ws-many":
                        heard.append(event.topic)
                if finished and not batch:
                    return

        threads = [threading.Thread(target=writer, args=(n,)) for n in range(200)]
        walker = threading.Thread(target=reader)
        walker.start()
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(60)
        done.set()
        walker.join(60)
        assert sorted(heard) == sorted(f"order.{n}" for n in range(200))
        assert len(heard) == 200
    finally:
        racing.dispose()
