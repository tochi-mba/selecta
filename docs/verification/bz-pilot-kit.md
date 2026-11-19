# SelectaDJ for Business scouting pilot kit (ADR-0441 BZ-0441-06, -07, -08)

Everything the owner needs to run 3 to 5 friendly pilot venues for at least 4 weeks each, before
anything is sold. Nothing here is a paid sale, and nothing here has been run yet: recruiting
venues, installing kiosks, holding the conversations and signing the agreements are the owner's
steps. The agreement text is a starting draft for the owner (and, if the owner takes the early
legal view in docs/saas/19-business-venues.md, a lawyer) to review; it is not legal advice.

## 1. Pilot agreement (template)

**Parties.** REX Technologies ("we"), maker of SelectaDJ, and [venue business legal name]
("the venue"), for the venue(s) at [address(es)].

1. **What the pilot is.** The venue uses SelectaDJ for Business free of charge (or for a nominal
   [amount] a month, owner to decide) from [start date] to [end date], at least 4 weeks. It is a
   test of an unfinished product, not a purchase. No subscription starts, and no card is charged.
2. **Your music.** The venue uploads only music it has the right to use. SelectaDJ does not
   supply a catalogue.
3. **Your licences.** The venue holds the public performance licences its premises need (in the
   UK, for example, PPL PRS TheMusicLicence) for the whole pilot, and confirms them in the app
   before any zone plays. SelectaDJ does not provide a public performance licence.
4. **Guests.** Guests may send song requests from their phones. They never receive audio.
5. **Data.** We keep the play log, device health and request counts the product records to
   measure the pilot (section 3). Business and personal libraries stay apart.
6. **Feedback.** The venue agrees to a short feedback card each week and a 20-minute
   conversation at the end, including the price questions in section 5.
7. **Ending.** Either side may end the pilot with 7 days' notice. Music stops only at the venue's
   closing time, never mid-service, after warnings 72 and 24 hours before. The venue's uploads
   are kept for 30 days after the end, then deleted unless the venue converts.
8. **No warranty.** It is a pilot; we fix problems as fast as we can but promise no uptime.

Signed for REX Technologies: ______  Signed for the venue: ______  Date: ______

## 2. Per-pilot setup checklist

| Step | Done by | Done |
|---|---|---|
| Agreement signed and filed (section 1) | Owner and venue | |
| Pilot organisation created by staff (`/admin/business/pilots`), pilot end date set | Owner | |
| Venue address, time zone and opening hours entered, holidays added | Owner with venue | |
| Zones named (one per speaker area) | Owner with venue | |
| Public performance licence attested in the app (ADR-0449) | Venue | |
| Music uploaded with rights attested; one organisation crate, one venue crate | Venue | |
| Kiosk device chosen (mini PC, Android TV box or tablet), paired, autoplay checked | Owner | |
| Staff PINs set, one manager invited, staff shown Pause, Skip and Volume | Owner | |
| First scheduled opening watched in person: audible within 60 s of opening | Owner | |
| Feedback card cadence agreed (weekly) | Owner | |

## 3. Success measures

Four measures are computed from real play and heartbeat rows by
`selecta.business.pilot_measures.measure(conn, workspace_id, start, end)`; the fifth is the
feedback card.

| Measure | Target for a good pilot | How it is collected |
|---|---|---|
| Silent minutes inside opening hours | 0 platform-caused | `zone_alerts` of kind silent |
| Staff interventions per opening day | falling week on week, under 3 by week 4 | applied `zone_commands` |
| Guest requests per opening day | recorded, no target | `business_zone_room_requests` |
| Kiosk uptime | 99% or better | 5-minute `device_health_history` buckets |
| Staff satisfaction | 4 of 5 or better | the feedback card, by hand |

## 4. Weekly feedback card

1. How did the music fit the room this week? (1 to 5)
2. Did the music ever stop or go silent while you were open? When?
3. How many times did staff have to touch SelectaDJ? Why?
4. Did a guest or staff member complain about a song? Which, and why?
5. What one thing would you change?
6. Overall, how happy are staff with SelectaDJ? (1 to 5)

## 5. Price-sensitivity questions (BZ-0441-08)

Asked of every pilot venue and at least 15 further venue owners (Van Westendorp, four
questions, per venue per month, ex VAT, in GBP):

1. At what price would SelectaDJ for Business be so cheap you would doubt its quality?
2. At what price would it be a bargain?
3. At what price would it start to feel expensive, but you would still consider it?
4. At what price would it be too expensive to consider?

Then the conversion question for pilot venues: "After the pilot, would you pay £79 per venue per
month ex VAT, including 1 zone and 3 staff seats?" (yes / no / at what price). Record the
answers in the pilot report; the acceptable range and the share willing to pay £79 come from
them.

## 6. Pilot report (one per venue, BZ-0441-07)

| Field | Value |
|---|---|
| Venue, kind (bar, restaurant, shop, gym, hotel), zones | |
| Dates (start, end, weeks run) | |
| Licence attested on | |
| Silent minutes, interventions per day, requests per day, uptime (from section 3) | |
| Feedback card average (section 4) | |
| Price answers (section 5) | |
| Edge cases found (each becomes a named test before its fix, ADR-0454) | |
| Owner sign-off | |
