"""Lost acknowledgement retries are scoped to an exact action, not a key alone."""

from fastapi.testclient import TestClient

from selecta.api import create_app
from selecta.config import Settings


def test_operation_id_deduplicates_only_the_exact_command(tmp_path):
    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
    headers = {"x-operation-id": "test-scope-123"}
    first = client.post("/api/drafts", json={}, headers=headers)
    assert first.status_code == 200
    first_id = first.json()["id"]

    replay = client.post("/api/drafts", json={}, headers=headers)
    assert replay.status_code == 200
    assert replay.json()["id"] == first_id

    # A different POST endpoint must not return a cached draft-create result.
    collision = client.post("/api/analysis/start", json={}, headers=headers)
    assert collision.status_code == 409
    assert "different action" in collision.json()["detail"]

    # A changed JSON body to the original endpoint also cannot hijack the key.
    collision = client.post("/api/drafts", json={"name": "Other"}, headers=headers)
    assert collision.status_code == 409

    # No accidental extra draft is created.
    assert len(client.get("/api/drafts").json()["drafts"]) == 1


def test_retries_waiting_on_a_failed_operation_rerun_it_only_once(tmp_path):
    """Two retries wait while the first try runs; it fails with a 5xx, so one of them runs the
    operation again and the other gets that rerun's answer instead of doing it a third time."""
    import asyncio

    import httpx
    from fastapi.responses import JSONResponse

    app = create_app(Settings(tmp_path), tmp_path / "no-web")
    calls: list[int] = []
    started, release = asyncio.Event(), asyncio.Event()

    @app.post("/api/test-flaky-operation")
    async def flaky():
        calls.append(len(calls))
        if len(calls) == 1:
            started.set()
            await release.wait()
            return JSONResponse({"detail": "first try failed"}, status_code=500)
        await asyncio.sleep(0.05)
        return {"run": len(calls)}

    async def scenario():
        transport = httpx.ASGITransport(app=app)
        headers = {"x-operation-id": "test-flaky-1"}
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:

            def send():
                return client.post("/api/test-flaky-operation", json={}, headers=headers)

            first = asyncio.create_task(send())
            await asyncio.wait_for(started.wait(), 10)
            retries = [asyncio.create_task(send()), asyncio.create_task(send())]
            for _ in range(50):  # let both retries reach the wait for the running try
                await asyncio.sleep(0)
            release.set()
            together = asyncio.gather(first, *retries)
            first_answer, *retry_answers = await asyncio.wait_for(together, 20)
            return first_answer, retry_answers

    first, retries = asyncio.run(scenario())
    assert first.status_code == 500
    assert [answer.status_code for answer in retries] == [200, 200]
    assert len(calls) == 2, f"the operation ran {len(calls)} times"
    assert retries[0].json() == retries[1].json() == {"run": 2}
