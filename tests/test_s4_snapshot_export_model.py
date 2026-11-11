"""S4-0095-10: a model-based check that a saved export is the snapshot it was started from.

Hypothesis interleaves freezing a mix (the songs and transition keys an export job keeps), random
edits to the current mix and to drafts, transitions finishing, and exporting a frozen snapshot.
The invariants: an export joins exactly the frozen songs and transitions whatever the mix has
become since, it refuses (and writes nothing) while any frozen transition is unfinished, it never
substitutes another transition, and exporting never changes any mix.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from hypothesis import HealthCheck, settings
from hypothesis import strategies as st
from hypothesis.stateful import (
    Bundle,
    RuleBasedStateMachine,
    consumes,
    initialize,
    invariant,
    rule,
)

from selecta import db, mix
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.seams import SeamStore

SONGS = range(1, 7)


class SnapshotExport(RuleBasedStateMachine):
    frozen = Bundle("frozen")

    @initialize()
    def library(self):
        self.folder = tempfile.TemporaryDirectory()
        home = Path(self.folder.name)
        self.conn = db.connect(home / "selecta.sqlite")
        for song_id in SONGS:
            self.conn.execute(
                "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
                "VALUES(?,?,?,?,?,?,?,?,1)",
                (song_id, f"{song_id}.flac", "f", 1, 1.0, 200.0, f"A{song_id}", f"S{song_id}"),
            )
            self.conn.execute(
                "INSERT INTO analysis(song_id,version,bpm,camelot) VALUES(?,?,?,?)",
                (song_id, ANALYSIS_VERSION, 120.0, "8A"),
            )
        self.conn.commit()
        self.settings = Settings(home)
        self.store = SeamStore(self.settings)
        self.ready: set[str] = set()
        self.written: list[tuple[list[int], list[str]]] = []
        self.store.status = lambda key: {
            "status": "ready" if key in self.ready else "none",
            "key": key,
        }
        self._real_join = mix._join_to_file
        mix._join_to_file = self._fake_join
        self.draft = mix.create_draft(self.conn)
        for song in (1, 2, 3):
            mix.add_song(self.conn, song)
        for song in (4, 5):
            mix.add_song(self.conn, song, draft=self.draft)

    def _fake_join(self, _conn, _settings, _store, _destination, songs, states):
        self.written.append((list(songs), [state["key"] for state in states]))
        return {"seconds": 1.0, "name": "frozen.flac"}

    def teardown(self):
        if hasattr(self, "_real_join"):
            mix._join_to_file = self._real_join
        conn = getattr(self, "conn", None)
        if conn is not None:
            conn.close()
            self.folder.cleanup()

    def _scope(self, data):
        return data.draw(st.sampled_from([None, self.draft]))

    def _everything(self):
        return {
            scope: [
                (item["song_id"], (item.get("seam") or {}).get("state", {}).get("key"))
                for item in mix.read_mix(self.conn, self.store, scope)
            ]
            for scope in (None, self.draft)
        }

    @rule(target=frozen, data=st.data())
    def freeze(self, data):
        """What an export job keeps when it starts: the song order and each transition's key."""
        scope = self._scope(data)
        items = mix.read_mix(self.conn, self.store, scope)
        return (
            [item["song_id"] for item in items],
            [item["seam"]["state"]["key"] for item in items[1:]],
        )

    @rule(data=st.data(), song=st.sampled_from(list(SONGS)))
    def add(self, data, song):
        mix.add_song(self.conn, song, None, self._scope(data))

    @rule(data=st.data(), at=st.integers(0, 5))
    def remove(self, data, at):
        mix.remove_at(self.conn, at, self._scope(data))

    @rule(data=st.data(), source=st.integers(0, 5), to=st.integers(0, 5))
    def move(self, data, source, to):
        mix.move_song(self.conn, source, to, self._scope(data))

    @rule(snapshot=frozen, data=st.data())
    def a_transition_finishes(self, snapshot, data):
        _songs, keys = snapshot
        if keys:
            self.ready.add(data.draw(st.sampled_from(keys)))

    @rule(snapshot=consumes(frozen))
    def export(self, snapshot):
        songs, keys = snapshot
        before = self._everything()
        written = len(self.written)
        try:
            mix.export_snapshot(
                self.conn, self.settings, self.store, Path("unused.flac"), songs, keys
            )
        except ValueError:
            # refused: too short, or a frozen transition is unfinished; nothing was written
            assert len(songs) < 2 or any(key not in self.ready for key in keys)
            assert len(self.written) == written
        else:
            assert len(songs) >= 2 and all(key in self.ready for key in keys)
            # exactly the frozen songs and transitions, whatever the live mix is now
            assert self.written[-1] == (songs, keys)
        # exporting is read-only for every mix
        assert self._everything() == before

    @invariant()
    def nothing_unfrozen_is_ever_written(self):
        for songs, keys in getattr(self, "written", []):
            assert len(keys) == len(songs) - 1
            assert all(key in self.ready for key in keys)


SnapshotExport.TestCase.settings = settings(
    max_examples=40,
    stateful_step_count=25,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)
TestSnapshotExport = SnapshotExport.TestCase
