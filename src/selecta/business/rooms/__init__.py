"""Rooms for Business: a standing request room per zone with staff approval (ADR-0451).

- `schema`: the `business_zone_room*`, `business_venue_networks` and `business_staff_presence`
  tables.
- `service.ZoneRooms`: all the logic, built from `core` (rooms, codes, settings, print,
  screen code), `guests` (join, guest page, search), `requests` (requests, votes, queue,
  approvals, expiry, the planner's slot) and `moderation` (remove, ban, pause, purge).
- `ports`: hours, staff presence, dayparts, playback, content rules and audit, with defaults.
- `api.install_routes`: staff, manager, display and guest routes.

Personal party rooms (`selecta.rooms`) are untouched; this package only imports their code
hashing, nicknames, rate-limit windows and round-robin ordering.
"""
