"""T0175: the seam inspector's settings under fast switching and malformed cues.

The client fixture's server is real apart from rendering, which is replaced by a queue that answers
with each request's own key, so what the mix row reports can be compared with the request it came from.
"""

from __future__ import annotations

import pytest
from test_api_contracts import (  # noqa: F401 - pytest fixtures shared with the contract tests
    _fill,
    _somewhere_for_files,
    client,
    conn,
    settings,
)

from selecta.seam_kinds import request_from


def _row(client, position=1):  # noqa: F811
    return client.get("/api/mix").json()["mix"][position]


def test_fast_style_switching_ends_on_the_last_choice_and_its_own_render(client, conn):  # noqa: F811
    _fill(conn, 1, 2)
    conn.commit()
    choices = [
        {"move": "auto"},
        {"move": "echo_out"},
        {"move": "auto", "bars": 16},
        {"move": "echo_out", "bars": 8},
    ]
    for choice in choices:
        assert client.post("/api/mix/1/seam", json=choice).status_code == 200
    row = _row(client)
    last = choices[-1]
    assert {key: row["seam"]["settings"][key] for key in last} == last
    # the row's render state is keyed to the last choice, never to an earlier one
    keys = [request_from(1, 2, {**choice}).key for choice in choices]
    assert len(set(keys)) == len(keys)
    assert row["seam"]["state"]["key"] == keys[-1]
    # rendering now asks for the last choice's audio
    assert client.post("/api/mix/1/render").json()["key"] == keys[-1]


def test_an_unknown_style_is_refused_and_the_saved_one_stays(client, conn):  # noqa: F811
    _fill(conn, 1, 2)
    conn.commit()
    client.post("/api/mix/1/seam", json={"move": "echo_out"})
    refused = client.post("/api/mix/1/seam", json={"move": "not-a-style"})
    assert refused.status_code == 400
    assert _row(client)["seam"]["settings"]["move"] == "echo_out"


@pytest.mark.parametrize(
    "cue",
    [
        {"exit_bar": -5},
        {"entry_bar": 10**6},
        {"exit_bar": "eight"},
        {"bars": 0, "exit_bar": -1, "entry_bar": -1},
    ],
)
def test_a_malformed_cue_never_breaks_the_mix_or_its_render_request(client, conn, cue):  # noqa: F811
    _fill(conn, 1, 2)
    conn.commit()
    before = _row(client)["seam"]["settings"]
    answer = client.post("/api/mix/1/seam", json={"move": "auto", **cue})
    # a value of the wrong kind is refused outright and changes nothing
    if answer.status_code != 200:
        assert answer.status_code == 422
        assert _row(client)["seam"]["settings"] == before
        return
    # a number out of range is kept as asked, and the mix and a render request still work
    row = _row(client)
    assert {key: row["seam"]["settings"][key] for key in cue} == cue
    assert client.get("/api/mix").status_code == 200
    assert client.post("/api/mix/1/render").json()["key"] == row["seam"]["state"]["key"]
