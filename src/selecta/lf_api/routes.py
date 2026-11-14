"""Independently mountable authenticated /api/lf/v1 browser Cloud API.

The integrator MUST inject an existing verified-identity dependency returning ActorScope.
No endpoint trusts workspace/actor/role from request bodies, cookies or custom headers.
No import-time database creation, feature-flag edit or api_cloud.py modification.
"""
from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr

from selecta.lf_control.protocol import ActorScope, ControlError

from .service import BrowserControlService


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Registration(StrictBody):
    device_id: StrictStr
    zone_id: StrictStr
    label: StrictStr
    capabilities: dict[str, StrictBool]
    browser_version: StrictStr
    dsp_version: StrictStr


class Presence(StrictBody):
    foreground: StrictBool
    runtime_state: StrictStr
    capabilities: dict[str, StrictBool]
    source_ready: StrictBool
    source_count: StrictInt = Field(ge=0, le=1000000)
    source_checked_at: float
    output_state: StrictStr
    output_checked_at: float
    generation: StrictInt = Field(ge=0)
    policy_version: StrictInt = Field(ge=0)
    recipe_revision: StrictStr | None


class Command(StrictBody):
    target_session_id: StrictStr
    operation_id: StrictStr
    idempotency_key: StrictStr
    action: StrictStr
    arguments: dict
    expected_generation: StrictInt = Field(ge=0)
    recipe_revision: StrictStr | None
    policy_version: StrictInt = Field(ge=0)


class Takeover(StrictBody):
    target_session_id: StrictStr
    operation_id: StrictStr
    idempotency_key: StrictStr
    expected_generation: StrictInt = Field(ge=0)
    initial_silence_confirmed: StrictBool = False


class Acknowledgement(StrictBody):
    status: StrictStr
    fenced_generation: StrictInt = Field(ge=0)
    output_confirmed: StrictBool = False
    output_silent: StrictBool = False
    execution_verified: StrictBool = False


def make_router(
    service: BrowserControlService,
    authenticate_actor: Callable,
    *,
    require_https: bool = True,
) -> APIRouter:
    """Supply authenticated actor dependency from Cloud's existing bearer verification.

    require_https=False is for isolated ASGI TestClient/local HTTP development only.
    In production, configure trusted proxy headers correctly before mounting.
    """
    router = APIRouter(prefix="/api/lf/v1", tags=["local-first-browser-control"])

    def _call(request: Request, fn, **kwargs):
        if require_https and request.url.scheme != "https":
            raise HTTPException(403, detail="https_required")
        length = request.headers.get("content-length")
        if length is not None and (not length.isdecimal() or int(length) > 16384):
            raise HTTPException(413, detail="metadata_payload_too_large")
        try:
            return fn(**kwargs)
        except ControlError as exc:
            if exc.code in {
                "unauthorised_session", "device_revoked", "scope_denied",
                "role_denied", "initial_physical_silence_required",
            }:
                status = 403
            elif exc.code in {"unknown_operation", "unknown_session", "unknown_transfer"}:
                status = 404
            elif exc.code in {
                "stale_generation", "stale_recipe", "stale_policy", "idempotency_conflict",
                "transfer_busy", "unsafe_partition_takeover", "unverified_old_output",
                "speaker_unreachable", "not_current_speaker", "destination_preflight_failed",
                "speaker_unavailable", "browser_not_running", "transfer_not_active",
                "transfer_conflict", "physical_silence_unconfirmed", "output_unconfirmed",
                "physical_output_unconfirmed", "local_execution_unverified",
            }:
                status = 409
            else:
                status = 422
            raise HTTPException(status, detail=exc.code) from None

    def identity(
        request: Request, response: Response,
        actor: ActorScope = Depends(authenticate_actor),
    ) -> ActorScope:
        # A trusted dependency must do real bearer verification, role and account checks.
        if not isinstance(actor, ActorScope):
            raise HTTPException(500, detail="identity_adapter_misconfigured")
        response.headers["Cache-Control"] = "no-store"
        return actor

    @router.post("/devices", status_code=201)
    def register(request: Request, body: Registration, actor: ActorScope = Depends(identity)):
        return _call(
            request, service.register, actor=actor, device_id=body.device_id,
            zone_id=body.zone_id, label=body.label, capabilities=body.capabilities,
            browser_version=body.browser_version, dsp_version=body.dsp_version,
        )

    @router.get("/zones/{zone_id}/devices")
    def list_devices(request: Request, zone_id: str, actor: ActorScope = Depends(identity)):
        return _call(request, service.devices, actor=actor, zone=zone_id)

    @router.get("/zones/{zone_id}/speaker")
    def selected_speaker(request: Request, zone_id: str, actor: ActorScope = Depends(identity)):
        return _call(request, service.speaker, actor=actor, zone=zone_id)

    @router.post("/devices/{device_id}/revoke")
    def revoke_device(request: Request, device_id: str, actor: ActorScope = Depends(identity)):
        return _call(request, service.revoke_device, actor=actor, device_id=device_id)

    @router.post("/sessions/{session_id}/refresh")
    def refresh(
        request: Request, session_id: str,
        token: str = Header(alias="X-Selecta-Session-Token"),
        actor: ActorScope = Depends(identity),
    ):
        return _call(request, service.refresh, actor=actor, session=session_id, token=token)

    @router.post("/sessions/{session_id}/presence")
    def presence(
        request: Request, session_id: str, body: Presence,
        token: str = Header(alias="X-Selecta-Session-Token"),
        actor: ActorScope = Depends(identity),
    ):
        return _call(
            request, service.presence, actor=actor, session=session_id, token=token,
            **body.model_dump(),
        )

    @router.get("/sessions/{session_id}/recovery")
    def recover(
        request: Request, session_id: str,
        token: str = Header(alias="X-Selecta-Session-Token"),
        actor: ActorScope = Depends(identity),
    ):
        return _call(request, service.recovery, actor=actor, session=session_id, token=token)

    @router.post("/sessions/{session_id}/revoke")
    def revoke(
        request: Request, session_id: str,
        token: str | None = Header(default=None, alias="X-Selecta-Session-Token"),
        actor: ActorScope = Depends(identity),
    ):
        return _call(request, service.revoke, actor=actor, session=session_id, token=token)

    @router.post("/zones/{zone_id}/commands", status_code=202)
    def command(request: Request, zone_id: str, body: Command,
                actor: ActorScope = Depends(identity)):
        return _call(
            request, service.command, actor=actor, zone=zone_id,
            target_session=body.target_session_id, operation_id=body.operation_id,
            idempotency_key=body.idempotency_key, action=body.action,
            arguments=body.arguments, expected_generation=body.expected_generation,
            recipe_revision=body.recipe_revision, policy_version=body.policy_version,
        )

    @router.post("/zones/{zone_id}/takeovers", status_code=202)
    def takeover(request: Request, zone_id: str, body: Takeover,
                 actor: ActorScope = Depends(identity)):
        return _call(
            request, service.takeover, actor=actor, zone=zone_id,
            target_session=body.target_session_id, operation_id=body.operation_id,
            idempotency_key=body.idempotency_key,
            expected_generation=body.expected_generation,
            initial_silence_confirmed=body.initial_silence_confirmed,
        )

    @router.get("/sessions/{session_id}/commands/next")
    def poll(
        request: Request, session_id: str,
        token: str = Header(alias="X-Selecta-Session-Token"),
        actor: ActorScope = Depends(identity),
    ):
        return _call(request, service.poll, actor=actor, session=session_id, token=token)

    @router.post("/sessions/{session_id}/commands/{operation_id}/ack")
    def ack(
        request: Request, session_id: str, operation_id: str, body: Acknowledgement,
        token: str = Header(alias="X-Selecta-Session-Token"),
        actor: ActorScope = Depends(identity),
    ):
        return _call(
            request, service.ack, actor=actor, session=session_id, token=token,
            operation_id=operation_id, **body.model_dump(),
        )

    @router.get("/zones/{zone_id}/commands/{operation_id}")
    def status(request: Request, zone_id: str, operation_id: str,
               actor: ActorScope = Depends(identity)):
        return _call(
            request, service.status, actor=actor, zone=zone_id, operation_id=operation_id,
        )

    @router.get("/zones/{zone_id}/takeovers/{transfer_id}")
    def transfer_status(request: Request, zone_id: str, transfer_id: str,
                        actor: ActorScope = Depends(identity)):
        return _call(
            request, service.transfer_status, actor=actor, zone=zone_id,
            transfer_id=transfer_id,
        )

    return router
