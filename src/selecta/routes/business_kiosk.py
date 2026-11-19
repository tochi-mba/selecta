"""Kiosk player routes (ADR-0445, and the kiosk side of ADR-0446).

Installed by `api_cloud.py`. Every route is owned by the `business.kiosk` flag (off in the
build), so while it is off the flag guard refuses them all with 403 `flag_off`, the
repository's stable flag contract (`flags/guard.py`).

The kiosk itself never signs in as a person. Its calls carry one of two HttpOnly, Secure,
SameSite=Strict cookies scoped to `/api/kiosk`:

- `selecta_kiosk_pairing`: the status secret of an unpaired kiosk's pairing code;
- `selecta_kiosk`: the kiosk token, handed over once when a manager has paired it.

Kiosk routes: `POST /api/kiosk/pairings` (rate limited per address), `GET
/api/kiosk/pairings/status`, `POST /api/kiosk/heartbeat` (signed with the device key), `POST
/api/kiosk/health`, `GET /api/kiosk/view` (allowlisted fields only), `GET /api/kiosk/horizon`,
`POST /api/kiosk/segment-url`, `POST /api/kiosk/resync`, `POST /api/kiosk/pin`.

Manager routes (signed in, in the organisation's workspace): `POST /api/kiosk/pair`, `GET
/api/business/kiosks` and `DELETE /api/devices/{device_id}/kiosk` (unpair).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine

from selecta import flags
from selecta.business import alerts, health, kiosk, kiosk_rooms, offline, permits, zone_clock
from selecta.business.access import BusinessForbidden, BusinessNotFound
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction
from selecta.playback import zone_session
from selecta.playback.model import PlaybackError, PlayState, Position
from selecta.playback.schema import playback_sessions
from selecta.playback.store import session_payload
from selecta.playback.zones import SQL_ZONES, ZoneDirectory
from selecta.rooms import codes
from selecta.rooms.limits import Limited, Limiter, Window

PAIRING_PER_IP = Window(10, 60.0)
PIN_PER_DEVICE = Window(5, 300.0)

Presign = Callable[[str, str], str | None]
"""(workspace_id, object key) -> a short-lived GET URL, or None when storage isn't set up."""
HorizonFor = Callable[[Engine, str, str], list[dict[str, Any]]]


class PairingIn(BaseModel):
    public_key: str = Field(min_length=40, max_length=400)
    machine_id: str = Field(min_length=8, max_length=128)
    device_name: str | None = Field(default=None, max_length=60)


class PairIn(BaseModel):
    code: str = Field(min_length=6, max_length=12)
    zone_id: str = Field(min_length=1, max_length=64)
    name: str | None = Field(default=None, max_length=60)
    replace_device_id: str | None = Field(default=None, max_length=64)


class HeartbeatIn(BaseModel):
    nonce: str = Field(min_length=1, max_length=64)
    signature: str = Field(min_length=1, max_length=200)
    kiosk_version: str = Field(min_length=1, max_length=32)
    song_index: int = Field(default=0, ge=0)
    offset_ms: int = Field(default=0, ge=0)
    state: str | None = Field(default=None, max_length=8)
    fence: int | None = None


class SegmentIn(BaseModel):
    key: str = Field(min_length=1, max_length=255)


class ResyncIn(BaseModel):
    entries: list[dict[str, Any]] = Field(default_factory=list, max_length=2000)


class PinIn(BaseModel):
    pin: str = Field(min_length=1, max_length=12)


def storage_presign(client_factory: Callable[[], Any], buckets: Any) -> Presign:
    """A `Presign` over the Cloud's object storage: an uploaded original or a rendered seam in
    the kiosk's own workspace, for 5 minutes."""
    from selecta.storage.keys import Bucket, UnsafeKey, validate_key, workspace_of
    from selecta.storage.objects import R2Error

    def presign(workspace_id: str, key: str) -> str | None:
        try:
            if validate_key(key) not in (Bucket.ORIGINALS, Bucket.DERIVED):
                return None
            if workspace_of(key) != workspace_id:
                return None
        except UnsafeKey:
            return None
        client = client_factory()
        try:
            return client.presign_get(buckets.name(validate_key(key)), key, 300)
        except R2Error:
            return None
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()

    return presign


def _refuse(error: kiosk.KioskError) -> HTTPException:
    detail: dict[str, Any] = {"code": error.code, "message": str(error)}
    if error.code == "kiosk_nonce_stale":
        detail = {"code": error.code, "nonce": str(error)}
    return HTTPException(status_code=error.status, detail=detail)


def _cookie(response: Response, name: str, value: str, max_age: int) -> None:
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        httponly=True,
        secure=True,
        samesite="strict",
        path=kiosk.COOKIE_PATH,
    )


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    pepper: bytes = b"",
    presign: Presign | None = None,
    horizon_for: HorizonFor | None = None,
    zones: ZoneDirectory = SQL_ZONES,
    limiter: Limiter | None = None,
    keyring: permits.Keyring | None = None,
) -> None:
    limits = limiter or Limiter()
    ring = keyring or permits.default_keyring()
    if horizon_for is None:
        from selecta.business.horizon import planned_horizon as horizon_for

    def peppered() -> bytes:
        if len(pepper) < codes.MIN_PEPPER_BYTES:
            raise HTTPException(status_code=503, detail={"code": "kiosk_pairing_unavailable"})
        return pepper

    def address(request: Request) -> str:
        return request.client.host if request.client else "unknown"

    def kiosk_auth(request: Request) -> kiosk.KioskAuth:
        try:
            with transaction(engine) as conn:
                return kiosk.authenticate(conn, request.cookies.get(kiosk.TOKEN_COOKIE))
        except kiosk.KioskError as error:
            raise _refuse(error) from None

    def organisation(request: Request, claims: Claims) -> tuple[str, str]:
        """(organisation workspace id, the signed-in person's user id)."""
        found = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if found.workspace.kind != "business":
            raise HTTPException(status_code=404, detail={"code": "not_found"})
        return found.workspace.id, found.user.id

    def business_call(run: Callable[[], Any]) -> Any:
        try:
            return run()
        except BusinessNotFound:
            raise HTTPException(status_code=404, detail={"code": "not_found"}) from None
        except BusinessForbidden:
            raise HTTPException(status_code=403, detail={"code": "forbidden"}) from None
        except kiosk.KioskError as error:
            raise _refuse(error) from None

    # -- the unpaired kiosk

    @app.post("/api/kiosk/pairings", status_code=201)
    def start_pairing(body: PairingIn, request: Request, response: Response) -> dict[str, Any]:
        key = peppered()
        try:
            limits.hit("kiosk_pairing", address(request), PAIRING_PER_IP)
        except Limited as error:
            raise HTTPException(
                status_code=429,
                detail={"code": "slow_down"},
                headers={"Retry-After": str(int(error.retry_after_s) + 1)},
            ) from None
        try:
            started = kiosk.start_pairing(
                engine,
                key,
                public_key=body.public_key,
                machine_id=body.machine_id,
                device_name=body.device_name,
            )
        except ValueError:
            raise HTTPException(status_code=422, detail={"code": "bad_device_key"}) from None
        _cookie(
            response,
            kiosk.PAIRING_COOKIE,
            started.pop("status_secret"),
            int(kiosk.PAIRING_SECONDS) + 60,
        )
        return started

    @app.get("/api/kiosk/pairings/status")
    def pairing_status(request: Request, response: Response) -> dict[str, Any]:
        found = kiosk.collect(engine, request.cookies.get(kiosk.PAIRING_COOKIE) or "")
        token = found.pop("token", None)
        if token:
            # the keys this player pins for its offline bundles, given once over the pairing
            found["permit_keys"] = [key["public_key"] for key in ring.public()]
            _cookie(response, kiosk.TOKEN_COOKIE, token, 400 * 86_400)
            response.delete_cookie(kiosk.PAIRING_COOKIE, path=kiosk.COOKIE_PATH)
        return found

    # -- the manager

    @app.post("/api/kiosk/pair", status_code=201)
    def pair(body: PairIn, request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        workspace_id, user_id = organisation(request, claims)
        key = peppered()
        return business_call(
            lambda: kiosk.pair(
                engine,
                key,
                workspace_id=workspace_id,
                user_id=user_id,
                code=body.code,
                zone_id=body.zone_id,
                name=body.name,
                replace_device_id=body.replace_device_id,
            )
        )

    @app.get("/api/business/kiosks")
    def list_kiosks(
        request: Request,
        venue_id: str | None = None,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id, user_id = organisation(request, claims)
        found = business_call(
            lambda: kiosk.list_kiosks(
                engine,
                workspace_id=workspace_id,
                user_id=user_id,
                venue_id=venue_id,
            )
        )
        return {"kiosks": found}

    @app.get("/api/business/zone-alerts")
    def zone_alerts_open(
        request: Request,
        venue_id: str | None = None,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """The players that need a look (ADR-0453 Needs attention); refreshed on `zone.alert`."""
        workspace_id, user_id = organisation(request, claims)
        found = business_call(
            lambda: alerts.open_for(
                engine, workspace_id=workspace_id, user_id=user_id, venue_id=venue_id
            )
        )
        return {"alerts": found}

    @app.post("/api/business/zone-alerts/{alert_id}/acknowledge")
    def zone_alert_acknowledge(
        alert_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id, user_id = organisation(request, claims)
        visible = business_call(
            lambda: alerts.open_for(engine, workspace_id=workspace_id, user_id=user_id)
        )
        if alert_id not in {item["id"] for item in visible}:
            raise HTTPException(status_code=404, detail={"code": "not_found"})
        alerts.acknowledge(engine, workspace_id, alert_id, user_id)
        return {"id": alert_id, "acknowledged": True}

    @app.delete("/api/devices/{device_id}/kiosk")
    def unpair(device_id: str, request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        workspace_id, user_id = organisation(request, claims)
        return business_call(
            lambda: kiosk.unpair(
                engine,
                workspace_id=workspace_id,
                user_id=user_id,
                device_id=device_id,
            )
        )

    # -- the paired kiosk

    @app.post("/api/kiosk/heartbeat")
    def heartbeat(body: HeartbeatIn, request: Request, response: Response) -> dict[str, Any]:
        try:
            verified = kiosk.verify_heartbeat(
                engine,
                request.cookies.get(kiosk.TOKEN_COOKIE),
                nonce=body.nonce,
                signature=body.signature,
                kiosk_version=body.kiosk_version,
            )
        except kiosk.KioskError as error:
            raise _refuse(error) from None
        if verified.new_token:
            _cookie(response, kiosk.TOKEN_COOKIE, verified.new_token, 400 * 86_400)
        auth, now = verified.auth, verified.server_time
        state = PlayState(body.state) if body.state in {s.value for s in PlayState} else None
        answer: dict[str, Any] = {
            "nonce": verified.nonce,
            "server_time": now,
            "latest": kiosk.latest_release(),
            "role": auth.role,
        }
        try:
            result = zone_session.zone_heartbeat(
                engine,
                zones,
                auth.workspace_id,
                auth.zone_id,
                auth.device_id,
                Position(song_index=body.song_index, offset_ms=body.offset_ms, state=state),
                fence=body.fence,
            )
        except PlaybackError as error:
            answer["outcome"] = "refused"
            answer["refusal"] = getattr(error, "code", "refused")
            answer["session"] = None
        else:
            answer["outcome"] = result.outcome.value
            answer["session"] = session_payload(result.session, now)
            answer["hand_back_to_device_id"] = result.hand_back_to_device_id
        health.touch_heartbeat(engine, auth, now)
        return answer

    @app.post("/api/kiosk/health")
    def report_health(body: dict[str, Any], request: Request) -> dict[str, Any]:
        auth = kiosk_auth(request)
        with transaction(engine) as conn:
            now = db_now(conn)
        # the venue network for Rooms (ADR-0451 BZ-0451-07), as a keyed hash only
        try:
            kiosk_rooms.record_network(
                engine, pepper, auth, request.cookies.get(kiosk.TOKEN_COOKIE), address(request)
            )
        except (BusinessNotFound, BusinessForbidden, ValueError):
            pass  # the health report never fails for Rooms
        return health.record_health(
            engine,
            auth,
            body,
            address=address(request),
            pepper=pepper or b"selecta-kiosk",
            now=now,
        )

    @app.get("/api/kiosk/view")
    def view(request: Request) -> dict[str, Any]:
        auth = kiosk_auth(request)
        with transaction(engine) as conn:
            now = db_now(conn)
        return health.kiosk_view(engine, auth, now=now, version=kiosk.latest_release()["version"])

    @app.get("/api/kiosk/horizon")
    def horizon(request: Request, quota_bytes: int | None = None) -> dict[str, Any]:
        auth = kiosk_auth(request)
        from selecta.routes.business_zones import schedule_for

        with transaction(engine, auth.workspace_id) as conn:
            now = db_now(conn)
            tz = health._venue_and_zone(conn, auth)
            schedule: dict[str, Any] = {}
            if tz is not None and auth.venue_id:
                ref = zone_clock.ZoneRef(
                    workspace_id=auth.workspace_id,
                    venue_id=auth.venue_id,
                    zone_id=auth.zone_id,
                    tz=tz.timezone,
                )
                try:
                    schedule = schedule_for(conn, ref, now)
                except (ValueError, LookupError):
                    schedule = {}
            volume = conn.execute(
                sa.select(playback_sessions.c.volume).where(
                    playback_sessions.c.workspace_id == auth.workspace_id,
                    playback_sessions.c.zone_id == auth.zone_id,
                )
            ).scalar()
            body = permits.build_body(
                conn,
                workspace_id=auth.workspace_id,
                venue_id=auth.venue_id,
                zone_id=auth.zone_id,
                device_id=auth.device_id,
                schedule=schedule,
                volume=volume,
                now=now,
            )
        items = horizon_for(engine, auth.workspace_id, auth.zone_id)
        manifest = offline.horizon_manifest(
            auth.zone_id, items, now, schedule or None, offline.device_cap_bytes(quota_bytes)
        )
        by_id = {item["id"]: item for item in items}
        for segment in manifest.get("segments", []):
            extra = by_id.get(segment.get("id"), {})
            for name in ("title", "artist", "song_index", "song_id", "from_s"):
                if name in extra:
                    segment[name] = extra[name]
        if not flags.on("business.offline"):
            # Offline-first is off: the next three songs only, and no permit to play offline.
            manifest["segments"] = manifest.get("segments", [])[: offline.COMMITTED_COUNT]
            manifest["offline"] = False
            manifest["server_time"] = now
            return manifest
        manifest["offline"] = True
        # The signed bundle is what the kiosk trusts offline; these copies are for display only.
        manifest["offline_bundle"] = permits.sign(body, ring)
        manifest["issued_at"] = body["permit"]["issued_at"]
        manifest["valid_until"] = body["permit"]["valid_until"]
        manifest["server_time"] = now
        return manifest

    @app.post("/api/kiosk/segment-url")
    def segment_url(body: SegmentIn, request: Request) -> dict[str, Any]:
        auth = kiosk_auth(request)
        allowed = {item["key"] for item in horizon_for(engine, auth.workspace_id, auth.zone_id)}
        if body.key not in allowed:
            raise HTTPException(status_code=404, detail={"code": "artifact_not_found"})
        url = presign(auth.workspace_id, body.key) if presign is not None else None
        if url is None:
            raise HTTPException(status_code=503, detail={"code": "storage_unavailable"})
        return {"url": url, "expires_in": 300}

    @app.post("/api/kiosk/resync")
    def resync(body: ResyncIn, request: Request) -> dict[str, Any]:
        auth = kiosk_auth(request)
        with transaction(engine) as conn:
            now = db_now(conn)
        try:
            return health.resync_plays(engine, auth, body.entries, now=now)
        except Exception as error:  # noqa: BLE001 - a bad entry refuses the batch, plainly
            code = getattr(error, "code", "bad_entry")
            raise HTTPException(status_code=422, detail={"code": code}) from None

    # -- Rooms for Business on the zone's player (ADR-0451; the bridge is business.kiosk_rooms)

    def rooms_call(run: Callable[[], Any]) -> Any:
        try:
            return run()
        except (BusinessNotFound, BusinessForbidden):
            raise HTTPException(status_code=404, detail={"code": "not_found"}) from None
        except ValueError:  # Rooms can't start without its pepper
            raise HTTPException(status_code=503, detail={"code": "rooms_unavailable"}) from None

    @app.get("/api/kiosk/requests/next")
    def kiosk_next_request(request: Request) -> dict[str, Any]:
        auth = kiosk_auth(request)
        token = request.cookies.get(kiosk.TOKEN_COOKIE)
        return {
            "request": rooms_call(lambda: kiosk_rooms.next_request(engine, pepper, auth, token))
        }

    @app.post("/api/kiosk/requests/{request_id}/played")
    def kiosk_request_played(request_id: str, request: Request) -> dict[str, Any]:
        auth = kiosk_auth(request)
        token = request.cookies.get(kiosk.TOKEN_COOKIE)
        played = rooms_call(
            lambda: kiosk_rooms.mark_played(engine, pepper, auth, token, request_id)
        )
        return {"id": request_id, "played": played}

    @app.get("/api/kiosk/screen-code")
    def kiosk_screen_code(request: Request) -> dict[str, Any]:
        auth = kiosk_auth(request)
        token = request.cookies.get(kiosk.TOKEN_COOKIE)
        return rooms_call(lambda: kiosk_rooms.screen_code(engine, pepper, auth, token))

    @app.post("/api/kiosk/pin")
    def pin(body: PinIn, request: Request) -> dict[str, Any]:
        auth = kiosk_auth(request)
        try:
            limits.hit("kiosk_pin", auth.device_id, PIN_PER_DEVICE)
        except Limited:
            return {"ok": False}
        return {"ok": health.check_pin(engine, auth, body.pin)}


__all__ = ["install_routes"]
