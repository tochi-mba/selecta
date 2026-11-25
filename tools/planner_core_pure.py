#!/usr/bin/env python3
"""Check that the planner core imports nothing that touches audio, files or a database.

Run with ``python tools/planner_core_pure.py``; it exits 1 and names each offender. Three checks:

1. Every import statement under ``src/selecta/planner_core`` names an allowed module: the standard
   library (not sqlite3), numpy, the few pure ``selecta`` modules below, or another planner_core
   module. Read from the source, so an import that something else already loaded can't hide.
2. A fresh Python imports every planner_core module with ``selecta.analysis.song`` stood in by a
   stub, and no forbidden module may be loaded afterwards, nor any data file read on the way.
3. The same with the real ``selecta.analysis.song``: anything forbidden that is loaded must be
   loaded by importing that module on its own too.

The stub in 2 and the comparison in 3 are the one allowance. ``selecta.analysis.song`` holds the
song facts (``SongInfo``, ``Cue``) but still imports the analysis pipeline, sqlite3 and the lyric
client at module level, and the song-storage slice is removing those imports.
"""

from __future__ import annotations

import ast
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
CORE = SRC / "selecta" / "planner_core"
CORE_NAME = "selecta.planner_core"
ALLOWANCE = "selecta.analysis.song"
ALLOWED_SELECTA = {
    "selecta",
    "selecta.flags",
    "selecta.analysis.song",
    "selecta.analysis.key",
    "selecta.render.script",
    "selecta.render.sources",
}
ALLOWED_OUTSIDE = {"numpy"}
FORBIDDEN = (
    "sqlite3",
    "_sqlite3",
    "soundfile",
    "librosa",
    "soxr",
    "scipy.signal",
    "torch",
    "torchaudio",
    "demucs",
    "httpx",
    "sqlalchemy",
    "selecta.db",
    "selecta.stems",
    "selecta.render.engine",
    "selecta.render.dsp",
    "selecta.render.intertwine",
    "selecta.render.stem_seam",
    "selecta.audit.checks",
    "selecta.arrange",
    "selecta.studio",
    "selecta.analysis.vocal_sense",
    "selecta.analysis.pipeline",
    "selecta.analysis.beats",
    "selecta.analysis.features",
    "selecta.lyrics.lrclib",
    "selecta.lyrics.align",
    "selecta.planner",
)
TIMEOUT_SECONDS = 60

# Runs in a fresh interpreter: import the named modules (or every planner_core module), noting
# any file opened that isn't Python itself, and print what ended up loaded.
_CHILD = r"""
import builtins, importlib, io, json, pkgutil, sys, types
sys.path.insert(0, SRC)
opened = []
real_open = io.open
def spy(file, *args, **kwargs):
    opened.append(str(file))
    return real_open(file, *args, **kwargs)
builtins.open = io.open = spy
if STUB:
    import selecta.analysis
    stub = types.ModuleType("selecta.analysis.song")
    class Cue: pass
    class SongInfo: pass
    stub.Cue, stub.SongInfo = Cue, SongInfo
    sys.modules["selecta.analysis.song"] = selecta.analysis.song = stub
names = ONLY
if names is None:
    core = importlib.import_module("selecta.planner_core")
    names = ["selecta.planner_core"] + [
        found.name for found in pkgutil.walk_packages(core.__path__, "selecta.planner_core.")
    ]
for name in names:
    importlib.import_module(name)
print(json.dumps({"imported": names, "loaded": sorted(sys.modules), "opened": opened}))
"""


def forbidden(name: str) -> bool:
    return any(name == bad or name.startswith(bad + ".") for bad in FORBIDDEN)


def _allowed(name: str) -> bool:
    top = name.split(".")[0]
    if top == "selecta":
        return name in ALLOWED_SELECTA or name == CORE_NAME or name.startswith(CORE_NAME + ".")
    if top in ALLOWED_OUTSIDE:
        return True
    return top in sys.stdlib_module_names and top not in {"sqlite3", "_sqlite3"}


def _type_checking_only(tree: ast.AST) -> set[int]:
    """Imports under `if TYPE_CHECKING:` only feed annotations, which are never evaluated."""
    skipped: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.If):
            continue
        test = node.test
        name = test.id if isinstance(test, ast.Name) else getattr(test, "attr", None)
        if name == "TYPE_CHECKING":
            skipped.update(id(inner) for part in node.body for inner in ast.walk(part))
    return skipped


def static_offenders() -> list[str]:
    found = []
    for path in sorted(CORE.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), str(path))
        skipped = _type_checking_only(tree)
        where = path.relative_to(ROOT).as_posix()
        for node in ast.walk(tree):
            if id(node) in skipped:
                continue
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    names = [CORE_NAME]
                elif node.module == "selecta":
                    names = [f"selecta.{alias.name}" for alias in node.names]
                else:
                    names = [node.module or ""]
            else:
                continue
            found += [f"{where}:{node.lineno} imports {n}" for n in names if not _allowed(n)]
    return found


def _child(stub: bool, only: list[str] | None = None) -> dict:
    code = f"SRC = {str(SRC)!r}\nSTUB = {stub!r}\nONLY = {only!r}\n" + _CHILD
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SECONDS,
        cwd=str(ROOT),
    )
    if result.returncode != 0:
        raise RuntimeError(f"importing the planner core failed:\n{result.stderr.strip()}")
    return json.loads(result.stdout.strip().splitlines()[-1])


def _data_files(opened: list[str]) -> list[str]:
    return [path for path in opened if not path.endswith((".py", ".pyc", ".pth"))]


def check() -> tuple[list[str], list[str]]:
    """The offenders, and notes on what the one allowance still pulls in."""
    offenders = static_offenders()
    stubbed = _child(stub=True)
    offenders += [
        f"importing the planner core loads {name}"
        for name in stubbed["loaded"]
        if forbidden(name)
    ]
    offenders += [
        f"importing the planner core reads {path}" for path in _data_files(stubbed["opened"])
    ]
    real = _child(stub=False)
    song_alone = set(_child(stub=False, only=[ALLOWANCE])["loaded"])
    offenders += [
        f"importing the planner core loads {name}, which {ALLOWANCE} alone does not"
        for name in real["loaded"]
        if forbidden(name) and name not in song_alone
    ]
    notes = sorted(name for name in song_alone if name in FORBIDDEN)
    return offenders, notes


def main() -> int:
    offenders, notes = check()
    modules = len(list(CORE.rglob("*.py")))
    if offenders:
        print(f"planner core is not pure ({len(offenders)} problems):")
        for line in offenders:
            print(f"  {line}")
        return 1
    print(f"planner core is pure: {modules} modules checked, no forbidden imports, no files read.")
    if notes:
        print(f"Allowed only through {ALLOWANCE}, until the song-storage slice removes them:")
        print(f"  {', '.join(notes)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
