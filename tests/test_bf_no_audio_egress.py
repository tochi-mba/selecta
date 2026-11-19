"""BF-0455-04, the no-audio-egress contract: with `cloud.hosted_media` turned off for an account
by a USERS rule, no Cloud route accepts an audio payload from it.

What this file asserts, precisely:

- The named upload writes (`POST /api/uploads/plan`, `POST /api/uploads/{session_id}/parts`)
  answer 403 `flag_off` for the flag-off account, for JSON, raw audio and multipart audio bodies
  alike: the account gate refuses before any body is read.
- A sweep over every mounted API route that declares a request body (POST, PUT and PATCH routes
  whose `body_field` is set) sends a small `audio/*` body as the flag-off account and asserts no
  route answers with success: routes owned by `cloud.uploads` are 403 `flag_off`, every other
  body-taking route refuses with some 4xx (not a flag refusal, but never an acceptance).
- Routes with no request body at all are skipped: there is nothing for audio bytes to reach, and
  the sweep stays deterministic by never invoking body-less side effects.
"""

from __future__ import annotations

import re

from cloud_party import CAROL, auth
from fastapi.routing import APIRoute

from selecta import flags
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Rule, RuleKind
from selecta.persistence import transaction

pytest_plugins = ("cloud_party",)

AUDIO_BYTES = b"ID3\x04\x00\x00\x00\x00\x00\x00not-really-mpeg-frames"
MADE_UP_ID = "0123456789abcdef0123456789abcdef"


def _revoke_hosted_media(party, token: str) -> str:
    """Turn the grant off for one account through an ADR-0414 USERS rule; returns the user id."""
    user_id = party.client.get("/api/account", headers=auth(token)).json()["user"]["id"]
    with transaction(party.engine) as conn:
        flag_rules.save(
            conn,
            "cloud.hosted_media",
            [Rule(RuleKind.USERS, {"ids": [user_id], "on": False})],
            author="tests",
            reason="no-audio-egress contract test",
        )
    party.app.state.flag_rules.invalidate()
    return user_id


def _audio_headers(token: str) -> dict[str, str]:
    return {**auth(token), "Content-Type": "audio/mpeg"}


def test_upload_writes_refuse_every_audio_payload_shape_without_the_grant(party):
    _revoke_hosted_media(party, CAROL)
    attempts = (
        party.client.post(
            "/api/uploads/plan",
            headers=auth(CAROL),
            json={"files": [{"name": "song.mp3", "size": len(AUDIO_BYTES)}]},
        ),
        party.client.post(
            "/api/uploads/plan",
            headers=auth(CAROL),
            files={"file": ("song.mp3", AUDIO_BYTES, "audio/mpeg")},
        ),
        party.client.post("/api/uploads/plan", headers=_audio_headers(CAROL), content=AUDIO_BYTES),
        party.client.post(
            f"/api/uploads/{MADE_UP_ID}/parts",
            headers=auth(CAROL),
            json={"part_numbers": [1]},
        ),
        party.client.post(
            f"/api/uploads/{MADE_UP_ID}/parts",
            headers=_audio_headers(CAROL),
            content=AUDIO_BYTES,
        ),
    )
    for answer in attempts:
        assert answer.status_code == 403, answer.text
        assert answer.json()["detail"]["code"] == "flag_off"


def test_no_body_taking_route_outside_the_uploads_set_accepts_audio_for_that_account(party):
    _revoke_hosted_media(party, CAROL)
    uploads_routes = set(flags.registry()["cloud.uploads"].routes)
    swept: list[str] = []
    routes = sorted(
        (
            route
            for route in party.app.routes
            if isinstance(route, APIRoute) and route.path.startswith("/api/")
        ),
        key=lambda route: route.path,
    )
    for route in routes:
        if route.body_field is None:
            continue
        for method in sorted(route.methods & {"POST", "PUT", "PATCH"}):
            path = re.sub(r"{[^}]+}", MADE_UP_ID, route.path)
            answer = party.client.request(
                method, path, headers=_audio_headers(CAROL), content=AUDIO_BYTES
            )
            name = f"{method} {route.path}"
            swept.append(name)
            if name in uploads_routes:
                assert answer.status_code == 403, f"{name}: {answer.text}"
                assert answer.json()["detail"]["code"] == "flag_off"
            else:
                assert 400 <= answer.status_code < 500, (
                    f"{name} answered {answer.status_code} to an audio/* body; every route "
                    f"outside cloud.uploads must refuse audio for a flag-off account"
                )
    # The sweep really covered the upload writes; an empty sweep would prove nothing.
    assert "POST /api/uploads/plan" in swept
    assert "POST /api/uploads/{session_id}/parts" in swept
