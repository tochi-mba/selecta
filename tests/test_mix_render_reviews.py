"""The listening notice follows accepted changes to the same saved arrangement."""

from selecta.engine_store.mix_render_reviews import record_accepted, review, revision


class SavedMixes:
    def __init__(self):
        self.values = {}

    def preference(self, key, default):
        return self.values.get(key, default)

    def set_preference(self, key, value):
        self.values[key] = value


def test_review_requires_different_accepted_clip_in_same_revision_and_scope():
    mixes = SavedMixes()
    items = [{"song_id": 1}, {"song_id": 2}, {"song_id": 3}]
    changed = [*items[:2], {"song_id": 4}]
    first = "a" * 64
    second = "b" * 64

    def accept(digest, draft=None, position=1, expected=None):
        return record_accepted(
            mixes, draft, items, expected_revision=expected or revision(items),
            position=position, verified_digest=digest,
        )

    assert accept(first)
    assert accept(first)
    assert review(mixes, None, items) is None
    assert not accept(second, expected=revision(changed))
    assert not accept(second, position=0)
    assert not accept("unverified")
    assert review(mixes, None, items) is None

    assert accept(second, draft=8)
    assert review(mixes, 8, items) is None
    assert accept(second)
    assert review(mixes, None, items) == {"transitions": [1]}
    assert review(mixes, None, changed) is None
    assert review(mixes, 8, items) is None
    assert review(SavedMixes(), None, items) is None
