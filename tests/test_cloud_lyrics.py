"""Cloud lyric lookup and display controls (ADR-0406)."""

from __future__ import annotations

import httpx

from selecta import flags
from selecta.flags import targeting
from selecta.flags.matching import Context, RuleSnapshot
from selecta.lyrics import lrclib


class Clock:
    def __init__(self) -> None:
        self.now = 0.0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


class Client:
    def __init__(self, clock: Clock) -> None:
        self.clock = clock
        self.called_at: list[float] = []

    def get(self, url: str, params: dict) -> httpx.Response:
        self.called_at.append(self.clock())
        request = httpx.Request("GET", url, params=params)
        return httpx.Response(
            200,
            request=request,
            json={"syncedLyrics": "[00:01.00]Hello", "duration": 180},
        )


def test_cloud_lookup_spacing_is_shared_by_different_users(monkeypatch):
    monkeypatch.setenv("SELECTA_MODE", "cloud")
    clock = Clock()
    original = lrclib.cloud_lookup_queue()
    lrclib.use_cloud_lookup_queue(lrclib.LookupQueue(2.0, clock=clock, sleep=clock.sleep))
    try:
        alice, bob = Client(clock), Client(clock)
        assert lrclib.LrcLib(alice).lookup("Alice", "First", None, 180)
        assert lrclib.LrcLib(bob).lookup("Bob", "Second", None, 180)
    finally:
        lrclib.use_cloud_lookup_queue(original)

    assert alice.called_at == [0.0]
    assert bob.called_at == [2.0]
    assert clock.slept == [2.0]


def test_local_lookup_instances_keep_the_existing_independent_behavior(monkeypatch):
    monkeypatch.setenv("SELECTA_MODE", "local")
    clock = Clock()
    queue = lrclib.LookupQueue(100.0, clock=clock, sleep=clock.sleep)
    original = lrclib.cloud_lookup_queue()
    lrclib.use_cloud_lookup_queue(queue)
    try:
        first, second = Client(clock), Client(clock)
        assert lrclib.LrcLib(first).lookup("One", "First", None, 180)
        assert lrclib.LrcLib(second).lookup("Two", "Second", None, 180)
    finally:
        lrclib.use_cloud_lookup_queue(original)

    assert first.called_at == second.called_at == [0.0]
    assert clock.slept == [], "local lookups never enter the Cloud-wide queue"


def decision(flag_id: str, mode: str, build: str = "") -> targeting.Decision:
    registry = flags.registry()
    return targeting.decide(
        flag_id,
        Context(mode=mode, workspace_id="workspace", user_id="user"),
        build_states=flags.resolve(build),
        rules=RuleSnapshot(),
        entitled=registry,
        plan_gated=(),
        registry=registry,
    )


def test_lyric_display_defaults_off_in_cloud_but_lookup_and_local_display_stay_on():
    assert decision("lyrics.lookup", "cloud").on, "internal lookup remains independently gated"
    assert decision("lyrics.display", "cloud") == targeting.Decision(
        False, targeting.Layer.MODE, targeting.MODE_OFF
    )
    assert not decision("listen.lyrics", "cloud").on
    assert not decision("listen.stage", "cloud").on
    assert not decision("discover.word_links", "cloud").on

    assert decision("lyrics.display", "local").on
    assert decision("listen.lyrics", "local").on
    assert decision("listen.stage", "local").on
    assert decision("discover.word_links", "local").on


def test_an_explicit_cloud_flag_enables_licensed_lyric_display():
    assert decision("lyrics.display", "cloud", "+lyrics.display").on
    assert decision("listen.lyrics", "cloud", "+lyrics.display").on
    assert decision("listen.stage", "cloud", "+lyrics.display").on
    assert decision("discover.word_links", "cloud", "+lyrics.display").on
