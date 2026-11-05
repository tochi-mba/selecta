"""Copy independently readable rows to a new database without modifying the source."""

import sqlite3
from pathlib import Path

from selecta.db import connect


def recover(source: Path, destination: Path) -> dict[str, int]:
    if destination.exists():
        raise FileExistsError(destination)
    old = sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True)
    new = connect(destination)
    counts = {}
    try:
        new.execute("PRAGMA foreign_keys=OFF")
        for table in (
            "songs",
            "analysis",
            "lyrics",
            "preferences",
            "seam_book",
            "ratings",
            "queue",
        ):
            count = 0
            columns = [r[1] for r in old.execute(f'PRAGMA table_info("{table}")')]
            if not columns:
                continue
            available = {r[1] for r in new.execute(f'PRAGMA table_info("{table}")')}
            for column in columns:
                if column not in available:
                    new.execute(f'ALTER TABLE "{table}" ADD COLUMN "{column}"')
                    available.add(column)
            selected = [i for i, column in enumerate(columns) if column in available]
            names = ",".join('"' + columns[i] + '"' for i in selected)
            placeholders = ",".join("?" for _ in selected)
            statement = f'INSERT OR IGNORE INTO "{table}" ({names}) VALUES ({placeholders})'
            try:
                rows = old.execute(f'SELECT * FROM "{table}"').fetchall()
            except sqlite3.DatabaseError:
                rows = []
                for rowid in range(0, 10001):
                    try:
                        row = old.execute(
                            f'SELECT * FROM "{table}" WHERE rowid=?', (rowid,)
                        ).fetchone()
                        if row:
                            rows.append(row)
                    except sqlite3.DatabaseError:
                        continue
            for row in rows:
                new.execute(statement, tuple(row[i] for i in selected))
                count += 1
            counts[table] = count
        new.commit()
        if new.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("recovered database failed integrity check")
        new.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        return counts
    finally:
        old.close()
        new.close()
