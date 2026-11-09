"""Rooms: Premium guest song requests by QR code (ADR-0416).

`service.Rooms` is the one object callers need. Behind it: `lifecycle` (open, lock, new code,
end, expiry), `guests` (join, approve, remove, ban, nicknames), `requesting` (requests, votes,
host decisions, planner outcomes), `planning` (handing accepted requests to the planner in
round-robin order, under the render cap), `display` (big-screen pairing), `views` (what a guest,
the host and a display may see) and `purge` (guest data deleted 30 days after a room ends).
Codes, tokens and nicknames are in `codes` and `nicknames`; the rest of Selecta is reached only
through `ports`. Nothing here is wired into the app yet.
"""
