"""Regression tests for local-development callback and billing redirect boundaries.

The checkout and identity adapters consume caller-controlled return URLs.  They
must keep navigation on the local Selecta site without dropping legitimate
same-site paths and query parameters.
"""

from urllib.parse import urlsplit

import pytest

from selecta.devstack.billing import same_site
from selecta.devstack.redirects import safe_path, site_target


UNTRUSTED_RETURNS = (
    "https://attacker.example/collect",
    "//attacker.example/collect",
    "javascript:alert(1)",
    "\\\\attacker.example",
    "/\\attacker.example",
    "/%2f%2fattacker.example",
    "https://user:pass@attacker.example/collect",
    "/safe?next=https://attacker.example/",
    "/safe\r\nLocation: https://attacker.example/",
)


@pytest.mark.parametrize("candidate", UNTRUSTED_RETURNS)
def test_billing_return_url_cannot_change_origin(candidate: str) -> None:
    destination = same_site(candidate)
    parts = urlsplit(destination)
    assert destination.startswith("/")
    assert not destination.startswith("//")
    assert "\\" not in destination
    assert not parts.scheme
    assert not parts.netloc
    assert "\r" not in destination and "\n" not in destination


@pytest.mark.parametrize("candidate", UNTRUSTED_RETURNS)
def test_identity_redirect_is_built_from_allowlisted_origin(candidate: str) -> None:
    origin = "http://127.0.0.1:5173"
    destination = site_target(candidate, (origin,))
    assert destination.startswith(origin + "/")
    assert urlsplit(destination).netloc == "127.0.0.1:5173"


def test_identity_rejects_origin_prefix_and_userinfo_tricks() -> None:
    origin = "http://127.0.0.1:5173"
    for candidate in (
        "http://127.0.0.1:5173.attacker.example/account",
        "http://127.0.0.1:5173@attacker.example/account",
        "http://127.0.0.1:5173\\@attacker.example/account",
    ):
        assert site_target(candidate, (origin,)) == origin + "/"


def test_legitimate_same_site_return_paths_are_preserved() -> None:
    url = "/account/billing?tab=invoices&sort=recent"
    assert safe_path(url) == url
    assert same_site("https://elsewhere.example" + url) == url
    assert site_target(url, ("http://127.0.0.1:5173",)) == (
        "http://127.0.0.1:5173" + url
    )
