"""The `selecta analyse` and `selecta lyrics` progress bar (ADR-0477 FL-0477-07, plan 3.16).

Piped output (the app, a log file, these tests) must stay exactly the plain "n/N" lines; a
terminal gets a bar beneath them that never breaks the run.
"""

from __future__ import annotations

import io

from rich.console import Console

from selecta.cli_progress import progress_bar


def run(console: Console, total: int) -> None:
    with progress_bar(console, "Analysing", total) as moved:
        for number in range(1, 4):
            moved(number, 3)
            console.print(f"{number}/3 done Night Harbour - Lanterns", highlight=False)


def test_a_piped_console_prints_exactly_the_plain_lines():
    out = io.StringIO()
    console = Console(file=out, force_terminal=False, width=120)

    run(console, 3)

    assert out.getvalue() == "".join(
        f"{n}/3 done Night Harbour - Lanterns\n" for n in range(1, 4)
    )


def test_a_terminal_console_shows_the_bar_without_crashing_even_with_no_total_yet():
    for total in (3, 0):
        out = io.StringIO()
        console = Console(file=out, force_terminal=True, width=120)

        run(console, total)

        text = out.getvalue()
        for n in range(1, 4):
            assert f"{n}/3 done Night Harbour - Lanterns" in text
