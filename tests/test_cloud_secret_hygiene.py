"""Secrets never leak into logs, error details, tracebacks or reprs.

The rule (docs/engineering/conventions.md, "Secrets and personal data"): tokens, API keys,
signed URLs, webhook secrets, room codes and guest tokens never appear in a log line, an
exception message, a stored failure detail or an object's repr. Error trackers capture
tracebacks and local variables, so a secret in a repr is a secret in the error report.
"""

from __future__ import annotations

import dataclasses
import importlib
import inspect
import pkgutil
import re
from types import SimpleNamespace

import httpx
import pytest

from selecta.scheduling.policy import WorkerCaps
from selecta.workers import remote
from selecta.workers.context import TransientError, describe

SIGNED = (
    "https://acct.eu.r2.cloudflarestorage.com/sel-originals/w/ws/a/asset"
    "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDSECRET%2F20261110"
    "&X-Amz-Signature=5ec7e75ec7e75ec7e75ec7e75ec7e7"
)
SIGNATURE_PARTS = ("X-Amz-Signature", "5ec7e75ec7e7", "AKIDSECRET", "X-Amz-Credential")

CLOUD_PACKAGES = (
    "selecta.ai",
    "selecta.authz",
    "selecta.billing",
    "selecta.flags",
    "selecta.identity",
    "selecta.modes",
    "selecta.persistence",
    "selecta.playback",
    "selecta.rooms",
    "selecta.scheduling",
    "selecta.storage",
    "selecta.usage",
    "selecta.work",
    "selecta.workers",
)
# Field names that usually hold a secret. A match must be kept out of repr, or be listed in
# NOT_SECRET with the reason it's safe to show.
SECRET_NAME = re.compile(
    r"secret|password|api_key|pepper|private|signing|credential|(^|_)token$|(^|_)code$|^url$",
    re.I,
)
NOT_SECRET = {
    ("selecta.ai.registry", "Deployment", "secret_ref"): "the name of a secret, not its value",
    ("selecta.ai.runs", "RunRecord", "error_code"): "a machine error code",
    ("selecta.identity.tokens", "JwksCache", "url"): "AuthKit's public key set address",
    ("selecta.storage.objects", "DeleteFailure", "code"): "R2's error code for one key",
    ("selecta.storage.sigv4", "SignedRequest", "url"): (
        "a header-signed request's address; the signature is in `headers`, kept out of repr"
    ),
    ("selecta.work.claims", "Claim", "fencing_token"): "a public counter that orders attempts",
    ("selecta.work.model", "Attempt", "fencing_token"): "a public counter that orders attempts",
}


def _cloud_dataclasses():
    for package_name in CLOUD_PACKAGES:
        package = importlib.import_module(package_name)
        modules = [package_name] + [
            f"{package_name}.{info.name}" for info in pkgutil.iter_modules(package.__path__)
        ]
        for module_name in modules:
            module = importlib.import_module(module_name)
            for _, cls in inspect.getmembers(module, inspect.isclass):
                if cls.__module__ == module_name and dataclasses.is_dataclass(cls):
                    yield module_name, cls


def test_secret_looking_fields_stay_out_of_repr():
    shown = []
    for module_name, cls in _cloud_dataclasses():
        for field in dataclasses.fields(cls):
            key = (module_name, cls.__name__, field.name)
            if SECRET_NAME.search(field.name) and field.repr and key not in NOT_SECRET:
                shown.append(".".join(key))
    assert shown == [], "add field(repr=False), or list it in NOT_SECRET with a reason"


def test_not_secret_entries_still_exist():
    fields = {
        (module_name, cls.__name__, field.name)
        for module_name, cls in _cloud_dataclasses()
        for field in dataclasses.fields(cls)
    }
    assert set(NOT_SECRET) <= fields


def test_room_tokens_and_codes_never_print():
    from selecta.rooms.display import PairingStart
    from selecta.rooms.guests import JoinResult

    joined = JoinResult("guest-token-SECRET", "guest", "room", "Blue Fox", "active", False)
    pairing = PairingStart("PAIR-SECRET", "display-token-SECRET", 1.0)
    assert "SECRET" not in repr(joined) + repr(pairing)


def _failed_download_error() -> BaseException:
    """What a storage refusal looks like once httpx has raised it."""
    request = httpx.Request("GET", SIGNED)
    response = httpx.Response(403, request=request)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as error:
        return error
    raise AssertionError("expected a refusal")


def test_a_failure_detail_never_carries_a_signed_url():
    try:
        try:
            raise _failed_download_error()
        except httpx.HTTPError as error:
            raise TransientError("The worker could not download a signed input object.") from error
    except TransientError as problem:
        detail = describe(problem)
    assert not any(part in detail for part in SIGNATURE_PARTS), detail
    assert "cloudflarestorage.com" in detail  # still says where, just not how to get in


def test_describe_scrubs_signed_urls_from_any_handler_error():
    problem = RuntimeError(f"couldn't fetch {SIGNED} after 3 tries")
    detail = describe(problem)
    assert not any(part in detail for part in SIGNATURE_PARTS), detail


@pytest.fixture
def worker(monkeypatch):
    """A remote worker holding one claim whose only input is a signed URL storage refuses."""
    client = remote.RemoteWorkerClient(
        "https://gateway.test",
        "worker-1",
        "cpu-light",
        "worker-token",
        4_000_000_000,
        WorkerCaps(pool="cpu-light"),
    )
    claim = SimpleNamespace(
        attempt_id="attempt-1",
        fencing_token=1,
        input_urls=({"name": "song.flac", "url": SIGNED},),
        output_prefix="w/ws/playback/x/attempts/attempt-1/",
    )
    monkeypatch.setattr(client, "_claim", lambda *_args: claim)
    refuse = httpx.MockTransport(lambda request: httpx.Response(403, request=request))
    real = httpx.Client
    monkeypatch.setattr(remote.httpx, "Client", lambda **kwargs: real(transport=refuse, **kwargs))
    return client


def test_a_refused_download_reports_no_signed_url(worker, tmp_path):
    context = SimpleNamespace(attempt_id="attempt-1", fencing_token=1, scratch=tmp_path)
    with pytest.raises(TransientError) as caught:
        worker.download_input(context, 0)
    detail = describe(caught.value)
    assert not any(part in detail for part in SIGNATURE_PARTS), detail
    assert "403" in str(caught.value)
    assert list(tmp_path.iterdir()) == []
