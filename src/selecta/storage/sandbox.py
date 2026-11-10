"""Validate an uploaded file in a sandboxed child process before it can become a song (ADR-0398).

`probe_in_sandbox(path)` is `ingest.validate` for Cloud uploads. The API process only hashes the
file (a plain read); everything that parses it runs in a fresh Python child
(`selecta.storage.audio_check`) with:

- a wall-clock timeout, after which the child (and on POSIX its whole process group) is killed;
- on POSIX, caps on address space, CPU seconds, file writes and open files, set by the child
  on itself before it opens the file, inherited by the ffmpeg it may start;
- a cap on how much it may answer: more than `max_output_bytes` and it is killed;
- an isolated interpreter (`-I`), a scrubbed environment, single-threaded maths libraries, and
  its working directory in the upload's own temporary folder.

A crash, a kill, a garbled answer or a timeout all reject the file, so the worst a hostile file
can do is be refused. Every refusal is `audio_check.Rejected` with a stable `code`.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from collections.abc import Sequence
from pathlib import Path

from selecta.storage.audio_check import (
    EMPTY,
    FAILED,
    MESSAGES,
    TIMEOUT,
    TOO_LARGE,
    Limits,
    Rejected,
)
from selecta.storage.r2 import file_sha256
from selecta.storage.uploads import Probe

DEFAULT_LIMITS = Limits()
CHILD = ("-I", "-m", "selecta.storage.audio_check")
# What the child may see of our environment: enough to start Python and find ffmpeg.
PASSED_ENV = ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL")
SINGLE_THREADED = {
    "OPENBLAS_NUM_THREADS": "1",
    "OMP_NUM_THREADS": "1",
    "MKL_NUM_THREADS": "1",
    "PYTHONDONTWRITEBYTECODE": "1",
}


def _environment() -> dict[str, str]:
    env = {name: os.environ[name] for name in PASSED_ENV if name in os.environ}
    env.update(SINGLE_THREADED)
    return env


def _start(command: Sequence[str], cwd: Path) -> subprocess.Popen[bytes]:
    options: dict = {}
    if os.name == "posix":
        options["start_new_session"] = True  # its own process group, so a kill takes ffmpeg too
    else:
        options["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(
            subprocess, "CREATE_NO_WINDOW", 0
        )
    return subprocess.Popen(
        list(command),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        cwd=str(cwd),
        env=_environment(),
        **options,
    )


def _kill(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    if os.name == "posix":
        import signal

        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            process.kill()
    else:
        process.kill()


def run_child(path: Path, limits: Limits, command: Sequence[str] | None = None) -> dict:
    """Run one check in a child and return its answer; `Rejected` if it misbehaved."""
    command = list(command) if command else [sys.executable, *CHILD]
    request = json.dumps({"path": str(path), "limits": limits.to_json()}).encode()
    process = _start(command, path.parent)
    assert process.stdin is not None and process.stdout is not None
    captured: list[bytes] = []
    reader = threading.Thread(
        target=lambda: captured.append(process.stdout.read(limits.max_output_bytes + 1)),
        daemon=True,
    )
    reader.start()
    started = time.monotonic()
    try:
        try:
            process.stdin.write(request)
            process.stdin.close()
        except OSError:
            pass  # it died before reading; its answer (or lack of one) says why
        reader.join(limits.timeout_s)
        if reader.is_alive():
            raise Rejected(TIMEOUT)
        output = captured[0] if captured else b""
        if len(output) > limits.max_output_bytes:
            raise Rejected(FAILED)
        remaining = max(0.1, limits.timeout_s - (time.monotonic() - started))
        try:
            process.wait(remaining)
        except subprocess.TimeoutExpired as error:
            raise Rejected(TIMEOUT) from error
    finally:
        _kill(process)
        process.wait()
        reader.join(5)
        process.stdout.close()
    try:
        answer = json.loads(output.decode("utf-8").strip().splitlines()[-1])
    except (UnicodeDecodeError, ValueError, IndexError) as error:
        raise Rejected(FAILED) from error  # killed by a limit, or crashed before answering
    if not isinstance(answer, dict):
        raise Rejected(FAILED)
    return answer


def probe_in_sandbox(
    path: Path, limits: Limits = DEFAULT_LIMITS, *, command: Sequence[str] | None = None
) -> Probe:
    """The `Probe` for a staged upload, or `Rejected` with the reason."""
    path = Path(path)
    size, digest = file_sha256(path)
    if size == 0:
        raise Rejected(EMPTY)
    if size > limits.max_file_bytes:
        raise Rejected(TOO_LARGE)
    answer = run_child(path, limits, command)
    if not answer.get("ok"):
        code = answer.get("code")
        raise Rejected(code if code in MESSAGES else FAILED)
    try:
        return Probe(
            str(answer["format"]),
            float(answer["duration_s"]),
            int(answer["sample_rate"]),
            int(answer["channels"]),
            digest,
            size,
        )
    except (KeyError, TypeError, ValueError) as error:
        raise Rejected(FAILED) from error


__all__ = ["DEFAULT_LIMITS", "Limits", "Rejected", "probe_in_sandbox", "run_child"]
