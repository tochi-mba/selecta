"""S4-0095-10: a model-based check that writes stay in the scope they were made in.

Hypothesis drives random sequences of edits to the current mix and to several drafts (add, remove,
move, delete a draft, play a draft) and compares the real library after every step with a plain
Python model. The invariants: an edit to one scope never changes any other scope, playing a draft
swaps it in whole and keeps what was playing as a draft, and nothing is lost or duplicated.
"""

from __future__ import annotations

import json
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
    precondition,
    rule,
)

from selecta import db, mix
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.seams import SeamStore

SONGS = range(1, 9)


class ScopedWrites(RuleBasedStateMachine):
    drafts = Bundle("drafts")

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
        self.store = SeamStore(Settings(home))
        self.model: dict[int | None, list[int]] = {None: []}

    def teardown(self):
        conn = getattr(self, "conn", None)
        if conn is not None:
            conn.close()
            self.folder.cleanup()

    def _songs(self, scope):
        return [item["song_id"] for item in mix.read_mix(self.conn, self.store, scope)]

    @rule(target=drafts, songs=st.lists(st.sampled_from(list(SONGS)), max_size=4))
    def new_draft(self, songs):
        draft = mix.create_draft(self.conn)
        for song in songs:
            mix.add_song(self.conn, song, draft=draft)
        self.model[draft] = list(songs)
        return draft

    def _scope(self, data, drafts_alive):
        return data.draw(st.sampled_from([None, *drafts_alive]))

    @rule(data=st.data(), song=st.sampled_from(list(SONGS)), at=st.integers(-1, 6))
    def add(self, data, song, at):
        scope = self._scope(data, [d for d in self.model if d is not None])
        items = self.model[scope]
        position = None if at < 0 else at
        mix.add_song(self.conn, song, position, scope)
        items.insert(len(items) if position is None else max(0, min(position, len(items))), song)

    @rule(data=st.data(), at=st.integers(0, 6))
    def remove(self, data, at):
        scope = self._scope(data, [d for d in self.model if d is not None])
        mix.remove_at(self.conn, at, scope)
        if 0 <= at < len(self.model[scope]):
            self.model[scope].pop(at)

    @rule(data=st.data(), source=st.integers(0, 6), to=st.integers(0, 6))
    def move(self, data, source, to):
        scope = self._scope(data, [d for d in self.model if d is not None])
        items = self.model[scope]
        mix.move_song(self.conn, source, to, scope)
        if 0 <= source < len(items) and 0 <= to < len(items) and source != to:
            items.insert(to, items.pop(source))

    @rule(draft=consumes(drafts))
    def delete(self, draft):
        if draft not in self.model:
            return
        mix.delete_draft(self.conn, draft)
        del self.model[draft]

    @precondition(lambda self: any(d is not None for d in self.model))
    @rule(data=st.data())
    def play(self, data):
        draft = data.draw(st.sampled_from([d for d in self.model if d is not None]))
        before = list(self.model[None])
        others = {d: list(s) for d, s in self.model.items() if d not in (None, draft)}
        mix.play_draft(self.conn, draft)
        self.model[None] = self.model.pop(draft)
        # what was playing is kept as a draft, unless a draft already holds exactly those songs
        known = {d for d in self.model if d is not None}
        for row in mix.all_drafts(self.conn):
            if row["id"] not in known:
                self.model[row["id"]] = self._songs(row["id"])
                assert self.model[row["id"]] == before
        # no other draft changed
        for d, songs in others.items():
            assert self.model[d] == songs

    @invariant()
    def every_scope_matches_the_model(self):
        if not hasattr(self, "conn"):
            return
        assert self._songs(None) == self.model[None]
        listed = {row["id"] for row in mix.all_drafts(self.conn)}
        assert listed == {d for d in self.model if d is not None}
        for draft in listed:
            assert self._songs(draft) == self.model[draft], json.dumps(self.model, default=str)


ScopedWrites.TestCase.settings = settings(
    max_examples=40,
    stateful_step_count=25,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)
TestScopedWrites = ScopedWrites.TestCase
