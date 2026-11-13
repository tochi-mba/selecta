"""Allowlisted capability probes. Detection alone is not proof of audible output."""

from __future__ import annotations

import ctypes
import os
import platform
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from selecta.local_engine import MIN_PROTOCOL_VERSION, PROTOCOL_VERSION

ENGINE_VERSION = "0.1.0"


class IncompatibleProtocol(ValueError):
    pass


def negotiate_version(peer_min: int, peer_max: int) -> int:
    if type(peer_min) is not int or type(peer_max) is not int or peer_min > peer_max:
        raise IncompatibleProtocol("Invalid peer protocol range.")
    version = min(PROTOCOL_VERSION, peer_max)
    if version < max(MIN_PROTOCOL_VERSION, peer_min):
        raise IncompatibleProtocol("No compatible local-engine protocol version.")
    return version


def ffmpeg_probe() -> dict[str, Any]:
    """Require a working binary and enumerate decoders; no inferred codec claims."""
    binary = shutil.which("ffmpeg")
    missing = {"available": False, "version": None, "decoders": []}
    if binary is None:
        return missing
    try:
        info = subprocess.run(
            [binary, "-version"], capture_output=True, text=True, timeout=3, check=False
        )
        header = info.stdout.splitlines()[0] if info.stdout else ""
        if info.returncode or not header.startswith("ffmpeg version "):
            return missing
        listing = subprocess.run(
            [binary, "-hide_banner", "-decoders"],
            capture_output=True, text=True, timeout=3, check=False,
        )
        lines = listing.stdout if listing.returncode == 0 else ""
        supported = []
        for codec, prefix in (
            ("aac", "aac"),
            ("flac", "flac"),
            ("mp3", "mp3"),
            ("wav", "pcm_s16"),
        ):
            if re.search(rf"(?m)^\\s*[A-Z.]{6}\\s+{prefix}\\w*\\s+", lines):
                supported.append(codec)
        return {
            "available": True,
            "version": header.split(" ")[2][:48],
            "decoders": supported,
        }
    except (OSError, subprocess.TimeoutExpired):
        return missing


def model_inventory(home: Path | None = None) -> dict[str, Any]:
    """Count local checkpoint candidates without exporting names or file paths."""
    folder = (
        home if home is not None else
        Path(os.environ.get("SELECTA_HOME", str(Path.home() / ".selecta")))
    ) / "models"
    try:
        count = sum(
            child.is_file() and child.suffix.lower() in
            {".pt", ".pth", ".ckpt", ".onnx", ".safetensors"}
            for child in folder.iterdir()
        )
    except OSError:
        count = 0
    return {
        "checkpoint_candidates": count,
        "state": "present_unvalidated" if count else "not_detected",
    }

def output_inventory(platform_name: str | None = None) -> dict[str, Any]:
    """A conservative presence probe; never label output working from enumeration."""
    name = platform_name or sys.platform
    if name == "win32":
        try:
            count = int(ctypes.WinDLL("winmm").waveOutGetNumDevs())
            return {"detected": count, "probe": "winmm", "supported": True}
        except (AttributeError, OSError):
            return {"detected": 0, "probe": "winmm_unavailable", "supported": True}
    if name.startswith("linux"):
        pcm = Path("/proc/asound/pcm")
        try:
            lines = pcm.read_text("utf-8").splitlines()
            count = sum("playback" in line for line in lines)
        except OSError:
            count = 0
        return {"detected": count, "probe": "alsa_pcm", "supported": True}
    if name == "darwin":
        return {"detected": 0, "probe": "not_validated", "supported": False}
    return {"detected": 0, "probe": "unsupported_platform", "supported": False}


def resources() -> dict[str, Any]:
    try:
        import psutil

        return {
            "cpu_cores": os.cpu_count() or 1,
            "ram_bytes": int(psutil.virtual_memory().total),
        }
    except (ImportError, OSError):
        return {"cpu_cores": os.cpu_count() or 1, "ram_bytes": None}


@dataclass(frozen=True)
class OutputEvidence:
    output_id: str
    sampled_at: float
    audible_sample_confirmed: bool

    def fresh(self, now: float | None = None, max_age_seconds: float = 10) -> bool:
        now = time.time() if now is None else now
        return (
            self.audible_sample_confirmed
            and bool(self.output_id)
            and 0 <= now - self.sampled_at <= max_age_seconds
        )


def capability_report(
    *, output_evidence: OutputEvidence | None = None, platform_name: str | None = None
) -> dict[str, Any]:
    """No paths, fingerprints, PCM, model checkpoints or identifiers leave this report."""
    name = platform_name or sys.platform
    ffmpeg = ffmpeg_probe()
    output = output_inventory(name)
    confirmed = (
        output_evidence is not None
        and output_evidence.fresh()
        and output["detected"] > 0
        and output["supported"]
    )
    return {
        "schema_version": 1,
        "engine_version": ENGINE_VERSION,
        "protocol_min": MIN_PROTOCOL_VERSION,
        "protocol_max": PROTOCOL_VERSION,
        "platform": name,
        "architecture": platform.machine(),
        "ffmpeg": ffmpeg,
        "supported_codecs": ffmpeg.get("decoders", []),
        "models": model_inventory(),
        "resources": resources(),
        "output": {
            **output,
            "actual_audio_verified": bool(confirmed),
            "state": "verified" if confirmed else "unverified",
        },
        "ready_for_audio": bool(ffmpeg["available"] and confirmed),
    }
