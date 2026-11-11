"""EX-0114-04: every persisted browser key and every mutating API route has a row in the
preservation map, and every row in the map still exists in the code."""

from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP = ROOT / "docs" / "adr" / "selecta-experience-side-effect-map.md"
WEB = ROOT / "web" / "src"
API = ROOT / "src" / "selecta"

STORAGE_CALL = re.compile(
    r"(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*([^,)]+)"
)
STORE_CALL = re.compile(r"\bstore\(\s*([^,)]+)")
LITERAL = re.compile(r"""^['"`]([^'"`$]*)""")
DOTTED = re.compile(r"""['"`](selecta\.[A-Za-z0-9_.-]*)""")


def source_files() -> list[Path]:
    return [
        path
        for path in WEB.rglob("*")
        if path.suffix in {".ts", ".tsx"}
        and ".test." not in path.name
        and "test" not in path.relative_to(WEB).parts[:1]
    ]


def key_of(argument: str, text: str) -> str | None:
    """The static key or key prefix a storage call uses, or None when it is a plain variable."""
    argument = argument.strip()
    literal = LITERAL.match(argument)
    if literal:
        return literal.group(1)
    name = re.match(r"[A-Za-z_]\w*", argument)
    if not name:
        return None
    defined = re.search(
        rf"const {name.group(0)}\s*=\s*(?:\([^)]*\)\s*=>\s*)?(['\"`][^'\"`$]*)", text
    )
    return LITERAL.match(defined.group(1)).group(1) if defined else None


def code_keys() -> set[str]:
    keys: set[str] = set()
    for path in source_files():
        text = path.read_text(encoding="utf-8")
        calls = STORAGE_CALL.findall(text)
        if "rooms/dom" in text:
            calls += STORE_CALL.findall(text)
        for argument in calls:
            key = key_of(argument, text)
            if key:
                keys.add(key)
        # keys built from a variable (a study id, a conversation) still name their prefix
        keys.update(DOTTED.findall(text))
    return keys


def code_routes() -> set[str]:
    routes: set[str] = set()
    for path in API.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                if (
                    isinstance(decorator, ast.Call)
                    and isinstance(decorator.func, ast.Attribute)
                    and decorator.func.attr in {"post", "put", "patch", "delete"}
                    and decorator.args
                    and isinstance(decorator.args[0], ast.Constant)
                    and isinstance(decorator.args[0].value, str)
                ):
                    routes.add(f"{decorator.func.attr.upper()} {decorator.args[0].value}")
    return routes


def map_rows() -> tuple[set[str], set[str]]:
    keys: set[str] = set()
    routes: set[str] = set()
    for line in MAP.read_text(encoding="utf-8").splitlines():
        first = re.match(r"\| `([^`]+)` \|", line)
        if not first:
            continue
        cell = first.group(1)
        if re.match(r"(POST|PUT|PATCH|DELETE) /", cell):
            routes.add(cell)
        else:
            keys.add(cell.split("<", 1)[0])
    return keys, routes


def test_every_persisted_key_is_in_the_map_and_every_mapped_key_still_exists():
    in_code = code_keys()
    in_map, _ = map_rows()
    assert in_code, "no storage keys found; the scan is broken"
    assert sorted(in_code - in_map) == [], "persisted keys missing from the side-effect map"
    assert sorted(in_map - in_code) == [], "map rows for keys the site no longer uses"


def test_every_mutating_route_is_in_the_map_and_every_mapped_route_still_exists():
    in_code = code_routes()
    _, in_map = map_rows()
    assert len(in_code) > 100, "too few routes found; the scan is broken"
    assert sorted(in_code - in_map) == [], "mutating routes missing from the side-effect map"
    assert sorted(in_map - in_code) == [], "map rows for routes that no longer exist"


def test_the_scan_sees_a_new_key_and_a_new_route(tmp_path):
    """A guard against the guard: the parsers really do pick up what a change would add."""
    text = "const FRESH_KEY = 'selecta.fresh';\nlocalStorage.setItem(FRESH_KEY, '1');\n"
    assert key_of("FRESH_KEY", text) == "selecta.fresh"
    assert key_of("`selecta.thing.${id}`", "") == "selecta.thing."
    assert key_of("key", "") is None
    module = tmp_path / "fresh.py"
    module.write_text('@app.patch("/api/fresh/{x}")\ndef fresh(x):\n    pass\n', encoding="utf-8")
    tree = ast.parse(module.read_text(encoding="utf-8"))
    decorator = tree.body[0].decorator_list[0]
    assert decorator.func.attr == "patch" and decorator.args[0].value == "/api/fresh/{x}"
