"""Playback devices and the one playback session per account (ADR-0415).

Every signed-in browser is a device (`devices`). One device at a time is the speaker, holding a
20-second lease it renews with a heartbeat; the rest are remotes that send commands checked
against a sequence number (`session`, `commands`). The tables are in `schema`; the rest of
Selecta is reached only through the ports in `ports`. Nothing here is wired into the app yet.
"""
