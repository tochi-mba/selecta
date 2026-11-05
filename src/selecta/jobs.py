"""Background work stays polite: playback comes first, then the mix, then everything else."""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import TextIO

import psutil

_LOW = getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)
_LOWEST = getattr(subprocess, "IDLE_PRIORITY_CLASS", 0)
MIX_RENDERING_SIGN = "rendering-mix"
MIX_SIGN_LASTS_SECONDS = 120.0
MIX_SIGN_CHECK_SECONDS = 3.0
MIX_SIGN_RENEW_SECONDS = 30.0


class Interrupted(BaseException):
    """Something more important needs the machine, so this work gave way. It isn't an error, and
    it's a BaseException so that no `except Exception` along the way can swallow it."""


def _nothing_waiting() -> bool:
    return False


_should_give_way: Callable[[], bool] = _nothing_waiting


def give_way_when(check: Callable[[], bool]) -> None:
    global _should_give_way
    _should_give_way = check


def check_in() -> None:
    """Long work calls this between steps, so it can stop when something matters more."""
    if _should_give_way():
        raise Interrupted


def lower_priority() -> None:
    """Below everything a person is doing, but ahead of work nobody is waiting on."""
    process = psutil.Process()
    if sys.platform == "win32":
        process.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
    else:
        process.nice(10)


def lowest_priority() -> None:
    """Only takes what nothing else wants, so the mix always gets the machine first."""
    process = psutil.Process()
    if sys.platform == "win32":
        process.nice(psutil.IDLE_PRIORITY_CLASS)
    else:
        process.nice(19)


def set_render_priority(important: bool) -> None:
    """The worker moves between the two as its work changes. A Unix process can only go down,
    so there it stays at the higher of them."""
    if sys.platform != "win32":
        if psutil.Process().nice() < 10:
            lower_priority()
        return
    if important:
        lower_priority()
    else:
        lowest_priority()


def child_priority() -> int:
    """Flags that start a helper at this process's priority, and never above the low one."""
    if sys.platform != "win32":
        return 0
    return _LOWEST if psutil.Process().nice() == psutil.IDLE_PRIORITY_CLASS else _LOW


def kill_tree(pid: int) -> None:
    """A virtual environment's python.exe is a launcher, so the real work is in its children."""
    try:
        parent = psutil.Process(pid)
        for process in [*parent.children(recursive=True), parent]:
            process.kill()
    except psutil.NoSuchProcess:
        pass


def mark_mix_rendering(home: Path, rendering: bool) -> None:
    """Low priority alone isn't enough: Demucs leaves hyperthreads free, and analysis running on
    them slows it down. So the worker keeps this sign up while it works on the mix."""
    sign = home / MIX_RENDERING_SIGN
    if rendering:
        sign.touch()
    else:
        sign.unlink(missing_ok=True)


def mix_is_rendering(home: Path) -> bool:
    """A sign nobody has renewed was left by a worker that stopped, so it doesn't count."""
    try:
        return time.time() - (home / MIX_RENDERING_SIGN).stat().st_mtime < MIX_SIGN_LASTS_SECONDS
    except OSError:
        return False


def wait_while_mix_renders(home: Path) -> None:
    while mix_is_rendering(home):
        time.sleep(MIX_SIGN_CHECK_SECONDS)


def take_app_input() -> TextIO:
    """Keep the app's pipe to ourselves, and leave this process's standard input empty.

    On Windows, while one thread waits on a pipe, anything else that touches that pipe waits too.
    A helper inherits its parent's input and looks at it while starting, so ffmpeg and Demucs would
    freeze until the app next happened to send a message. A private copy isn't inherited.
    """
    private = os.dup(0)
    nothing = os.open(os.devnull, os.O_RDONLY)
    os.dup2(nothing, 0)
    os.close(nothing)
    return os.fdopen(private, "r", encoding="utf-8")


def stop_when_app_stops() -> None:
    """The app holds this process's input open, so the input closing means the app has gone."""
    app_input = take_app_input()

    def wait() -> None:
        app_input.read()
        kill_tree_of_children()
        os._exit(0)

    threading.Thread(target=wait, daemon=True).start()


def kill_tree_of_children() -> None:
    for child in psutil.Process().children():
        kill_tree(child.pid)
