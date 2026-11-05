from __future__ import annotations

from selecta.lyrics.lrclib import parse_lrc


def test_parse_lrc_orders_and_bounds_lines():
    lines = parse_lrc("[00:10.00]second line\n[00:01.00]first line", 20)
    assert [line.text for line in lines] == ["first line", "second line"]
    assert lines[0].end <= lines[1].start
