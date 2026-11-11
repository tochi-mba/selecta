"""T0252: a person moves a transition's cue while the previous render of it is still finishing and
the mix plays the fallback in the meantime. The old render finishing must not stand in for the
new choice, the mix must say the new one isn't ready (so the fallback is what plays), and once
the new one renders, any difference between what was asked and what was made is reported."""

from __future__ import annotations

import json

from test_api_contracts import (  # noqa: F401 - pytest fixtures shared with the contract tests
    _fill,
    _somewhere_for_files,
    client,
    conn,
    settings,
)


def _seam(client):  # noqa: F811
    return client.get("/api/mix").json()["mix"][1]["seam"]


def _report(settings, key, state):  # noqa: F811
    """What the render worker leaves behind for a seam."""
    folder = settings.renders_dir / "seams" / key
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "seam.json").write_text(json.dumps({"key": key, "tried": [], **state}), "utf-8")
    if state["status"] == "ready":
        (folder / "clip.flac").write_bytes(b"fLaC")


def test_a_cue_moved_while_the_old_render_finishes_never_plays_the_old_one(
    client,  # noqa: F811
    conn,  # noqa: F811
    settings,  # noqa: F811
):
    _fill(conn, 1, 2)
    conn.commit()
    assert (
        client.post("/api/mix/1/seam", json={"move": "echo_out", "exit_bar": 0}).status_code == 200
    )
    before = _seam(client)
    old_key = before["state"]["key"]
    _report(settings, old_key, {"status": "rendering"})
    assert _seam(client)["state"]["status"] == "rendering"

    # the person moves where the first song is left, while that render is still going
    moved = client.post("/api/mix/1/seam", json={"move": "echo_out", "exit_bar": 1})
    assert moved.status_code == 200
    after = _seam(client)
    assert after["settings"]["exit_bar"] == 1  # what they intend
    new_key = after["state"]["key"]
    assert new_key != old_key
    assert after["state"]["status"] != "ready"  # so the fallback is what plays meanwhile

    # the old render finishes now: it stays the old choice's, and can't be heard as the new one
    _report(settings, old_key, {"status": "ready", "passed": True, "style": "echo_out"})
    late = _seam(client)
    assert late["state"]["key"] == new_key
    assert late["state"]["status"] != "ready"
    assert late["settings"]["exit_bar"] == 1

    # the new one renders, but the worker had to use a different move than the one asked for
    _report(
        settings,
        new_key,
        {
            "status": "ready",
            "passed": True,
            "style": "bass_swap_blend",
            "exit_bar": 1,
            "tried": [{"move": "echo_out"}],
        },
    )
    done = _seam(client)
    assert done["state"]["key"] == new_key and done["state"]["status"] == "ready"
    # intended and actual stay side by side, so the page can say which plays and why
    assert done["settings"]["move"] == "echo_out"
    assert done["state"]["style"] == "bass_swap_blend"


def test_moving_the_cue_back_picks_the_old_render_up_again(client, conn, settings):  # noqa: F811
    _fill(conn, 1, 2)
    conn.commit()
    client.post("/api/mix/1/seam", json={"move": "echo_out", "exit_bar": 0}).raise_for_status()
    first = _seam(client)["state"]["key"]
    _report(settings, first, {"status": "ready", "passed": True, "style": "echo_out"})
    client.post("/api/mix/1/seam", json={"move": "echo_out", "exit_bar": 1}).raise_for_status()
    assert _seam(client)["state"]["status"] != "ready"
    client.post("/api/mix/1/seam", json={"move": "echo_out", "exit_bar": 0}).raise_for_status()
    back = _seam(client)
    assert back["state"]["key"] == first and back["state"]["status"] == "ready"
