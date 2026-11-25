"""Is object storage really there? (doc 07b §7B.4 System; staging walkthrough, item [admin] 1)

For each bucket the service is configured to use (originals, derived, exports, staging), the
API asks R2 itself: does it exist (`HEAD` the bucket), can we write (put and delete one tiny
object under `_console-check/`), and does its CORS allow the app's origin for uploads. Each answer
says exactly what is wrong ("Storage bucket selecta-staging-originals doesn't exist"), and the
result is reported as `health.r2` so the Overview turns red without waiting for a task.

The answers are cached for five minutes in `admin_metrics` (`storage.check`), so opening System
or Overview never hammers R2. Without R2 credentials the check says which variables to set.
"""

from __future__ import annotations

import os
import time
import xml.etree.ElementTree as ET
from typing import Any

from sqlalchemy.engine import Connection

from selecta.admin import read_models
from selecta.persistence import db_now

KINDS = ("originals", "derived", "exports", "staging")
CACHE_S = 300.0
_cache: dict[str, Any] = {"at": 0.0, "result": None}


def _origins() -> list[str]:
    raw = (os.environ.get("SELECTA_ALLOWED_ORIGINS", "")
           or os.environ.get("SELECTA_EMAIL_SITE_URL", ""))
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


def _cors_allows(xml: bytes, origins: list[str]) -> bool:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return False
    allowed = {el.text.strip().rstrip("/") for el in root.iter()
               if el.tag.endswith("AllowedOrigin") and el.text}
    if "*" in allowed:
        return True
    return bool(origins) and all(o in allowed for o in origins)


def check(client_factory=None) -> dict[str, Any]:
    """Every bucket's state, live from R2 (or "not configured")."""
    if not os.environ.get("SELECTA_R2_ACCOUNT_ID", "").strip():
        return {"configured": False,
                "how": "Set SELECTA_R2_ACCOUNT_ID, SELECTA_R2_ACCESS_KEY_ID and "
                       "SELECTA_R2_SECRET_ACCESS_KEY on the API service.",
                "buckets": []}
    from selecta.storage import api as storage_api
    from selecta.storage.r2 import R2Error, R2NotFound, R2TransportError

    names = storage_api.buckets()
    origins = _origins()
    out = []
    try:
        client = (client_factory or storage_api.r2_client)()
    except Exception as problem:  # noqa: BLE001 - a bad configuration is the answer here
        return {"configured": True, "buckets": [],
                "error": f"Can't build the R2 client ({type(problem).__name__})."}
    if not hasattr(client, "_send"):
        # The development stack stores objects on disk (devstack.objects): nothing to check.
        return {"configured": True, "local": True, "buckets": [],
                "how": "Local disk storage (dev.cmd cloud); R2 is checked when deployed."}
    for kind in KINDS:
        bucket = getattr(names, kind)
        row: dict[str, Any] = {"kind": kind, "bucket": bucket, "exists": None, "writable": None,
                               "cors": None, "problems": []}
        try:
            client._send("HEAD", bucket, None, operation="HeadBucket")
            row["exists"] = True
        except R2NotFound:
            row["exists"] = False
            row["problems"].append(f"Storage bucket {bucket} doesn't exist.")
        except (R2Error, R2TransportError) as problem:
            row["problems"].append(f"Storage bucket {bucket} can't be reached "
                                   f"({type(problem).__name__}).")
        if row["exists"]:
            key = f"_console-check/{int(time.time())}"
            try:
                client.put_object(bucket, key, b"ok", content_type="text/plain")
                client.delete_object(bucket, key)
                row["writable"] = True
            except (R2Error, R2TransportError):
                row["writable"] = False
                row["problems"].append(f"Storage bucket {bucket} refuses writes from the API.")
            if kind == "staging":
                try:
                    reply = client._send("GET", bucket, None, operation="GetBucketCors",
                                         query=[("cors", "")])
                    row["cors"] = _cors_allows(reply.content, origins)
                except R2NotFound:
                    row["cors"] = False
                except (R2Error, R2TransportError):
                    row["cors"] = None
                if row["cors"] is False:
                    row["problems"].append(
                        f"Storage bucket {bucket} has no CORS rule for "
                        f"{', '.join(origins) or 'the app'}, so browsers can't upload to it.")
        out.append(row)
    return {"configured": True, "buckets": out}


def cached(conn: Connection, *, force: bool = False) -> dict[str, Any]:
    """The last check, at most five minutes old, and reported as `health.r2`."""
    now = time.monotonic()
    if not force and _cache["result"] is not None and now - _cache["at"] < CACHE_S:
        return _cache["result"]
    result = check()
    result["as_of"] = db_now(conn)
    _cache.update(at=now, result=result)
    if result.get("configured"):
        healthy = not result.get("error") and all(not b["problems"] for b in result["buckets"])
        read_models.report(conn, "health.r2", 1.0 if healthy else 0.0)
    return result


__all__ = ["cached", "check"]
