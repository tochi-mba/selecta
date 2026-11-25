"""Moved to `selecta.planner_core.beam`, which decides from song facts alone.

This old name is that same module object, so every existing import, and anything that patches a
name here, keeps working exactly as before.
"""

import sys

from selecta.planner_core import beam

sys.modules[__name__] = beam
