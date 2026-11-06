"""Windows desktop shortcut and browser app-window launcher."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

URL = "http://127.0.0.1:8733/"


def edge_path() -> Path | None:
    for variable in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        folder = os.environ.get(variable)
        if folder:
            path = Path(folder) / "Microsoft/Edge/Application/msedge.exe"
            if path.is_file():
                return path
    return None


def install_shortcut() -> dict:
    if sys.platform != "win32":
        raise ValueError("The desktop shortcut is currently available on Windows")
    python = Path(sys.executable).with_name("pythonw.exe")
    if not python.exists():
        python = Path(sys.executable)
    script = """
$desktop = [Environment]::GetFolderPath('Desktop')
$path = Join-Path $desktop 'Selecta.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($path)
$shortcut.TargetPath = $env:SELECTA_LAUNCH_PYTHON
$shortcut.Arguments = '-m selecta.desktop'
$shortcut.WorkingDirectory = $env:SELECTA_LAUNCH_DIRECTORY
$shortcut.Description = 'Open Selecta'
$shortcut.WindowStyle = 7
if ($env:SELECTA_LAUNCH_ICON) { $shortcut.IconLocation = $env:SELECTA_LAUNCH_ICON }
$shortcut.Save()
Write-Output $path
"""
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True,
        text=True,
        check=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
        env={
            **os.environ,
            "SELECTA_LAUNCH_PYTHON": str(python),
            "SELECTA_LAUNCH_DIRECTORY": str(Path(__file__).parents[2]),
            "SELECTA_LAUNCH_ICON": str(edge_path() or ""),
        },
    )
    return {"installed": True, "path": result.stdout.strip()}


def server_ready() -> bool:
    try:
        with urllib.request.urlopen(URL + "api/status", timeout=2) as response:
            data = json.load(response)
        return "counts" in data and "queue" in data
    except (OSError, ValueError, urllib.error.URLError):
        return False


def launch() -> None:
    from selecta.config import load_settings

    if not server_ready():
        settings = load_settings()
        settings.home.mkdir(parents=True, exist_ok=True)
        with (settings.home / "desktop-server.log").open("a", encoding="utf-8") as log:
            subprocess.Popen(
                [sys.executable, "-m", "selecta.cli", "web", "--no-open", "--port", "8733"],
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
        deadline = time.monotonic() + 60
        while not server_ready():
            if time.monotonic() >= deadline:
                raise RuntimeError("Selecta did not start; see desktop-server.log")
            time.sleep(0.5)
    edge = edge_path()
    if edge:
        subprocess.Popen([str(edge), f"--app={URL}"])
    else:
        webbrowser.open(URL)


if __name__ == "__main__":
    launch()
