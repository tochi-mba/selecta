"""SelectaDJ's own song catalogue, filled from MusicBrainz and the Cover Art Archive (ADR-0478).

- `client`: the identified, rate-limited MusicBrainz and Cover Art Archive client.
- `match`: pure matching of one song to a recording and the release whose cover it shows.
- `schema`: the platform-wide catalogue tables and the per-workspace song links.
- `service`: asking for a lookup, the job that does it, and reading the result.
- `routes`: `/api/catalog/...` in the Cloud app.

Everything here is off unless the flag `library.art_lookup` is on, and a lookup only starts for
a person who turned on "Look up covers and details on the web" for their account.
"""
