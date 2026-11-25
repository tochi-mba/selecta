"""The planner core: everything that decides, and nothing that touches audio, files or a database.

Song facts go in (`SongInfo`, `Cue`), and ranked candidates, transition scripts and a repair rule
come out. A studio (the Desktop process, a cloud worker, later the member's browser) renders and
audits, and asks the core what to try next. `tools/planner_core_pure.py` keeps it that way. See
docs/engineering/planner-core.md.
"""
