"""Guard: nothing is shared across tenants by fingerprint except machine derivations (ADR-0469).

The rule: data may be shared across tenants by fingerprint ONLY when it is a deterministic
machine derivation of the bytes (analysis, waveform, beat grid), NEVER user-entered or usage
data (titles, ratings, play history), and a tenant may only read a shared row for a sha it has
itself proven it holds, by bytes the server hashed itself.

Every table with a content-hash column and no workspace_id is a cross-tenant table. Each one
must be named below, its declaring module must state the possession-proof rule beside it, and
it may carry no user-entered column.
"""

from __future__ import annotations

import importlib
import inspect
import re
from pathlib import Path

import sqlalchemy as sa

from selecta.persistence import metadata
from selecta.persistence.registry import TABLE_MODULES, load_all_tables

ROOT = Path(__file__).resolve().parents[1]
HASH_COLUMN = re.compile(r"(^|_)(sha256|sha|content_hash|fingerprint|checksum|input_hash)($|_)")
USER_ENTERED = {"title", "artist", "album", "rating", "name", "label", "note", "notes", "comment"}

# Cross-tenant tables keyed by content, and the module that declares each.
SHARED_BY_FINGERPRINT: dict[str, str] = {
    "shared_derivations": "selecta.storage.schema",
}


def _hash_tables_without_workspace() -> dict[str, sa.Table]:
    load_all_tables()
    return {
        name: table
        for name, table in metadata.tables.items()
        if "workspace_id" not in table.c and any(HASH_COLUMN.search(c.name) for c in table.c)
    }


def test_every_cross_tenant_hash_table_is_allowlisted():
    found = sorted(_hash_tables_without_workspace())
    assert found == sorted(SHARED_BY_FINGERPRINT), (
        f"a content-keyed table without workspace_id must be a vetted shared derivation: {found}"
    )


def test_allowlisted_tables_carry_no_user_entered_columns():
    tables = _hash_tables_without_workspace()
    for name in SHARED_BY_FINGERPRINT:
        columns = {column.name.lower() for column in tables[name].c}
        assert not columns & USER_ENTERED, f"{name} holds user-entered data"


def test_each_allowlisted_table_states_the_possession_rule_beside_it():
    for name, module_name in SHARED_BY_FINGERPRINT.items():
        source = inspect.getsource(importlib.import_module(module_name))
        at = source.index(f'"{name}"')
        comment = re.sub(r"\s*#\s*|\s+", " ", source[max(0, at - 1500) : at])
        assert "Possession-proof rule" in comment, f"{name} needs the possession-proof comment"
        assert "never anything a person typed" in comment


def test_every_module_declaring_a_hash_table_is_registered():
    """A table module outside the registry would escape the checks above."""
    unregistered = []
    for path in (ROOT / "src" / "selecta").rglob("*.py"):
        if "migrations" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        if "sa.Table(" not in text or not re.search(r'Column\(\s*"[a-z_]*sha256', text):
            continue
        module = ".".join(path.relative_to(ROOT / "src").with_suffix("").parts)
        if module not in TABLE_MODULES:
            unregistered.append(module)
    assert unregistered == []
