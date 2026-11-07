"""Test that every collected test case belongs to exactly one CI shard."""

from sharding import in_shard


def test_shards_are_disjoint_and_exhaustive():
    cases = [
        f"tests/test_module_{number // 100}.py::test_scenario[{number % 100}]"
        for number in range(2000)
    ]
    for total in (2, 3, 4):
        groups = [
            [name for name in cases if in_shard(name, number, total)]
            for number in range(1, total + 1)
        ]
        assert sum(len(group) for group in groups) == len(cases)
        assert set().union(*(set(group) for group in groups)) == set(cases)
        assert all(groups)


def test_shard_is_stable_for_unicode_parameterizations():
    nodeid = "tests/test_a.py::test_b[param with spaces and 日本語]"
    assert sum(in_shard(nodeid, index, 3) for index in range(1, 4)) == 1
