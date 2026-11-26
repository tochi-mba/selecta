"""Lucy's event replay (`events.since`) reads through the store with `core.engine_store` on.

The flag-on sweep found it still read the caller's raw connection: right answers, but the one
Lucy read left off the store. With the flag on it now reads `lucy_conversations` and
`lucy_events` through the store and answers exactly as the old path does, gap and all.
Temporary home and made-up text only.
"""

from __future__ import annotations

import pytest

from selecta import db, flags
from selecta.config import Settings
from selecta.engine_store import library
from selecta.lucy import backing, conversations, events
from selecta.lucy import schema as lucy_schema


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_HOME", str(tmp_path / "home"))
    settings = Settings(tmp_path / "home")
    settings.home.mkdir(parents=True)
    yield settings
    flags.use(None)
    library.forget(settings.db_path)


def test_since_reads_through_the_store_and_answers_as_the_old_path(home, monkeypatch):
    flags.use("+core.engine_store")
    conn = lucy_schema.ensure(db.connect(home.db_path))
    chat = conversations.create(conn, "Made up")["id"]
    for n in range(5):
        events.append(conn, chat, "run.state", {"n": n})
    events.prune(conn, chat, keep=3)
    conn.commit()

    reads = []
    real = backing.reading
    monkeypatch.setattr(backing, "reading", lambda store: reads.append(1) or real(store))
    on = [events.since(conn, chat, after) for after in (0, 2, 4, 99)]
    missing = events.since(conn, "cv_nothing", 0)
    assert reads, "the store was not read"

    flags.use("")
    assert backing.store_of(conn) is None
    off = [events.since(conn, chat, after) for after in (0, 2, 4, 99)]
    assert on == off
    assert missing == events.since(conn, "cv_nothing", 0)
    conn.close()
