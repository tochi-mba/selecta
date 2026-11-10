"""HTTP client implementing the worker runner contract against the Cloud gateway."""

from __future__ import annotations

import hashlib
import re
import threading
import time
from collections.abc import Mapping
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from urllib.parse import urlsplit

import httpx

from selecta.scheduling.policy import WorkerCaps
from selecta.work.claims import Claim
from selecta.work.errors import CompletionRejected, JobCancelled, StaleLease
from selecta.work.lifecycle import Heartbeat
from selecta.work.model import ErrorClass, Job, JobState
from selecta.work.ports import ArtifactOutput
from selecta.workers.context import InputInvalid, TransientError

_OUTPUT_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:\.[A-Za-z0-9]{1,16}){0,2}$")
_HASH = re.compile(r"^[0-9a-f]{64}$")


class RemoteGatewayError(RuntimeError):
    """The worker gateway returned a bounded, non-sensitive error."""

    def __init__(self, status: int, code: str):
        self.status = status
        self.code = code
        super().__init__(f"Worker gateway returned HTTP {status} ({code}).")


class RemoteWorkerClient:
    """A ``WorkerRunner`` store adapter with no database or storage credentials.

    Enroll it once with :meth:`register`, then pass the returned object and its ``caps`` to
    ``WorkerRunner``. Gateway claims already start the attempt; ``start`` is therefore a cached
    no-op to preserve the local runner interface. Signed object URLs are kept only for the live
    claim and are used through unauthenticated, no-redirect HTTP requests.
    """

    def __init__(
        self,
        base_url: str,
        worker_id: str,
        pool: str,
        token: str,
        token_expires_at: float,
        caps: WorkerCaps,
        *,
        heartbeat_s: float = 10.0,
        timeout: float = 30.0,
        api_transport: httpx.BaseTransport | None = None,
        storage_hosts: tuple[str, ...] = (),
        clock=time.time,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        parsed = urlsplit(self.base_url)
        if parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("The worker gateway must use HTTPS outside loopback development.")
        if not parsed.netloc or parsed.username is not None or parsed.password is not None:
            raise ValueError("The worker gateway URL must have a host and no embedded credentials.")
        self.worker_id = worker_id
        self.pool = pool
        self.caps = replace(caps, worker_id=worker_id)
        self.config = SimpleNamespace(heartbeat_s=heartbeat_s)
        self.heartbeat_s = heartbeat_s
        self.timeout = timeout
        self.clock = clock
        self.storage_hosts = tuple(host.lower() for host in storage_hosts)
        self._lock = threading.RLock()
        self._token = token
        self._token_expires_at = token_expires_at
        self._token_lifetime_s = max(token_expires_at - clock(), 1.0)
        self._api = httpx.Client(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout,
            follow_redirects=False,
            transport=api_transport,
        )
        self._claims: dict[str, Claim] = {}
        self._jobs: dict[str, Job] = {}

    @classmethod
    def register(
        cls,
        base_url: str,
        caps: WorkerCaps,
        *,
        bootstrap_token: str,
        heartbeat_s: float = 10.0,
        timeout: float = 30.0,
        api_transport: httpx.BaseTransport | None = None,
        storage_hosts: tuple[str, ...] = (),
        clock=time.time,
    ) -> RemoteWorkerClient:
        """Enroll a worker and return its pool-scoped client credential."""
        parsed = urlsplit(base_url)
        if parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("The worker gateway must use HTTPS outside loopback development.")
        url = base_url.rstrip("/")
        if not parsed.netloc or parsed.username is not None or parsed.password is not None:
            raise ValueError("The worker gateway URL must have a host and no embedded credentials.")
        registration = {
            "pool": caps.pool,
            "slots": caps.slots,
            "engine_version": caps.engine_version,
            "gpu_memory_mb": caps.gpu_memory_mb,
            "scratch_mb": caps.scratch_mb,
            "worker_class": caps.worker_class,
            "speed_factor": caps.speed_factor,
            "job_types": sorted(caps.job_types) if caps.job_types is not None else None,
            "region": caps.region,
        }
        try:
            with httpx.Client(
                base_url=url,
                timeout=timeout,
                follow_redirects=False,
                transport=api_transport,
            ) as client:
                response = client.post(
                    "/internal/workers/register",
                    json=registration,
                    headers={"Authorization": f"Bearer {bootstrap_token}"},
                )
        except httpx.HTTPError as error:
            raise TransientError("Worker enrollment could not reach the gateway.") from error
        payload = cls._response(response)
        ttl = int(payload.get("expires_in", 0))
        token = payload.get("token")
        worker_id = payload.get("worker_id")
        if not isinstance(token, str) or not isinstance(worker_id, str) or ttl <= 0:
            raise RemoteGatewayError(502, "invalid_worker_enrollment_response")
        return cls(
            url,
            worker_id,
            caps.pool,
            token,
            clock() + ttl,
            caps,
            heartbeat_s=heartbeat_s,
            timeout=timeout,
            api_transport=api_transport,
            storage_hosts=storage_hosts,
            clock=clock,
        )

    @staticmethod
    def _response(response: httpx.Response) -> dict[str, Any]:
        if response.status_code == 204:
            return {}
        if response.status_code >= 500 or response.status_code in {408, 429}:
            raise TransientError(
                f"Worker gateway is temporarily unavailable ({response.status_code})."
            )
        try:
            payload = response.json()
        except ValueError as error:
            raise RemoteGatewayError(response.status_code, "invalid_gateway_response") from error
        if response.status_code >= 400:
            detail = payload.get("detail", {}) if isinstance(payload, dict) else {}
            code = (
                detail.get("code", "gateway_request_failed")
                if isinstance(detail, dict)
                else "gateway_request_failed"
            )
            if code == "stale_lease":
                raise StaleLease("The worker attempt no longer holds its lease.")
            if code == "job_cancelled":
                raise JobCancelled("The job was cancelled before its result could be published.")
            if code == "completion_rejected":
                rejected = CompletionRejected(
                    str(detail.get("error_class", ErrorClass.TRANSIENT)),
                    "The gateway rejected the worker output.",
                )
                rejected.state = detail.get("state", JobState.FAILED)
                raise rejected
            if response.status_code == 401:
                raise TransientError("The worker token was refused; refresh or re-enroll it.")
            raise RemoteGatewayError(response.status_code, str(code)[:80])
        if not isinstance(payload, dict):
            raise RemoteGatewayError(response.status_code, "invalid_gateway_response")
        return payload

    def _refresh_if_needed(self) -> None:
        with self._lock:
            if self._token_expires_at - self.clock() > min(60.0, self._token_lifetime_s * 0.2):
                return
            try:
                response = self._api.post("/internal/workers/refresh")
            except httpx.HTTPError as error:
                raise TransientError("Worker token refresh could not reach the gateway.") from error
            payload = self._response(response)
            token = payload.get("token")
            ttl = int(payload.get("expires_in", 0))
            if not isinstance(token, str) or ttl <= 0:
                raise RemoteGatewayError(502, "invalid_token_refresh_response")
            self._token = token
            self._token_expires_at = self.clock() + ttl
            self._token_lifetime_s = float(ttl)
            self._api.headers["Authorization"] = f"Bearer {token}"

    def _request(self, method: str, path: str, *, json: Any = None) -> dict[str, Any]:
        self._refresh_if_needed()
        try:
            response = self._api.request(method, path, json=json)
        except httpx.HTTPError as error:
            raise TransientError(
                "Worker gateway request failed before a response arrived."
            ) from error
        return self._response(response)

    def close(self) -> None:
        self._api.close()

    def touch_worker(self, _worker_id: str) -> None:
        # Claim touches idle workers; attempt heartbeats touch active workers.
        return None

    def claim(self, pool: str, caps: WorkerCaps) -> Claim | None:
        if pool != self.pool or caps.worker_id != self.worker_id:
            raise ValueError(
                "A remote worker client can claim only for its registered pool and id."
            )
        response = self._request("POST", "/internal/workers/claim")
        info = response.get("claim")
        if info is None:
            return None
        try:
            job = Job.from_row(info["job"])
            claim = Claim(
                attempt_id=info["attempt_id"],
                job=job,
                fencing_token=int(info["fencing_token"]),
                lease_expires_at=float(info["lease_expires_at"]),
                boosted=bool(info.get("boosted", False)),
                input_urls=tuple(dict(item) for item in info.get("input_urls", [])),
                output_prefix=info.get("output_prefix"),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise RemoteGatewayError(502, "invalid_claim_response") from error
        self._claims[claim.attempt_id] = claim
        self._jobs[job.id] = job
        return claim

    def start(self, attempt_id: str, _token: int) -> Job:
        # The gateway starts the attempt atomically before returning the claim.
        claim = self._claims.get(attempt_id)
        if claim is None:
            raise StaleLease("The claimed attempt is no longer available in this worker.")
        return claim.job

    def heartbeat(self, attempt_id: str, token: int) -> Heartbeat:
        payload = self._request(
            "POST",
            f"/internal/workers/attempts/{attempt_id}/heartbeat",
            json={"fencing_token": token},
        )
        try:
            return Heartbeat(
                cancel_requested=bool(payload["cancel_requested"]),
                lease_expires_at=float(payload["lease_expires_at"]),
                cancel_reason=payload.get("cancel_reason"),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise RemoteGatewayError(502, "invalid_heartbeat_response") from error

    def progress(
        self, attempt_id: str, token: int, done: float, total: float | None = None
    ) -> None:
        self._request(
            "POST",
            f"/internal/workers/attempts/{attempt_id}/progress",
            json={"fencing_token": token, "done": done, "total": total},
        )

    def complete(
        self,
        attempt_id: str,
        token: int,
        *,
        result: Any = None,
        artifacts: tuple[ArtifactOutput, ...] = (),
        cost_s: float | None = None,
    ) -> Job:
        claim = self._claim(attempt_id, token)
        try:
            payload = self._request(
                "POST",
                f"/internal/workers/attempts/{attempt_id}/complete",
                json={
                    "fencing_token": token,
                    "result": result,
                    "cost_s": cost_s,
                    "artifacts": [self._artifact_json(item) for item in artifacts],
                },
            )
        except JobCancelled:
            self._jobs[claim.job.id] = replace(claim.job, state=JobState.CANCELLED)
            raise
        except CompletionRejected as error:
            self._jobs[claim.job.id] = replace(
                claim.job, state=getattr(error, "state", JobState.FAILED)
            )
            raise
        job = replace(claim.job, state=payload.get("state", JobState.SUCCEEDED), result=result)
        self._jobs[job.id] = job
        return job

    def fail(
        self,
        attempt_id: str,
        token: int,
        error_class: ErrorClass | str,
        detail: str = "",
        cost_s: float | None = None,
    ) -> Job:
        claim = self._claim(attempt_id, token)
        try:
            payload = self._request(
                "POST",
                f"/internal/workers/attempts/{attempt_id}/fail",
                json={
                    "fencing_token": token,
                    "error_class": str(error_class),
                    "detail": detail[:5000],
                    "cost_s": cost_s,
                },
            )
        except StaleLease:
            raise
        job = replace(claim.job, state=payload.get("state", JobState.FAILED))
        self._jobs[job.id] = job
        return job

    def release(self, attempt_id: str, token: int, cost_s: float | None = None) -> Job:
        claim = self._claim(attempt_id, token)
        payload = self._request(
            "POST",
            f"/internal/workers/attempts/{attempt_id}/release",
            json={"fencing_token": token, "cost_s": cost_s},
        )
        job = replace(claim.job, state=payload.get("state", JobState.QUEUED))
        self._jobs[job.id] = job
        return job

    def job(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def _claim(self, attempt_id: str, token: int) -> Claim:
        claim = self._claims.get(attempt_id)
        if claim is None or claim.fencing_token != token:
            raise StaleLease("The worker attempt does not match the current fence.")
        return claim

    @staticmethod
    def _artifact_json(item: ArtifactOutput) -> dict[str, Any]:
        return {
            "kind": item.kind,
            "input_hash": item.input_hash,
            "keys": item.keys,
            "checksum": item.checksum,
            "size_bytes": item.size_bytes,
            "provenance": dict(item.provenance) if item.provenance else None,
            "protected": item.protected,
        }

    def download_input(self, context, selector: str | int, destination: Path | None = None) -> Path:
        claim = self._claim(context.attempt_id, context.fencing_token)
        inputs = claim.input_urls
        if isinstance(selector, bool):
            raise InputInvalid("The requested input index is invalid.")
        if isinstance(selector, int):
            if not 0 <= selector < len(inputs):
                raise InputInvalid("The claimed job has no input at that position.")
            item = inputs[selector]
        else:
            item = next(
                (
                    entry
                    for entry in inputs
                    if entry.get("name") == selector or entry.get("key") == selector
                ),
                None,
            )
            if item is None:
                raise InputInvalid("The claimed job has no input with that name.")
        url = item.get("url")
        self._check_storage_url(url)
        name = str(item.get("name") or f"input-{inputs.index(item)}.bin")
        safe_name = Path(name).name
        target = Path(destination) if destination is not None else context.scratch / safe_name
        if not target.is_absolute():
            target = context.scratch / target
        target = target.resolve()
        scratch = context.scratch.resolve()
        if not target.is_relative_to(scratch):
            raise InputInvalid("Input files must be downloaded inside the attempt scratch folder.")
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        size = 0
        try:
            with httpx.Client(timeout=self.timeout, follow_redirects=False) as storage:
                with storage.stream("GET", url) as response:
                    response.raise_for_status()
                    with target.open("wb") as output:
                        for chunk in response.iter_bytes(1024 * 1024):
                            size += len(chunk)
                            digest.update(chunk)
                            output.write(chunk)
        except (httpx.HTTPError, OSError) as error:
            target.unlink(missing_ok=True)
            # `from None`: httpx's message holds the signed URL, which must reach no log or detail.
            raise TransientError(
                f"The worker could not download a signed input object ({_failure(error)})."
            ) from None
        expected_size = item.get("size_bytes")
        expected_hash = item.get("sha256")
        if expected_size is not None and size != int(expected_size):
            target.unlink(missing_ok=True)
            raise InputInvalid("The downloaded input size didn't match its claim.")
        if expected_hash is not None and digest.hexdigest() != expected_hash:
            target.unlink(missing_ok=True)
            raise InputInvalid("The downloaded input checksum didn't match its claim.")
        return target

    def publish_artifact(
        self,
        context,
        kind: str,
        input_hash: str,
        source: Path,
        name: str,
        *,
        provenance: Mapping[str, Any] | None = None,
        protected: bool = False,
    ) -> ArtifactOutput:
        if not _HASH.fullmatch(input_hash):
            raise InputInvalid("An artifact input hash must be a lower-case SHA-256.")
        if not _OUTPUT_NAME.fullmatch(name):
            raise InputInvalid("The artifact file name is unsafe.")
        claim = self._claim(context.attempt_id, context.fencing_token)
        payload = self._request(
            "POST",
            f"/internal/workers/attempts/{claim.attempt_id}/outputs",
            json={"fencing_token": claim.fencing_token, "names": [name]},
        )
        slots = payload.get("outputs")
        if not isinstance(slots, list) or len(slots) != 1 or not isinstance(slots[0], dict):
            raise RemoteGatewayError(502, "invalid_output_slot_response")
        slot = slots[0]
        if slot.get("name") != name or not isinstance(slot.get("key"), str):
            raise RemoteGatewayError(502, "invalid_output_slot_response")
        url = slot.get("url")
        self._check_storage_url(url)
        if not Path(source).is_file():
            raise InputInvalid("The worker output file is missing.")
        digest = hashlib.sha256()
        size = 0
        try:
            with Path(source).open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
                    size += len(chunk)
            headers = slot.get("headers") or {}
            if not isinstance(headers, dict):
                raise RemoteGatewayError(502, "invalid_output_slot_response")
            safe_headers = {
                str(key): str(value)
                for key, value in headers.items()
                if str(key).lower() not in {"authorization", "cookie", "host"}
            }
            with httpx.Client(timeout=self.timeout, follow_redirects=False) as storage:
                with Path(source).open("rb") as handle:
                    response = storage.put(url, content=handle, headers=safe_headers)
                    if response.status_code < 200 or response.status_code >= 300:
                        raise httpx.HTTPStatusError(
                            "Signed output upload was refused.",
                            request=response.request,
                            response=response,
                        )
        except RemoteGatewayError:
            raise
        except (httpx.HTTPError, OSError) as error:
            # `from None`: httpx's message holds the signed URL, which must reach no log or detail.
            raise TransientError(
                f"The worker could not publish its signed output object ({_failure(error)})."
            ) from None
        return ArtifactOutput(
            kind=kind,
            input_hash=input_hash,
            keys=[slot["key"]],
            checksum=digest.hexdigest(),
            size_bytes=size,
            provenance=provenance,
            protected=protected,
        )

    def _check_storage_url(self, url: Any) -> None:
        if not isinstance(url, str):
            raise RemoteGatewayError(502, "missing_signed_storage_url")
        parsed = urlsplit(url)
        host = (parsed.hostname or "").lower()
        allowed = host.endswith(".r2.cloudflarestorage.com") or host in self.storage_hosts
        if (
            parsed.scheme != "https"
            or not parsed.netloc
            or parsed.username is not None
            or parsed.password is not None
            or not allowed
        ):
            raise RemoteGatewayError(502, "untrusted_signed_storage_url")


def _failure(error: BaseException) -> str:
    """What went wrong talking to storage, without the signed URL httpx puts in its messages."""
    if isinstance(error, httpx.HTTPStatusError):
        return f"HTTP {error.response.status_code}"
    return type(error).__name__


__all__ = ["RemoteGatewayError", "RemoteWorkerClient"]
