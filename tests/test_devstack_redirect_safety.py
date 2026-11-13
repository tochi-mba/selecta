"""Regression tests for local-development callback and billing redirect boundaries.

The checkout and identity adapters consume caller-controlled return URLs. They
must keep navigation on the local Selecta site without dropping legitimate
same-site paths and query parameters.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from selecta.devstack.billing import same_site
from selecta.devstack.redirects import LocalPathRedirectResponse, safe_path, site_target

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


def test_billing_return_url_cannot_change_origin() -> None:
    for candidate in UNTRUSTED_RETURNS:
        destination = same_site(candidate)
        parts = urlsplit(destination)
        assert destination.startswith("/")
        assert not destination.startswith("//")
        assert "\\" not in destination
        assert not parts.scheme
        assert not parts.netloc
        assert "\r" not in destination and "\n" not in destination


def test_identity_redirect_is_built_from_allowlisted_origin() -> None:
    origin = "http://127.0.0.1:5173"
    for candidate in UNTRUSTED_RETURNS:
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


def test_local_redirect_response_revalidates_at_the_location_header() -> None:
    """Callers cannot make an offsite Location even if they skip the earlier sanitizer."""
    for candidate in UNTRUSTED_RETURNS + (
        "http:////attacker.example/collect",
        "https://attacker.example/\\\\collect",
        "/safe#//attacker.example",
        "/safe?next=//attacker.example",
    ):
        response = LocalPathRedirectResponse(candidate)
        location = response.headers["location"]
        parsed = urlsplit(location)
        assert response.status_code == 303
        assert location.startswith("/")
        assert not location.startswith("//")
        assert not parsed.scheme
        assert not parsed.netloc
        assert chr(13) not in location and chr(10) not in location

    assert LocalPathRedirectResponse("https://attacker.example/collect").headers["location"] == "/"


def test_local_redirect_response_preserves_valid_checkout_destination() -> None:
    path = "/account/billing?tab=invoices&sort=recent"
    response = LocalPathRedirectResponse(same_site("https://elsewhere.example" + path))
    assert response.headers["location"] == path
