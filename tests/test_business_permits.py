"""The kiosk's signed offline bundle and permit (ADR-0446 BZ-0446-05, BZ-0446-06).

`vectors()` builds the shared test vectors with fixed test-only keys (Ed25519 signatures are
deterministic). The same file, web/src/kiosk/permitVectors.json, is run by the kiosk's vitest
(`permit.test.ts`), so the server rules and the kiosk code are checked against one set of cases.
Run this module with `UPDATE_PERMIT_VECTORS=1` to rewrite the file after a deliberate change.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from selecta.business import permits

NOTE = (
    "Shared test vectors for the kiosk offline bundle (ADR-0446 BZ-0446-05, 06). Test-only keys; "
    "regenerate with tests/test_business_permits.py helpers."
)
VECTORS = Path(__file__).resolve().parents[1] / "web" / "src" / "kiosk" / "permitVectors.json"
T = 1_800_000_000.0


def _ring(seed: bytes) -> permits.Keyring:
    return permits.Keyring((Ed25519PrivateKey.from_private_bytes(seed),))


def _body(issued: float) -> dict:
    return {
        "time_zone": "Europe/London",
        "periods": [{"opens_at": issued + 3600, "closes_at": issued + 43200}],
        "programme_version": None,
        "volume": 70,
        "permit": {
            "organisation_id": "org",
            "venue_id": "venue",
            "zone_id": "zone",
            "device_id": "dev",
            "plan_state": "paid",
            "stop_at": None,
            "licence_expires_at": None,
            "licence_grace_ends_at": None,
            "issued_at": issued,
            "valid_until": issued + permits.PERMIT_S,
        },
    }


def vectors() -> dict:
    ring, other = _ring(bytes(range(32))), _ring(bytes(range(1, 33)))
    good = permits.sign(_body(T), ring)
    forged = dict(good)
    forged["bundle"] = good["bundle"].replace('"volume":70', '"volume":100')
    permit = json.loads(good["bundle"])["permit"]
    end = T + permits.PERMIT_S
    may = [
        {
            "name": "inside valid_until",
            "permit": permit,
            "now": end - 1,
            "close": None,
            "expect": True,
        },
        {
            "name": "past valid_until, not playing",
            "permit": permit,
            "now": end + 10,
            "close": None,
            "expect": False,
        },
        {
            "name": "past valid_until, plays to the end of the open period",
            "permit": permit,
            "now": end + 10,
            "close": end + 100,
            "expect": True,
        },
        {
            "name": "stops at a pilot end",
            "permit": {**permit, "stop_at": end - 100},
            "now": end - 50,
            "close": None,
            "expect": False,
        },
        {
            "name": "stops after the licence grace",
            "permit": {**permit, "licence_grace_ends_at": end - 100},
            "now": end - 50,
            "close": end,
            "expect": False,
        },
    ]
    return {
        "note": NOTE,
        "trusted": [ring.public()[0]["public_key"]],
        "good": good,
        "older": permits.sign(_body(T - 1_000_000), ring),
        "forged": forged,
        "wrong_key": permits.sign(_body(T), other),
        "held_issued_at": T,
        "may_play": may,
    }


def test_the_shared_vectors_file_is_current():
    made = json.dumps(vectors(), indent=2) + "\n"
    if os.environ.get("UPDATE_PERMIT_VECTORS") == "1":
        VECTORS.write_text(made, encoding="utf-8")
    assert json.loads(VECTORS.read_text(encoding="utf-8")) == json.loads(made)


def test_a_signed_bundle_verifies_and_carries_the_keys_for_rotation():
    v = vectors()
    body = permits.verify(v["good"], v["trusted"])
    assert body["permit"]["valid_until"] - body["permit"]["issued_at"] == permits.PERMIT_S
    assert [k["public_key"] for k in body["keys"]] == v["trusted"]


@pytest.mark.parametrize(("case", "reason"), [("forged", "forged"), ("wrong_key", "forged")])
def test_forged_or_unknown_key_bundles_are_refused(case, reason):
    v = vectors()
    with pytest.raises(permits.PermitRefused) as refused:
        permits.verify(v[case], v["trusted"])
    assert refused.value.reason == reason


def test_an_older_bundle_than_the_one_held_is_refused():
    v = vectors()
    with pytest.raises(permits.PermitRefused) as refused:
        permits.verify(v["older"], v["trusted"], held_issued_at=v["held_issued_at"])
    assert refused.value.reason == "older"


@pytest.mark.parametrize("case", vectors()["may_play"], ids=lambda c: c["name"])
def test_offline_grace_rules_match_the_shared_vectors(case):
    assert (
        permits.may_play(case["permit"], case["now"], open_period_close=case["close"])
        is case["expect"]
    )


def test_rotation_with_overlap_signs_with_the_first_key_and_publishes_both():
    ring = permits.keyring_from(
        ",".join(
            __import__("base64").urlsafe_b64encode(seed).rstrip(b"=").decode()
            for seed in (bytes(range(2, 34)), bytes(range(32)))
        )
    )
    signed = permits.sign(_body(T), ring)
    published = [k["public_key"] for k in ring.public()]
    assert len(published) == 2
    assert permits.verify(signed, published[:1])["volume"] == 70
    with pytest.raises(permits.PermitRefused):
        permits.verify(signed, published[1:])  # the retiring key no longer signs
