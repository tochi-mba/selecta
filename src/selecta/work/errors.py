"""What can go wrong when talking to the job store, as exceptions a caller can act on."""

from __future__ import annotations


class StaleLease(Exception):
    """The attempt no longer holds the job: its lease ran out, or a newer attempt took over.

    The gateway answers `409 stale lease`. The worker stops; anything it wrote under its own
    attempt prefix is collected as garbage later.
    """


class JobCancelled(StaleLease):
    """The job was cancelled while the attempt worked, so its results are not published."""


class CompletionRejected(Exception):
    """The results couldn't be accepted (missing output, bad checksum, an applier refused them).

    The job has already been failed or rescheduled under the error class this carries.
    """

    def __init__(self, error_class: str, detail: str):
        super().__init__(detail)
        self.error_class = error_class
        self.detail = detail


class ResultRejected(Exception):
    """Raised by a result applier to say the results are unusable, with the error class to use."""

    def __init__(self, detail: str, error_class: str = "input_invalid"):
        super().__init__(detail)
        self.error_class = error_class
        self.detail = detail


class ResultTooLarge(ValueError):
    """A `complete` payload over the cap. Large results belong in artifacts."""


class DependencyCycle(ValueError):
    """Adding this dependency would make a job wait on itself."""


class UnknownJob(KeyError):
    pass


class UnknownAttempt(KeyError):
    pass


class ConcurrentChange(RuntimeError):
    """A job changed between being read and being written, which a row lock should prevent."""


class LostLeadership(RuntimeError):
    """A newer maintenance term exists, so this process must stop its maintenance work."""
