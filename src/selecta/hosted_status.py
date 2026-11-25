"""What a hosted job means to the customer, and when a job can never finish (`hosted_render`).

Two questions, answered from a job row (the latest job for one piece of work) and whether its
artifact exists:

- `needs_new`: does this work need a fresh job? A live job that declares no output namespace
  (`input_ref["output"]`, what the worker gateway signs upload slots in) can never publish, so it
  is replaced; so is a cancelled job, a succeeded one whose file was evicted, and, for analysis
  only, a job that failed for good on our side (never the song's own fault) up to
  `AUTO_RENEW_LIMIT` times. Everything else waits, or waits for the customer's Try again.
- `customer_status`: one of waiting, running, done or failed, with a plain reason a customer can
  read. A worker's own words are shown only when they are a short sentence written for people
  (an `InputInvalid` message such as "No steady beat was found in this song."); a traceback or
  anything with a link never reaches the page.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from selecta.work.holds import STAFF_HOLD
from selecta.workers.context import scrub_urls

TERMINAL = frozenset({"succeeded", "cancelled", "failed", "quarantined"})
RUNNING = frozenset({"leased", "running", "validating"})
AUTO_RENEW_LIMIT = 3
"""Jobs for one song that may end unsuccessfully (failed on our side, or cancelled) before a
fresh one waits for the customer's Try again instead of being made by itself."""
SONGS_FAULT = frozenset({"input_invalid", "poison"})

WAITING_FOR_WORKER = (
    "Waiting for a SelectaDJ worker to start: none is running right now. Nothing is lost; it "
    "starts when one does."
)
IN_LINE = "In line: it starts as soon as a worker is free."
RETRYING = "It hit a problem on our side and tries again by itself shortly."
STARTING_AGAIN = "Starting again."
REMAKING = "Its finished file was cleared to save space; it is being made again."
HELD = "Held by SelectaDJ for now; it carries on when the hold is lifted."
NOT_STARTED = "Not started yet."


def declared_output_ok(input_ref: Any, expected: Mapping[str, str]) -> bool:
    """Whether a job names the namespace its worker publishes into, exactly as expected."""
    output = input_ref.get("output") if isinstance(input_ref, Mapping) else None
    return (isinstance(output, Mapping) and output.get("kind") == expected["kind"]
            and output.get("input_hash") == expected["input_hash"])


def needs_new(artifact: bool, job: Mapping[str, Any] | None, expected: Mapping[str, str], *,
              unsuccessful: int = 0, retry: bool = False, renew_failed: bool = False) -> str | None:
    """Why this work needs a fresh job now, or None (module notes). `unsuccessful` counts this
    work's jobs that ended failed, quarantined or cancelled; `renew_failed` lets a failure that
    was our fault be tried again without the customer asking."""
    if artifact:
        return None
    if job is None:
        return "no_job"
    state = str(job["state"])
    if state not in TERMINAL:
        if state == "cancel_requested" or (state == "blocked"
                                           and job.get("error_class") == STAFF_HOLD):
            return None
        return None if declared_output_ok(job.get("input_ref"), expected) else "no_output"
    if state == "succeeded":
        return "evicted"
    if retry:
        return "retry"
    if not renew_failed or unsuccessful >= AUTO_RENEW_LIMIT:
        return None
    if state == "cancelled":
        return "cancelled"
    if state == "failed" and job.get("error_class") not in SONGS_FAULT:
        return "failed_ours"
    return None


def _own_words(detail: str | None) -> str | None:
    text = (detail or "").strip()
    first = text.splitlines()[0].strip() if text else ""
    if (not first or len(text) > 240 or "Traceback" in text or 'File "' in text
            or "://" in text or "Error:" in first):
        return None
    return scrub_urls(first)


def failure_reason(job: Mapping[str, Any]) -> str:
    """Why it stopped, in words for the customer."""
    state, kind = str(job["state"]), job.get("error_class")
    if state == "cancelled":
        return "It was cancelled before it finished."
    if state == "quarantined" or kind == "poison":
        return ("It stopped our servers several times in a row, so it was set aside. Try again, "
                "or upload the file again.")
    if kind == "input_invalid":
        return _own_words(job.get("error_detail")) or "This file couldn't be read as music."
    if kind == "resource":
        return "It is too long or too large for our servers to finish."
    if kind == "dependency":
        return "Something it needed didn't finish."
    return "Something went wrong on our side while working on it. Try again."


def customer_status(artifact: bool, job: Mapping[str, Any] | None, *, worker_seen: bool,
                    not_started: str | None = None) -> dict[str, Any]:
    """{"state": waiting | running | done | failed, "reason", "job_id", "can_retry"}."""
    def out(state: str, reason: str | None, can_retry: bool = False) -> dict[str, Any]:
        return {"state": state, "reason": reason,
                "job_id": job["id"] if job is not None else None, "can_retry": can_retry}

    if artifact:
        return out("done", None)
    if job is None:
        return out("waiting", not_started or NOT_STARTED)
    state = str(job["state"])
    if state in RUNNING:
        return out("running", None)
    if state in ("failed", "quarantined", "cancelled"):
        return out("failed", failure_reason(job), True)
    if state == "succeeded":
        return out("waiting", REMAKING)
    if state == "cancel_requested":
        return out("waiting", STARTING_AGAIN)
    if state == "retry_scheduled":
        return out("waiting", RETRYING)
    if state == "blocked":
        return out("waiting", HELD if job.get("error_class") == STAFF_HOLD
                   else "Waiting for something it needs.")
    return out("waiting", IN_LINE if worker_seen else WAITING_FOR_WORKER)


__all__ = [
    "AUTO_RENEW_LIMIT", "customer_status", "declared_output_ok", "failure_reason", "needs_new",
]
