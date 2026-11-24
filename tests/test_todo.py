"""The to-do list under docs/todo/items stays well formed (scripts/todo.py check)."""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_every_todo_item_is_well_formed() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "todo.py"), "check"],
        capture_output=True,
        text=True,
        cwd=ROOT,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
