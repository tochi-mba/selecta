"""Visible development-only factory for the local Selecta API.

Keep this module lightweight so progress appears before importing audio/ML code.
"""

from __future__ import annotations

import time


def application():
    started = time.monotonic()
    print("[BOOT] Starting the local API factory.", flush=True)
    print("[BOOT] Importing Selecta API modules (first load may be slow)...", flush=True)
    from selecta.modes import Mode, current_mode

    if current_mode() is not Mode.LOCAL:
        raise RuntimeError("The development API factory only supports SELECTA_MODE=local.")
    from selecta.api import serve

    print(f"[BOOT] API modules loaded after {time.monotonic() - started:.1f}s.", flush=True)
    result = serve()
    print(f"[BOOT] Local API ready after {time.monotonic() - started:.1f}s.", flush=True)
    return result
