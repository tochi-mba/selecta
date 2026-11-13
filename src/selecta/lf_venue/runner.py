"""Supervised device-side driver. Inject the local audio port from Agents 01/08.

No thread or network side effects on import. The host service owns stopping,
error reporting, callback registration and OS audio device lifetimes.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from .engine import VenueEngine
from .model import Diagnosis, VenueError


class StopFlag(Protocol):
    def is_set(self) -> bool: ...


class VenueRunner:
    def __init__(self, engine: VenueEngine, workspace: str, venue: str, zone: str):
        self.engine, self.workspace, self.venue, self.zone = engine, workspace, venue, zone
        self._booted = False

    def step(self) -> Diagnosis:
        venue, zone, session = self.engine._get(self.workspace, self.venue, self.zone)
        # Power recovery is a one-time *local* boot operation: never an online lease retry.
        if not self._booted:
            self._booted = True
            if session['state'] == 'playing' and not self.engine.audio.probe(zone).active:
                self.engine.recover(self.workspace, self.venue, self.zone)
        session = self.engine.store.session(self.workspace, self.venue, self.zone)
        if (session['state'] == 'stopped' and session['reason'] is None
                and venue.open_at(self.engine.clock()) and session['committed']):
            self.engine.prepare(self.workspace, self.venue, self.zone)
            self.engine.start(self.workspace, self.venue, self.zone)
        else:
            # Continue replenishing the committed/prepared musical horizon offline.
            if session['state'] == 'playing' and len(session['prepared']) < 8:
                self.engine.prepare(self.workspace, self.venue, self.zone)
        return self.engine.tick(self.workspace, self.venue, self.zone)

    def run(self, stopped: StopFlag, sleep: Callable[[float], None],
            on_health: Callable[[Diagnosis], None], *, interval_s: float = 1.0) -> None:
        """Run synchronously in the local service; fails closed on unexpected errors."""
        if not 0.1 <= interval_s <= 60:
            raise ValueError('Invalid venue runner polling interval')
        while not stopped.is_set():
            health = self.step()
            on_health(health)
            sleep(interval_s)
