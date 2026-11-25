"""What a room does together, as rules with no database in them (ADR-0488).

Party rooms (`selecta.rooms`) and venue rooms (`selecta.business.rooms`) keep their own tables
and routes, because a party room belongs to a workspace and ends, while a venue room belongs to
a zone and stands. The rules both must agree on live here, as plain functions over plain values:

- `dedications`: the fixed list of lines a guest may attach to a request.
- `rounds`: counting a vote for the next song and choosing its winner.
- `reactions`: when a room's taps are enough to teach the planner.
- `recap`: turning a room's counts into "tonight in numbers".

Nothing here reads a guest's words, because no guest ever sends any: a phone sends a tap, a
vote for an offered song, or the id of a listed line.
"""
