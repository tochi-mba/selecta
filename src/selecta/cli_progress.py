"""The `selecta` command's progress bar, kept apart so cli.py stays a readable size."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager

from rich.console import Console


@contextmanager
def progress_bar(console: Console, what: str, total: int) -> Iterator[Callable[[int, int], None]]:
    """A progress bar under the usual lines while someone watches in a terminal. Piped output (the
    app, a log file, the tests) gets exactly the plain "n/N" lines and nothing more. The bar moves
    only when a song is really done; it is told the number done, never a guess. A total of 0 means
    not known yet, and the bar waits without a length until it is told one."""
    if not console.is_terminal:
        yield lambda done, total: None
        return
    from rich.progress import (
        BarColumn,
        MofNCompleteColumn,
        Progress,
        TextColumn,
        TimeRemainingColumn,
    )

    with Progress(
        TextColumn("{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        TimeRemainingColumn(),
        console=console,
        transient=True,
    ) as bar:
        task = bar.add_task(what, total=total or None)

        def update(done: int, total: int) -> None:
            bar.update(task, completed=done, total=total or None)

        yield update
