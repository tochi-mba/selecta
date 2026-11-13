*Draft pending legal review (SC-0406-01, ADR-0406). Written by Claude on 2026-11-12 from the code, for the owner to edit and send. Not sent. Placeholders in square brackets must be filled by the owner; do not send with any left in.*

# Request to LRCLIB's operators: use of the LRCLIB API by SelectaDJ Cloud

**To:** the LRCLIB maintainers ([contact route to be confirmed by the owner: the address or channel LRCLIB publishes for API questions])
**From:** [owner's name], REX Technologies, [contact email to be confirmed]
**Subject:** Permission and rate for a hosted DJ service using the LRCLIB API

Hello,

I make SelectaDJ, a REX Technologies product: a DJ-mixing app that has so far run only on the user's own computer. Its local edition looks up synced lyrics from LRCLIB for songs in the user's own library, identifying itself with the user agent `selecta/<version> (https://github.com/tochi-mba/selecta)`, one request at a time.

We are preparing a hosted edition, SelectaDJ Cloud, which will include paid plans. Before it launches we would like your written confirmation (or refusal) of the use described below, and of the request rate, so that we stay within what you are happy to support.

## What we would send

- Only `GET /api/get` (artist, title, album, duration) and, when that misses, `GET /api/search` (artist, title), for songs a user has uploaded to their own private library.
- No personal data about our users: no names, emails, account ids or audio. The only data is the song's artist, title, album and length as tagged in the user's file.
- A user agent naming SelectaDJ Cloud and a contact address: [user agent string and contact to be confirmed].

## How we would use the answers

- Line-synced lyrics are used inside the app to find where vocals are, to avoid cutting over a vocal line in a transition, and to time word-level alignment.
- The app can show the lyrics to the person who uploaded the song while it plays. We understand that showing lyrics in a paid product may also need a licence from the rights holders, and we are taking separate legal advice on that; this letter asks only about the LRCLIB service itself.
- [Owner to decide: whether results are cached, for how long, and whether a cached result for a song is reused across users. State it here.]

## Rate

- Every Cloud request, from every server and every user together, passes one shared limiter: at most **one request per second**, burst 1, sequential, honouring `Retry-After`. That is a hard ceiling of 86,400 requests a day.
- Expected volume at beta: [owner's estimate: users x songs per user per month, for example 200 users x 2,000 songs is about 400,000 lookups once, then new uploads only]. At one a second a first import of that size would take about 4.6 days to clear, which we accept.
- If you would prefer a lower rate, a daily cap, set hours, or that we host a mirror from your published database dump instead of calling the live API, please tell us and we will do that.

## Our questions

1. Do you agree to SelectaDJ Cloud using the LRCLIB API as described, including on paid plans?
2. Is one request a second, shared across the whole service, acceptable? If not, what rate is?
3. Would you prefer we use a database dump or mirror for bulk imports?
4. How should we credit LRCLIB in the app?
5. Is there anything else you would like us to do, or a contribution towards running costs you would welcome?

Thank you for running LRCLIB. A written reply (email is fine) is what we need; we will keep it on file with our licence register.

[Owner's name]
REX Technologies
[Registered address, to be confirmed] · [Company number, to be confirmed]

---

*Facts above come from `src/selecta/lyrics/lrclib.py` (endpoints, fields sent, user agent, one-at-a-time and Retry-After), `src/selecta/usage/rate_limit.py` and `docs/saas/10-audio-engine-in-cloud.md` section 10.5 (the shared one-a-second bucket, `SELECTA_LRCLIB_RATE_PER_S`, `SELECTA_LRCLIB_BURST`). Check each against the code on the day the letter is sent. File the reply under `docs/saas/` and link it from [licence-register.md](../licence-register.md).*
