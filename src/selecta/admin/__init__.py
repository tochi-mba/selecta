"""Selecta Cloud's admin console backend: audited commands, read models and emergency controls.

This package imports nothing on its own, so `admin.state` stays cheap for the code paths that
only ask "is this paused?". See `admin.routes` for the API and `admin.state` for the controls.
"""
