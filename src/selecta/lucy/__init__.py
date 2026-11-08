"""Lucy: an optional, agentic way to make a mix by talking it through (ADR-0300 to ADR-0339).

Lucy augments Make a Mix; it never replaces one-tap Play, the editor, the library or the local
audio engine. The journey is Describe -> Investigate -> Propose -> Critique -> Revise -> Approve
-> Build -> Listen, and every step past Propose is the person's, never the model's:

- Lucy may read the library and plan proposals on its own, inside fixed budgets.
- Expensive compute (new analysis, new renders) needs a permission the person grants.
- Saving a draft needs an exact, host-issued approval bound to one immutable revision.
- Playing anything needs a further, separate confirmation. Lucy never starts or pauses audio.

The database is the memory. Prompt text is only ever a bounded view derived from it.
"""

from __future__ import annotations

EVENT_SCHEMA_VERSION = 1
"""Bumped when an event payload changes shape; clients with another version take a snapshot."""

PLANNER_VERSION = 1
"""Recorded on every revision so evidence can be tied to the planner that produced it."""

LIFECYCLE = (
    "idea",
    "proposed",
    "approved",
    "draft",
    "rendering",
    "ready",
    "playing",
)
"""The words Lucy uses, in order. None of them ever stands for another (LU-300-07, LU-309-05)."""
