"""Deterministic virtual network with delay, packet loss, partitions and reordering."""
from __future__ import annotations

import heapq
import itertools
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class VirtualClock:
    milliseconds: int = 0

    def advance(self, delta_ms: int) -> None:
        if delta_ms < 0:
            raise ValueError("virtual clock cannot run backward")
        self.milliseconds += delta_ms


@dataclass(order=True)
class Packet:
    deliver_at_ms: int
    ordering: int
    packet_id: int = field(compare=False)
    source: str = field(compare=False)
    destination: str = field(compare=False)
    payload: Any = field(compare=False)


class DeterministicNetwork:
    """All packet outcomes are determined by a virtual clock and explicit controls.

    Delivers only on advance()/flush_due(). No sockets, threads or real sleeps.
    A partition is directional; reordering only affects pending packets.
    """

    def __init__(self, clock: VirtualClock | None = None, *, latency_ms: int = 0) -> None:
        self.clock = clock or VirtualClock()
        self.latency_ms = latency_ms
        self.offline: set[str] = set()
        self.partitions: set[tuple[str, str]] = set()
        self.drop_next: set[int] = set()
        self._queue: list[Packet] = []
        self._ids = itertools.count(1)
        self.received: list[Packet] = []
        self.dropped: list[Packet] = []

    def send(self, source: str, destination: str, payload: Any, *, delay_ms: int | None = None) -> int:
        delay = self.latency_ms if delay_ms is None else delay_ms
        if delay < 0:
            raise ValueError("negative delay")
        packet_id = next(self._ids)
        heapq.heappush(self._queue, Packet(self.clock.milliseconds + delay, packet_id,
                                          packet_id, source, destination, payload))
        return packet_id

    def disconnect(self, name: str) -> None:
        self.offline.add(name)

    def reconnect(self, name: str) -> None:
        self.offline.discard(name)

    def partition(self, a: str, b: str, *, bidirectional: bool = True) -> None:
        self.partitions.add((a, b))
        if bidirectional:
            self.partitions.add((b, a))

    def heal(self, a: str, b: str) -> None:
        self.partitions.discard((a, b))
        self.partitions.discard((b, a))

    def drop_packet(self, packet_id: int) -> None:
        self.drop_next.add(packet_id)

    def reorder(self, packet_ids: list[int]) -> None:
        """Move selected packets ahead of peers at same virtual due time, reversed."""
        by_id = {p.packet_id: p for p in self._queue}
        if len(packet_ids) != len(set(packet_ids)) or any(n not in by_id for n in packet_ids):
            raise ValueError("unknown or duplicate packet ID")
        # Select explicit delivery order (not random or platform dependent).
        smallest = min(p.ordering for p in self._queue) - len(packet_ids) - 1
        for i, pid in enumerate(packet_ids):
            by_id[pid].ordering = smallest + i
        heapq.heapify(self._queue)

    def advance(self, ms: int, on_delivery: Callable[[Packet], None] | None = None) -> list[Packet]:
        self.clock.advance(ms)
        return self.flush_due(on_delivery)

    def flush_due(self, on_delivery: Callable[[Packet], None] | None = None) -> list[Packet]:
        delivered: list[Packet] = []
        while self._queue and self._queue[0].deliver_at_ms <= self.clock.milliseconds:
            packet = heapq.heappop(self._queue)
            if packet.packet_id in self.drop_next or packet.source in self.offline or (
                packet.destination in self.offline or (packet.source, packet.destination) in self.partitions
            ):
                self.dropped.append(packet)
                self.drop_next.discard(packet.packet_id)
                continue
            self.received.append(packet)
            delivered.append(packet)
            if on_delivery is not None:
                on_delivery(packet)
        return delivered

    @property
    def pending_count(self) -> int:
        return len(self._queue)
