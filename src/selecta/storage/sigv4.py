"""AWS Signature Version 4, written out by hand for R2's S3 API (ADR-0397).

R2 speaks the S3 protocol and checks requests with SigV4, using region `auto` and service `s3`.
Two kinds of signature are made here:

- **Header signatures** for the server's own calls (`Authorization` header). The URL carries no
  secret, so it's safe for an HTTP library to log it.
- **Presigned URLs** (query signatures) for browsers and workers. The payload is
  `UNSIGNED-PAYLOAD`. Only `host` is signed unless the caller names more headers: an upload
  part URL also signs `content-length`, so its holder can send only the planned part size.
  A presigned URL is a bearer credential until it expires: never log one, put one in an error
  message, or send one to analytics. `redact()` strips the signature for anything that must
  mention a URL.

Paths and query values are given raw and encoded here exactly once, the way S3 expects: every
byte except `A-Z a-z 0-9 - _ . ~` is percent-encoded, and `/` is kept in paths only.
"""

from __future__ import annotations

import hashlib
import hmac
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from urllib.parse import quote, urlsplit, urlunsplit

ALGORITHM = "AWS4-HMAC-SHA256"
UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD"
EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
MAX_PRESIGN_SECONDS = 7 * 24 * 3600


@dataclass(frozen=True)
class Credentials:
    access_key_id: str
    secret_access_key: str = field(repr=False)


@dataclass(frozen=True)
class SignedRequest:
    """A URL and the headers to send with it, `Authorization` included."""

    url: str
    headers: dict[str, str] = field(repr=False)


def uri_encode(text: str, *, keep_slash: bool = False) -> str:
    return quote(text, safe="/-_.~" if keep_slash else "-_.~")


def canonical_query(params: Iterable[tuple[str, str]]) -> str:
    """Query parameters encoded and sorted by name, then value, as SigV4 requires."""
    pairs = sorted((uri_encode(name), uri_encode(value)) for name, value in params)
    return "&".join(f"{name}={value}" for name, value in pairs)


def _hmac(key: bytes, text: str) -> bytes:
    return hmac.new(key, text.encode("utf-8"), hashlib.sha256).digest()


def signing_key(secret_access_key: str, day: str, region: str, service: str) -> bytes:
    key = _hmac(f"AWS4{secret_access_key}".encode(), day)
    key = _hmac(key, region)
    key = _hmac(key, service)
    return _hmac(key, "aws4_request")


def _trim(value: str) -> str:
    return " ".join(str(value).split())


def canonical_request(
    method: str,
    path: str,
    query: str,
    headers: Mapping[str, str],
    payload_hash: str,
) -> tuple[str, str]:
    """The canonical request text and its signed-header list. `headers` must be lower case."""
    names = sorted(headers)
    canonical_headers = "".join(f"{name}:{_trim(headers[name])}\n" for name in names)
    signed = ";".join(names)
    text = "\n".join(
        [method, uri_encode(path or "/", keep_slash=True), query, canonical_headers, signed]
    )
    return f"{text}\n{payload_hash}", signed


def redact(url: str) -> str:
    """`url` without its query string, so it can appear in a log line or an error."""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


class Signer:
    """Signs requests for one set of credentials, region and service."""

    def __init__(
        self,
        credentials: Credentials,
        *,
        region: str = "auto",
        service: str = "s3",
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if not credentials.access_key_id or not credentials.secret_access_key:
            raise ValueError("SigV4 needs an access key id and a secret access key.")
        self.credentials = credentials
        self.region = region
        self.service = service
        self._clock = clock or (lambda: datetime.now(UTC))

    def _now(self, now: datetime | None) -> tuple[str, str]:
        moment = now or self._clock()
        if moment.tzinfo is None:
            raise ValueError("Signing times must be timezone-aware.")
        moment = moment.astimezone(UTC)
        return moment.strftime("%Y%m%dT%H%M%SZ"), moment.strftime("%Y%m%d")

    def _scope(self, day: str) -> str:
        return f"{day}/{self.region}/{self.service}/aws4_request"

    def _signature(self, amz_date: str, day: str, canonical: str) -> str:
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        to_sign = "\n".join([ALGORITHM, amz_date, self._scope(day), digest])
        key = signing_key(self.credentials.secret_access_key, day, self.region, self.service)
        return hmac.new(key, to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    def sign(
        self,
        method: str,
        scheme: str,
        host: str,
        path: str,
        query: Iterable[tuple[str, str]] = (),
        headers: Mapping[str, str] | None = None,
        payload_hash: str = EMPTY_SHA256,
        now: datetime | None = None,
    ) -> SignedRequest:
        """Header-signed request. Every header passed in is signed; add unsigned ones (such as
        `Content-Length`) to the result's headers afterwards."""
        amz_date, day = self._now(now)
        signed_headers = {name.lower(): str(value) for name, value in (headers or {}).items()}
        signed_headers["host"] = host
        signed_headers["x-amz-date"] = amz_date
        signed_headers["x-amz-content-sha256"] = payload_hash
        cq = canonical_query(query)
        canonical, signed_list = canonical_request(method, path, cq, signed_headers, payload_hash)
        signature = self._signature(amz_date, day, canonical)
        credential = f"{self.credentials.access_key_id}/{self._scope(day)}"
        out = {name: value for name, value in signed_headers.items() if name != "host"}
        out["authorization"] = (
            f"{ALGORITHM} Credential={credential}, SignedHeaders={signed_list}, "
            f"Signature={signature}"
        )
        return SignedRequest(url=self._url(scheme, host, path, cq), headers=out)

    def presign(
        self,
        method: str,
        scheme: str,
        host: str,
        path: str,
        expires: int,
        query: Iterable[tuple[str, str]] = (),
        now: datetime | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> str:
        """A presigned URL valid for `expires` seconds (1 second to 7 days). `headers` (lower
        case) are signed too, so the request must send exactly those values."""
        if not 1 <= int(expires) <= MAX_PRESIGN_SECONDS:
            raise ValueError(f"Presigned URLs last 1 to {MAX_PRESIGN_SECONDS} seconds.")
        amz_date, day = self._now(now)
        signed_headers = {name.lower(): str(value) for name, value in (headers or {}).items()}
        signed_headers["host"] = host
        params = list(query) + [
            ("X-Amz-Algorithm", ALGORITHM),
            ("X-Amz-Credential", f"{self.credentials.access_key_id}/{self._scope(day)}"),
            ("X-Amz-Date", amz_date),
            ("X-Amz-Expires", str(int(expires))),
            ("X-Amz-SignedHeaders", ";".join(sorted(signed_headers))),
        ]
        cq = canonical_query(params)
        canonical, _ = canonical_request(method, path, cq, signed_headers, UNSIGNED_PAYLOAD)
        signature = self._signature(amz_date, day, canonical)
        return self._url(scheme, host, path, f"{cq}&X-Amz-Signature={signature}")

    @staticmethod
    def _url(scheme: str, host: str, path: str, query: str) -> str:
        url = f"{scheme}://{host}{uri_encode(path or '/', keep_slash=True)}"
        return f"{url}?{query}" if query else url
