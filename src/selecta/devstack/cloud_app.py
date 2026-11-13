"""The real Cloud API (`api_cloud.create_cloud_app`) wired to local stand-ins, for `dev.cmd cloud`.

What changes from a deployment, and nothing else:

- identity: WorkOS is the local identity provider (`devstack.identity`). The API verifies its
  RS256 tokens with the production verifier (keys fetched from the provider's JWKS), reads users
  and revokes sessions with the production `WorkOSClient`, and receives its signed webhooks on the
  production webhook route. `require_workos` stays on, as in production;
- object storage: `DiskObjects` in the data folder instead of R2, with signed URLs on the site;
- billing: the pretend Stripe (`devstack.billing`) unless Stripe test mode was asked for;
- Rooms: the host's own uploads as the requestable song list (`devstack.rooms`);
- the database: SQLite in the data folder, or the PostgreSQL URL the developer gave, migrated to
  the newest schema at start-up (a deployment runs migrations as a release step instead).

Run by the launcher as `uvicorn selecta.devstack.cloud_app:application --factory`.
"""

from __future__ import annotations

import os

from fastapi import FastAPI

from selecta.api_cloud import CloudSettings, create_cloud_app
from selecta.billing import api as billing_api
from selecta.devstack import billing, guard, local_watches, objects
from selecta.devstack.rooms import LibraryCatalog, QueuePlanner
from selecta.devstack.settings import CLIENT_ID, DevSettings
from selecta.persistence import make_engine, migrate
from selecta.rooms.cloud_ports import RoomPorts
from selecta.storage import api as storage_api

STRIPE_TEST_MODE_ENV = "SELECTA_DEV_STRIPE_TEST_MODE"


def use_disk_storage(settings: DevSettings) -> objects.DiskObjects:
    """Point every Cloud storage route (and the worker's verifier) at the data folder."""
    store = objects.DiskObjects.in_folder(settings.objects, settings.site_url)
    for name in ("ACCOUNT_ID", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"):
        os.environ[f"SELECTA_R2_{name}"] = "local-disk"
    storage_api.R2Client = lambda *_args, **_kwargs: store  # type: ignore[assignment,misc]
    return store


def stripe_test_mode() -> bool:
    """True only when asked for and the key is a Stripe test key (a live key never runs)."""
    key = os.environ.get("SELECTA_STRIPE_SECRET_KEY", "").strip()
    return os.environ.get(STRIPE_TEST_MODE_ENV) == "1" and key.startswith("sk_test_")


def cloud_settings(settings: DevSettings) -> CloudSettings:
    return CloudSettings(
        database_url=settings.database_url,
        workos_client_id=CLIENT_ID,
        issuer=f"{settings.identity_url}/user_management/{CLIENT_ID}",
        audience=CLIENT_ID,
        allowed_hosts=("127.0.0.1", "localhost"),
        allowed_origins=settings.site_origins,
        workos_api_base=settings.identity_url,
        workos_api_key=guard.LOCAL_WORKOS_KEY,
        workos_webhook_secret=settings.secret("workos-webhook"),
        require_workos=True,
    )


def application() -> FastAPI:
    guard.require_development()
    settings = DevSettings.from_environment()
    engine = make_engine(settings.database_url)
    migrate.upgrade(engine)
    use_disk_storage(settings)
    os.environ.setdefault("SELECTA_ROOMS_PEPPER", settings.secret("rooms-pepper"))
    test_mode = stripe_test_mode()
    if not test_mode:
        os.environ.update(billing.environment())
    ports = RoomPorts(
        pepper=settings.secret("rooms-pepper").encode(),
        catalog=LibraryCatalog(engine),
        planner=QueuePlanner(),
    )
    app = create_cloud_app(cloud_settings(settings), engine=engine, room_ports=ports)
    store = objects.DiskObjects.in_folder(settings.objects, settings.site_url)
    objects.install_routes(app, store)
    # Only the loopback development companion manages local filesystem watches.
    # Hosted Cloud does not import or expose these paths or audio contents.
    local_watches.install_routes(app, settings)
    app.add_middleware(guard.LoopbackOnly)
    client = billing.install(app, engine, settings.data)
    if not test_mode:
        billing_api.HttpStripeClient = client  # type: ignore[assignment,misc]

    @app.get("/dev/stack", include_in_schema=False)
    def stack():
        return {
            "service": "selecta-cloud-dev",
            "site": settings.site_url,
            "identity": settings.identity_url,
            "inbox": f"{settings.site_url}/dev/mail",
            "billing": "stripe-test-mode" if test_mode else "pretend",
            "database": "postgresql" if settings.database_url.startswith("postgres") else "sqlite",
        }

    return app


__all__ = ["application", "cloud_settings", "use_disk_storage"]
