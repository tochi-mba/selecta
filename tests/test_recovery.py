import sqlite3

import pytest

from selecta.db import connect
from selecta.recovery import recover


def test_recovery_preserves_extra_columns_and_refuses_overwrite(tmp_path):
    source = tmp_path / "source.sqlite"
    destination = tmp_path / "recovered.sqlite"
    with connect(source) as conn:
        conn.execute("ALTER TABLE queue ADD COLUMN seam TEXT")
        conn.execute("INSERT INTO preferences(key,value) VALUES ('test','123')")
        conn.commit()
    recover(source, destination)
    with sqlite3.connect(destination) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert conn.execute("SELECT value FROM preferences").fetchone()[0] == "123"
        assert "seam" in {row[1] for row in conn.execute("PRAGMA table_info(queue)")}
    with pytest.raises(FileExistsError):
        recover(source, destination)
