"""Moved to `selecta.planner_core.recipes.exits`, which builds scripts from song facts alone.

This old name is that same module object, so every existing import, and anything that patches a
name here, keeps working exactly as before.
"""

import sys

from selecta.planner_core.recipes import exits

sys.modules[__name__] = exits
