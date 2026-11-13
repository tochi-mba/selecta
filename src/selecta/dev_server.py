"""Visible development-only factory for the local Selecta API.

Keep this module lightweight so progress appears before importing audio/ML code.
"""

from __future__ import annotations

import faulthandler
import time


def application():
    started = time.monotonic()
    print("[BOOT] Starting the local API factory.", flush=True)
    print("[BOOT] Importing Selecta API modules (first load may be slow)...", flush=True)
    # If an import, migration or model initialization blocks in native code,
    # print live Python stacks periodically rather than showing no progress.
    faulthandler.dump_traceback_later(60, repeat=True)
    from selecta.modes import Mode, current_mode

    if current_mode() is not Mode.LOCAL:
        raise RuntimeError("The development API factory only supports SELECTA_MODE=local.")
    from selecta.api import serve

    print(f"[BOOT] API modules loaded after {time.monotonic() - started:.1f}s.", flush=True)
    try:
        result = serve()
        print(f"[BOOT] Local API ready after {time.monotonic() - started:.1f}s.", flush=True)
        return result
    finally:
        faulthandler.cancel_dump_traceback_later()


def engine_application():
    """Explicit opt-in guarded local-engine factory, not the existing dev default."""
    from selecta.modes import Mode, current_mode

    if current_mode() is not Mode.LOCAL:
        raise RuntimeError("A local engine must use SELECTA_MODE=local.")
    from selecta.local_engine.http import application as local_engine_application

    return local_engine_application()
