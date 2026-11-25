"""Moved to `selecta.planner_core.vibes`, which decides from song facts alone.

This old name is that same module object, so every existing import, and anything that patches a
name here, keeps working exactly as before.
"""

import sys

from selecta.planner_core import vibes

sys.modules[__name__] = vibes
