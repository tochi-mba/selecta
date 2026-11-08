"""Shared set-up for Lucy's tests: the made-up e2e library, built once and copied per test, a
client, a way to talk to Lucy and wait for the reply, and ready clips placed on disk."""

from __future__ import annotations

import json
import shutil
import uuid
from dataclasses import asdict
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from selecta.api import create_app
from selecta.config import SAMPLE_RATE, Settings
from selecta.lucy import agent, readiness
from selecta.planner.memory import RULES_VERSION
from selecta.seam_kinds import SeamRequest
from selecta.seams import SeamStore


@pytest.fixture(scope="session")
def lucy_template(tmp_path_factory) -> Path:
    from e2e_server import build

    home = tmp_path_factory.mktemp("lucy-template")
    build(home)
    return home


@pytest.fixture
def lucy_home(lucy_template, tmp_path) -> Path:
    home = tmp_path / "home"
    shutil.copytree(lucy_template, home)
    readiness.forget_cache()
    return home


@pytest.fixture
def lucy(lucy_home):
    app = create_app(Settings(lucy_home), lucy_home / "no-web", prepare_links=False)
    client = TestClient(app)
    client.app_ctx = app.state.lucy
    yield client
    agent.RUNNER.wait(30)
    app.state.lucy.lucy_provider = None


def new_conversation(client: TestClient, **body) -> str:
    response = client.post("/api/lucy/conversations", json=body)
    assert response.status_code == 200, response.text
    return response.json()["id"]


def say(client: TestClient, conversation: str, text: str, expected: str | None = None,
        selection: dict | None = None, client_id: str | None = None) -> dict:
    """Send a message, wait for Lucy to finish, return the conversation snapshot."""
    response = client.post(
        f"/api/lucy/conversations/{conversation}/turns",
        json={"client_id": client_id or uuid.uuid4().hex, "text": text,
              "expected_revision": expected, "selection": selection},
    )
    assert response.status_code == 200, response.text
    agent.RUNNER.wait(60)
    return snapshot(client, conversation)


def snapshot(client: TestClient, conversation: str) -> dict:
    response = client.get(f"/api/lucy/conversations/{conversation}")
    assert response.status_code == 200, response.text
    return response.json()


def reply(snap: dict) -> dict:
    return [m for m in snap["messages"] if m["role"] == "assistant"][-1]


def current(snap: dict) -> dict:
    return snap["proposal"]["current"]


def song_ids(revision: dict) -> list[int]:
    return [song["song_id"] for song in revision["snapshot"]["songs"]]


def events(client: TestClient, conversation: str, after: int = 0) -> list[dict]:
    return client.get(f"/api/lucy/conversations/{conversation}/events.json?after={after}").json()[
        "events"]


def place_ready_seam(home: Path, a: int, b: int, move: str = "bass_swap_blend",
                     leaves_a: float = 52.0, enters_b: float = 10.0, **extra) -> SeamRequest:
    """A rendered, audited, decodable clip on disk, exactly as the seam worker leaves one."""
    request = SeamRequest(a=a, b=b, move=move)
    folder = SeamStore(Settings(home)).root / request.key
    folder.mkdir(parents=True, exist_ok=True)
    sf.write(folder / "clip.flac", np.full((SAMPLE_RATE * 8, 2), 0.01, dtype="float32"),
             SAMPLE_RATE)
    state = {"status": "ready", "key": request.key, "request": asdict(request),
             "rules": RULES_VERSION, "passed": True, "style": move,
             "a_source_start": leaves_a, "b_source_end": enters_b, "duration": 8.0, **extra}
    (folder / "seam.json").write_text(json.dumps(state), "utf-8")
    readiness.forget_cache()
    return request


def approve(client: TestClient, revision: dict, action: str = "draft") -> dict:
    response = client.post("/api/lucy/approvals", json={"revision": revision["id"],
                                                        "hash": revision["hash"],
                                                        "action": action})
    assert response.status_code == 200, response.text
    return response.json()
