"""In-process EnginePort adapter; remote control uses Agent 07's authenticated transport.

Useful for standalone installations and integration tests. Remote adapters must
provide the same physical-confirmation semantics and must never treat delivery,
heartbeats or a queued control command as applied.
"""

from __future__ import annotations

from collections.abc import Mapping

from .contracts import OutputObservation, Preflight, Scope, TransferRejected, TransferRequest
from .device import FencedLocalOutput


class LocalEngineRegistry:
    def __init__(self, engines: Mapping[str, FencedLocalOutput]) -> None:
        self.engines = dict(engines)

    def _get(self, device_id: str) -> FencedLocalOutput:
        try:
            return self.engines[device_id]
        except KeyError as exc:
            raise TransferRejected("engine_offline", "Target local engine is unavailable") from exc

    def observe(self, device_id: str, scope: Scope) -> OutputObservation:
        device = self.engines.get(device_id)
        return device.inspect(scope) if device else OutputObservation(False, None, None, None)

    def preflight(self, request: TransferRequest) -> Preflight:
        return self._get(request.target_device_id).preflight(request)

    def prepare_silent(self, request: TransferRequest, generation: int) -> str:
        return self._get(request.target_device_id).prepare_silent(request, generation)

    def stop_and_confirm(
        self, source_device_id: str, request: TransferRequest, generation: int
    ) -> bool:
        return self._get(source_device_id).stop_and_confirm(request, generation)

    def acquire_silent(
        self, request: TransferRequest, generation: int, prepared_token: str
    ) -> bool:
        return self._get(request.target_device_id).acquire_silent(
            request, generation, prepared_token
        )

    def start_and_confirm(self, request: TransferRequest, generation: int) -> bool:
        return self._get(request.target_device_id).start_and_confirm(request, generation)

    def manual_isolate(
        self, source_device_id: str, request: TransferRequest, generation: int, evidence_token: str
    ) -> bool:
        return self._get(source_device_id).manual_isolate(request, generation, evidence_token)
