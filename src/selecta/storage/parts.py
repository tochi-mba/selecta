"""The multipart part policy, and the check the server runs before completing an upload (§5.2).

R2 checks at completion that every part except the last is the same size, allows 5 MiB to 5 GiB
per part and at most 10,000 parts. Selecta uses one fixed 8 MiB part size for every file: a 1 GB
file is 128 parts, and a file smaller than one part is a single part. Because R2 can't enforce a
size when it signs a part URL, the server lists what actually arrived and refuses anything that
isn't exactly the declared, reserved size, split exactly as planned.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from selecta.storage.objects import MAX_COPY_BYTES, MiB, Part

PART_SIZE = 8 * MiB
MIN_PART_SIZE = 5 * MiB
MAX_PARTS = 10_000
# Accepted files are copied into the originals bucket in one CopyObject, which stops at 5 GiB.
MAX_FILE_BYTES = MAX_COPY_BYTES


@dataclass(frozen=True)
class PartPlan:
    part_size: int
    part_count: int
    last_part_size: int


def plan_parts(size: int, part_size: int = PART_SIZE) -> PartPlan:
    """How a file of `size` bytes is split: fixed parts, the last one possibly smaller."""
    if size < 1:
        raise ValueError("An upload needs at least one byte.")
    if part_size < MIN_PART_SIZE:
        raise ValueError(f"Parts are at least {MIN_PART_SIZE} bytes.")
    count = -(-size // part_size)
    if count > MAX_PARTS:
        raise ValueError(f"{size} bytes needs more than {MAX_PARTS} parts of {part_size} bytes.")
    return PartPlan(
        part_size=part_size, part_count=count, last_part_size=size - part_size * (count - 1)
    )


def check_parts(parts: Sequence[Part], declared_size: int, part_size: int) -> str | None:
    """Why these parts can't be completed into a file of `declared_size`, or None if they can.

    The reasons are plain enough to show the person who uploaded.
    """
    if not parts:
        return "No data arrived for this file."
    plan = plan_parts(declared_size, part_size)
    numbers = [part.number for part in parts]
    if sorted(set(numbers)) != list(range(1, len(numbers) + 1)):
        return "Some parts of the file are missing."
    total = sum(part.size for part in parts)
    if total > declared_size:
        return "More data arrived than the file's declared size."
    if total < declared_size:
        return "Less data arrived than the file's declared size."
    # The total matches, so a wrong part count can only come from a wrong split: equal parts of
    # `part_size` then force the last one to be the planned remainder (or larger, if too few).
    ordered = sorted(parts, key=lambda part: part.number)
    for part in ordered[:-1]:
        if part.size != part_size:
            return "The file's parts weren't the agreed size."
    if ordered[-1].size != plan.last_part_size:
        return "The file's last part wasn't the expected size."
    return None
