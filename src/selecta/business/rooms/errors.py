"""Refusals guests and staff see from Rooms for Business, as `BusinessError`s with a status."""

from __future__ import annotations

from selecta.business.access import BusinessError


class Refused(BusinessError):
    """A refusal with its own HTTP status and plain words. `visitor` is a fresh visitor token
    a wrong code hands out (see `network`), for the route to set as a cookie."""

    def __init__(self, status: int, code: str, message: str, *,
                 retry_after_s: float | None = None, visitor: str | None = None) -> None:
        super().__init__(message, code=code)
        self.status = status
        self.message = message
        self.retry_after_s = retry_after_s
        self.visitor = visitor


def unavailable() -> Refused:
    from selecta.business.rooms.settings import TEXT_UNAVAILABLE

    return Refused(404, "requests_unavailable", TEXT_UNAVAILABLE)


__all__ = ["Refused", "unavailable"]
