"""Isolated simulated agents, controllers, local media and catalogues.

Use for constructing inputs to production adapters, NOT as production evidence.
"""
from __future__ import annotations

import json
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from .audio import AudioFixture, make_synthetic_wave


@dataclass
class Device:
    device_id: str
    workspace_id: str
    kind: Literal["engine", "controller"]
    root: Path
    catalogue: dict[str, AudioFixture] = field(default_factory=dict)
    output_id: str | None = None
    online: bool = True
    running: bool = True
    drive_connected: bool = True
    output_connected: bool = True
    heartbeat_ms: int = 0
    generation: int = 0
    power_restored: bool = False

    @property
    def source_dir(self) -> Path:
        return self.root / "sources"

    @property
    def output_dir(self) -> Path:
        return self.root / "outputs"

    def inventory(self) -> frozenset[str]:
        return frozenset(self.catalogue) if self.kind == "engine" and self.drive_connected else frozenset()

    def availability(self, recording_ids: list[str], *, now_ms: int, max_age_ms: int = 60_000) -> dict:
        if self.kind != "engine":
            state = "unsupported"
        elif not self.running or not self.online or now_ms - self.heartbeat_ms > max_age_ms:
            state = "unknown"
        elif not self.drive_connected:
            state = "source_disconnected"
        else:
            state = "connected"
        tracks = [
            {"occurrence_id": f"occ-{i + 1}", "state": (
                "ready" if state == "connected" and track in self.catalogue else
                "missing" if state == "connected" else state
            )}
            for i, track in enumerate(recording_ids)
        ]
        return {
            "target_device_id": self.device_id,
            "recipe_revision": "rev-synthetic-1",
            "status": "ready" if all(x["state"] == "ready" for x in tracks) else "needs_attention",
            "last_verified_at": self.heartbeat_ms,
            "tracks": tracks,
            "transition_states": [],
        }


class Fleet:
    """A temporary, permission-separated fleet; cleanup is deterministic."""

    def __init__(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="selecta-lf19-")
        self.root = Path(self._tmp.name)
        self.devices: dict[str, Device] = {}
        self.recipe_ids = [f"recording-{n:02d}" for n in range(1, 9)]

    def __enter__(self) -> "Fleet":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def close(self) -> None:
        self._tmp.cleanup()

    def add_device(self, device_id: str, workspace_id: str, kind: Literal["engine", "controller"],
                   *, recording_numbers: tuple[int, ...] = (), output_id: str | None = None) -> Device:
        if device_id in self.devices or any(d.root == self.root / device_id for d in self.devices.values()):
            raise ValueError("duplicate device identity")
        if not device_id.isascii() or not device_id.replace("-", "").isalnum():
            raise ValueError("unsafe device identity")
        if kind == "controller" and (recording_numbers or output_id):
            raise ValueError("controllers cannot own media or a speaker")
        root = self.root / device_id
        root.mkdir(mode=0o700)
        (root / "identities").mkdir()
        (root / "outputs").mkdir()
        (root / "sources").mkdir()
        (root / "identities" / "identity.json").write_text(json.dumps({
            "device_id": device_id, "workspace_id": workspace_id, "kind": kind,
        }), encoding="utf-8")
        catalogue = {
            f"recording-{n:02d}": make_synthetic_wave(root / "sources" / f"local-{n:02d}.wav", recording_number=n)
            for n in recording_numbers
        }
        (root / "catalogue.json").write_text(json.dumps({
            "local_bindings": {track: f"sources/local-{n:02d}.wav"
                               for n, track in [(int(k.rsplit('-', 1)[1]), k) for k in catalogue]}
        }), encoding="utf-8")
        device = Device(device_id, workspace_id, kind, root, catalogue, output_id)
        self.devices[device_id] = device
        return device

    def command_for(self, device_id: str, *, actor_workspace: str, generation: int,
                    operation_id: str = "op-harness-1", expires_at: int = 10_000) -> dict:
        device = self.devices[device_id]
        return {
            "schema_version": 1, "operation_id": operation_id,
            "idempotency_key": operation_id, "workspace_id": actor_workspace,
            "actor_id": "controller-harness", "zone_id": "zone-main",
            "target_device_id": device.device_id, "expected_generation": generation,
            "expected_recipe_revision": "rev-synthetic-1", "command": "skip",
            "arguments": {}, "created_at": 1, "expires_at": expires_at,
        }


def make_five_of_eight_fleet() -> Fleet:
    """Exactly 5/8 on engine A, all eight on engine B; two controllers.

    Caller owns context and MUST close Fleet (prefer `with make_five_of_eight_fleet()`).
    """
    fleet = Fleet()
    fleet.add_device("engine-a", "workspace-a", "engine", recording_numbers=(1, 2, 3, 4, 5), output_id="speaker-a")
    fleet.add_device("engine-b", "workspace-a", "engine", recording_numbers=(1, 2, 3, 4, 5, 6, 7, 8), output_id="speaker-b")
    fleet.add_device("controller-phone", "workspace-a", "controller")
    fleet.add_device("controller-browser", "workspace-a", "controller")
    fleet.add_device("engine-foreign", "workspace-b", "engine", recording_numbers=(1, 2), output_id="speaker-c")
    return fleet
