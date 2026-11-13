"""Record the machine a performance number came from (Flow SF-0199-06, automatable part).

Run on the machine being measured:

    python src/selecta/audit/hardware_baseline.py [--browser "Edge 142"] [--gpu "..."]
        [--load "idle, no other apps"] [--out baseline.json]

It fills in what this computer can say about itself (OS, CPU, cores, memory, Python) and the
exact benchmark steps, and lists every field a person still has to fill (browser, GPU, background
load) so a baseline is never recorded with a guess. The measured run itself stays the person's.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import platform
import sys
from datetime import date
from pathlib import Path

PERSON_FIELDS = ("browser", "gpu", "background_load")

# The steps that make two baselines comparable. Each names a check that already exists.
PROTOCOL = (
    "Close every other app; plug in the power; let the machine idle for two minutes.",
    "Start the site with the made-up library: python tests/e2e_server.py.",
    "Open /listen in the named browser at 100% zoom, in a 1440x900 window, Light theme.",
    "Press Play and leave Listen showing for 60 seconds with the spectrum on (Expressive).",
    "Record CPU and GPU use from the OS task manager at the 30 and 60 second marks.",
    "Repeat with motion set to Still, then with the tab hidden, and record the same numbers.",
    "Run web/src/views/visualizerBudget.test.tsx on the same machine and note it passed.",
)


def memory_bytes() -> int | None:
    """Total physical memory, or None when this OS will not say."""
    if sys.platform == "win32":

        class Status(ctypes.Structure):
            _fields_ = [
                ("length", ctypes.c_ulong),
                ("load", ctypes.c_ulong),
                ("total", ctypes.c_ulonglong),
                ("avail", ctypes.c_ulonglong),
                ("page_total", ctypes.c_ulonglong),
                ("page_avail", ctypes.c_ulonglong),
                ("virtual_total", ctypes.c_ulonglong),
                ("virtual_avail", ctypes.c_ulonglong),
                ("extended", ctypes.c_ulonglong),
            ]

        status = Status()
        status.length = ctypes.sizeof(Status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):  # type: ignore[attr-defined]
            return int(status.total)
        return None
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (AttributeError, ValueError, OSError):
        return None


def collect(browser: str = "", gpu: str = "", background_load: str = "") -> dict[str, object]:
    """Everything this computer reports, plus the person's fields and what is still missing."""
    memory = memory_bytes()
    record: dict[str, object] = {
        "date": date.today().isoformat(),
        "os": f"{platform.system()} {platform.release()} ({platform.version()})",
        "machine": platform.machine(),
        "cpu": platform.processor() or platform.machine(),
        "logical_cores": os.cpu_count(),
        "memory_gb": round(memory / 1024**3, 1) if memory else None,
        "python": platform.python_version(),
        "browser": browser.strip(),
        "gpu": gpu.strip(),
        "background_load": background_load.strip(),
        "protocol": list(PROTOCOL),
    }
    record["missing"] = [field for field in PERSON_FIELDS if not record[field]]
    return record


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--browser", default="")
    parser.add_argument("--gpu", default="")
    parser.add_argument("--load", default="")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    record = collect(args.browser, args.gpu, args.load)
    text = json.dumps(record, indent=2)
    if args.out:
        args.out.write_text(text + "\n", encoding="utf-8")
    print(text)
    if record["missing"]:
        print("still needs a person: " + ", ".join(record["missing"]), file=sys.stderr)  # type: ignore[arg-type]
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
