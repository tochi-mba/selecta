"""Checking AuthKit (WorkOS) access tokens on every request, against AuthKit's published keys.

A token is accepted only if all of these hold:

- it is signed with RS256 (no other algorithm, and never "none");
- its `kid` names a key in AuthKit's JWKS and the signature checks out with that key;
- the issuer matches, and the audience matches when one is configured;
- `exp`, `nbf` and `iat` are right, give or take 60 seconds of clock difference.

Keys are fetched with httpx and cached by `kid`. A token with a `kid` we haven't seen triggers one
refetch (for key rotation), at most once a minute, so a flood of made-up `kid`s can't hammer
AuthKit. The fetcher is a plain function of the URL, so tests can pass a fake JWKS.

Each kind of refusal is its own error, all under `TokenError`, so the API can answer 401 and log
why. A good token becomes a `Claims`.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import httpx
import jwt

ALGORITHM = "RS256"
LEEWAY_SECONDS = 60
REFETCH_SECONDS = 60.0
RETRY_EMPTY_SECONDS = 5.0
WORKOS_API = "https://api.workos.com"


class TokenError(Exception):
    """Base class: the token can't be trusted."""


class MalformedToken(TokenError):
    """Not a JWT, or missing a claim every token must have."""


class TokenExpired(TokenError):
    pass


class TokenNotYetValid(TokenError):
    """`nbf` or `iat` lies in the future, beyond the leeway."""


class BadSignature(TokenError):
    """The signature doesn't verify, or the token asks for an algorithm other than RS256."""


class WrongAudience(TokenError):
    pass


class WrongIssuer(TokenError):
    pass


class UnknownKey(TokenError):
    """The token's `kid` isn't in the JWKS, even after a refetch."""


class JwksUnavailable(TokenError):
    """The JWKS couldn't be fetched or read. Usually a 503, not the user's fault."""


@dataclass(frozen=True)
class Claims:
    subject: str
    issued_at: float
    expires_at: float
    email: str | None = None
    email_verified: bool = False
    session_id: str | None = None
    organization_id: str | None = None
    role: str | None = None
    roles: tuple[str, ...] = ()
    permissions: tuple[str, ...] = ()
    token_id: str | None = None
    issuer: str | None = None

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> Claims:
        subject = payload.get("sub")
        if not isinstance(subject, str) or not subject:
            raise MalformedToken("token has no subject")
        return cls(
            subject=subject,
            issued_at=float(payload["iat"]),
            expires_at=float(payload["exp"]),
            email=_text(payload.get("email")),
            email_verified=payload.get("email_verified") is True,
            session_id=_text(payload.get("sid")),
            organization_id=_text(payload.get("org_id")),
            role=_text(payload.get("role")),
            roles=_texts(payload.get("roles")),
            permissions=_texts(payload.get("permissions")),
            token_id=_text(payload.get("jti")),
            issuer=_text(payload.get("iss")),
        )


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _texts(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(item for item in value if isinstance(item, str))


JwksFetcher = Callable[[str], Mapping[str, Any]]


def httpx_fetcher(timeout: float = 5.0) -> JwksFetcher:
    """The real fetcher: GET the JWKS URL and parse the JSON."""

    def fetch(url: str) -> Mapping[str, Any]:
        response = httpx.get(url, timeout=timeout, follow_redirects=False)
        response.raise_for_status()
        return response.json()

    return fetch


def _signing_keys(document: Mapping[str, Any]) -> dict[str, Any]:
    keys = document.get("keys") if isinstance(document, Mapping) else None
    if not isinstance(keys, list):
        raise JwksUnavailable("JWKS has no key list")
    found: dict[str, Any] = {}
    for jwk in keys:
        if not isinstance(jwk, Mapping):
            continue
        kid = jwk.get("kid")
        usable = (
            isinstance(kid, str)
            and jwk.get("kty") == "RSA"
            and jwk.get("use") in (None, "sig")
            and jwk.get("alg") in (None, ALGORITHM)
        )
        if not usable:
            continue
        try:
            found[kid] = jwt.PyJWK(dict(jwk), algorithm=ALGORITHM).key
        except jwt.PyJWTError:
            continue
    return found


@dataclass
class JwksCache:
    """AuthKit's signing keys by `kid`, refetched on an unknown `kid` at most once a minute."""

    url: str
    fetcher: JwksFetcher = field(default_factory=httpx_fetcher)
    refetch_seconds: float = REFETCH_SECONDS
    clock: Callable[[], float] = time.monotonic
    _keys: dict[str, Any] = field(default_factory=dict, init=False, repr=False)
    _last_attempt: float | None = field(default=None, init=False, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    def key(self, kid: str) -> Any:
        found = self._keys.get(kid)
        if found is not None:
            return found
        with self._lock:
            found = self._keys.get(kid)  # another thread may have just refreshed
            if found is None and self._may_refetch():
                self._refresh()
                found = self._keys.get(kid)
        if found is None:
            raise UnknownKey(f"no signing key {kid!r}")
        return found

    def _may_refetch(self) -> bool:
        if self._last_attempt is None:
            return True
        wait = self.refetch_seconds if self._keys else RETRY_EMPTY_SECONDS
        return self.clock() - self._last_attempt >= wait

    def _refresh(self) -> None:
        self._last_attempt = self.clock()
        try:
            document = self.fetcher(self.url)
        except Exception as exc:
            raise JwksUnavailable(f"couldn't fetch JWKS: {type(exc).__name__}") from exc
        keys = _signing_keys(document)
        if not keys:
            raise JwksUnavailable("JWKS has no usable RS256 signing keys")
        self._keys = keys


@dataclass
class TokenVerifier:
    """Verifies tokens for one issuer. `audience=None` skips the audience check, for issuers
    whose access tokens carry no `aud`; the issuer check still binds the token to our client."""

    issuer: str
    jwks: JwksCache
    audience: str | Sequence[str] | None = None
    leeway: float = LEEWAY_SECONDS

    def verify(self, token: str) -> Claims:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise MalformedToken("not a JWT") from exc
        if header.get("alg") != ALGORITHM:
            raise BadSignature(f"algorithm {header.get('alg')!r} is not allowed")
        kid = header.get("kid")
        if not isinstance(kid, str) or not kid:
            raise UnknownKey("token has no kid")
        key = self.jwks.key(kid)
        audience = self.audience
        if audience is not None and not isinstance(audience, str):
            audience = list(audience)
        try:
            payload = jwt.decode(
                token,
                key,
                algorithms=[ALGORITHM],
                issuer=self.issuer,
                audience=audience,
                leeway=self.leeway,
                options={
                    "require": ["exp", "iat", "iss", "sub"],
                    "verify_aud": audience is not None,
                },
            )
        except jwt.ExpiredSignatureError as exc:
            raise TokenExpired("token has expired") from exc
        except jwt.ImmatureSignatureError as exc:
            raise TokenNotYetValid("token isn't valid yet") from exc
        except jwt.InvalidSignatureError as exc:
            raise BadSignature("signature doesn't verify") from exc
        except jwt.InvalidAudienceError as exc:
            raise WrongAudience("token is for another audience") from exc
        except jwt.InvalidIssuerError as exc:
            raise WrongIssuer("token is from another issuer") from exc
        except jwt.InvalidAlgorithmError as exc:
            raise BadSignature("algorithm is not allowed") from exc
        except jwt.PyJWTError as exc:
            raise MalformedToken(f"token rejected: {type(exc).__name__}") from exc
        return Claims.from_payload(payload)


def authkit_verifier(
    client_id: str,
    *,
    issuer: str | None = None,
    audience: str | Sequence[str] | None = None,
    api_base: str = WORKOS_API,
    fetcher: JwksFetcher | None = None,
) -> TokenVerifier:
    """A verifier for one AuthKit client. Check the issuer against a real token before launch:
    with a custom auth domain it is that domain rather than the WorkOS API."""
    base = api_base.rstrip("/")
    cache = JwksCache(f"{base}/sso/jwks/{client_id}", fetcher or httpx_fetcher())
    return TokenVerifier(
        issuer=issuer or f"{base}/user_management/{client_id}",
        jwks=cache,
        audience=audience,
    )
