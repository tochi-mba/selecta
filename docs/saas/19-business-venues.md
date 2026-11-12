*Part of the [Selecta Cloud proposal](README.md). Proposed on 2026-11-12; awaiting the owner's decision.*

## 19. SelectaDJ for Business: venues paying per venue per month

*Prepared 12 November 2026. Users see "SelectaDJ"; the company is REX Technologies; code identifiers stay `selecta`. Prices are from public pages and third-party summaries as of November 2026 ([sources](sources.md#selectadj-for-business-sources-2026-11-12)) and must be re-checked before any spend or pricing decision. Nothing here changes Free, Standard or Premium.*

Sub-chapters: [19a. Venue operations](19a-venue-operations.md) (organisations, zones, opening hours, kiosks, offline playback) · [19b. Business experience](19b-business-experience.md) (content controls, Rooms for Business, roles, UI, edge cases and testing). Checklist: [selecta-business-implementation-checklist.md](../adr/selecta-business-implementation-checklist.md).

### 19.0 Goal: build it ready, sell nothing yet

The owner's words (2026-11-12): build the business product so it is ready, but don't sell to businesses first; scout around first. So:

- **Everything is built and tested to release quality, with selling switched off.** The flag `business.signups` (cloud mode, default off) hides the business pricing page, checkout and self-serve organisation creation. With it off, pages reflow and individual users see no business wording ([ADR-0441](../adr/adr-0441-business-goal-boundary-and-pricing.md)).
- **Pilot venues are switched on one organisation at a time** through ADR-0414 targeting rules, never by turning the flag on for everyone.
- **The legal review is a hard gate before any paid business sale, not before building** ([§19.8](#198-licensing-and-the-hard-legal-gate)).
- **Tasks are ordered build-first:** every task that can be built and tested without a sale comes before the person steps (pilots, price check, accountant, lawyer, launch switch).

| Phase | What happens | Selling | Exit test |
|---|---|---|---|
| **B0 Build (dark)** | ADR-0441 to ADR-0454 built and tested; Stripe in test mode only | Off | Checklist tasks without a person step are done |
| **B1 Scouting** | 3 to 5 friendly pilot venues for at least 4 weeks each; pricing test plan ([§19.6](#196-pricing-risk-and-the-test-plan)); costs measured | Off (pilots free or nominal under a pilot agreement) | Pilot report, price check results, measured unit economics |
| **B2 Paid launch (UK)** | Legal gate passed, Stripe staging run passed, owner switches `business.signups` on | On, UK only | First paying venues, SLO met |
| **B3 US and EU** | Currency prices, US PRO and EU society wording, reverse-charge invoicing at scale | On | Per-market legal check |

Pilots play music in public, so each pilot venue must hold its own public performance licence and sign the attestation like any customer. Whether to ask the lawyer for an early view before the first pilot plays is an owner decision ([§19.10](#1910-what-the-owner-must-decide)).

### 19.1 The model

Organisation (the paying business) -> Venues (a physical site with an address, time zone, opening hours and its own music licence) -> Zones (an area with its own speaker: bar, terrace, dining room) -> Devices (players and remotes).

- One playback session per **zone**, generalising ADR-0415's one session per account. Each zone has exactly one speaker device holding the lease; remotes can control any zone they have rights to. Detail: [19a](19a-venue-operations.md), ADR-0442 and ADR-0443.
- A person can belong to an organisation and keep a personal account, switching workspace. Personal and business libraries, ratings, Lucy memory and usage never mix.
- The organisation owns a shared library; venues pick from it with venue crates and playlists; staff uploads go into the organisation library with the uploader recorded.
- Opening hours, dayparts, kiosk players, offline playback ([19a](19a-venue-operations.md)); content controls, Rooms for Business, roles and the UI ([19b](19b-business-experience.md)).

### 19.2 Product boundary

| SelectaDJ for Business is | It is not |
|---|---|
| Automatic DJ mixing of the business's **own** music, unattended, per zone | A licensed music catalogue |
| Multi-venue control from HQ, schedules and dayparts per zone | A live-DJ replacement for events with a performer |
| Guest requests by QR per zone with staff approval (Rooms for Business) | Audio streamed to guests' phones |
| A per-venue licence attestation, reminders and play-log exports | A licence: venues keep their own TheMusicLicence, PRO or society licences |

### 19.3 Pricing (owner's starting point; not decided)

All prices GBP, ex VAT. The owner said "79 per venue per month" and also "79 bucks" (see currency in [§19.10](#1910-what-the-owner-must-decide)).

| Item | Price | Notes |
|---|---|---|
| Business, per venue | **£79 / venue / month** | Includes 1 zone, 3 staff seats, share of pooled storage |
| Annual | £790 / venue / year | Two months free (about 17% off) |
| Extra zone in a venue | £25 / zone / month | Each extra zone is one more simultaneous speaker |
| Extra staff seats | 3 per venue included; then £5 / seat / month | Owners and admins free |
| Volume | 10 to 24 venues: 10% off; 25+: Enterprise, sales-led | Enterprise contracts can sit outside Stripe (ADR-0447) |
| Trial | 14 days, 1 venue, 1 zone, card required | One per organisation and card |
| Storage | 250 GB per organisation + 50 GB per venue, pooled | Counted as in ADR-0402 |
| Processing weight | 8 for interactive work during opening hours; 6 otherwise | Premium is 6; a silent venue is the worst failure |
| Lucy | Venue programming assistant, pooled per venue | Starting point: 300 quick turns, 30 planning turns, 5 deep plans per venue per month |
| SLO | 99.9% of opening minutes without silence caused by SelectaDJ | Service credits as invoice credit notes (ADR-0448) |

Worked totals (monthly, ex VAT): 1 venue, 1 zone = £79. 1 venue, 3 zones = £129. 5 venues, 7 zones, 18 staff = £395 + £50 + £15 = £460. 12 venues, 12 zones = £948 less 10% = £853.20. UK customers add 20% VAT.

### 19.4 Unit economics per venue

Inputs come from [§3.3](02-plans-and-economics.md#33-unit-economics-estimates-to-be-replaced-by-phase-0-benchmarks): R2 $0.015/GB-month with no egress fees; first analysis about $0.001 per song; one transition render $0.0001 to $0.002; Lucy Haiku turn about $0.001, Sonnet about $0.02, Opus deep plan about $0.10. Assumed £1 = $1.27. Transitions every 3.5 minutes on average. All figures are per venue per month, for a single-venue organisation (multi-venue organisations pool storage, so their per-venue storage cost is lower).

| Cost line | Worst case | Typical |
|---|---|---|
| Assumption | Full 300 GB of MP3s (about 75,000 songs), open 16 h a day every day, every transition at the expensive end, all Lucy turns used | 40 GB (about 10,000 songs), open 10 h a day, average transition $0.0005, light Lucy use |
| Storage, originals | 300 GB x $0.015 = $4.50 = £3.54 | 40 GB = $0.60 = £0.47 |
| Derived data (capped at 15%) | £0.53 | £0.07 |
| First import, amortised over 12 months | 75,000 x $0.001 = $75 / 12 = £4.92 | 10,000 x $0.001 / 12 = £0.66 |
| Transitions (one zone) | 274 a day x 30 x $0.002 = $16.46 = £12.96 | 171 a day x 30 x $0.0005 = $2.57 = £2.02 |
| Render-ahead waste (offline cache, skips; +25%) | £3.24 | £0.51 |
| Lucy pool | 300 x $0.001 + 30 x $0.02 + 5 x $0.10 = $1.40 = £1.10 | £0.24 |
| Playback delivery (R2 reads, heartbeats) | £0.08 | £0.08 |
| Stripe (UK card 1.5% + 20p, Billing 0.7%, Tax 0.5% on £79) | £2.33 | £2.33 (annual: about £1.79 a month) |
| Platform share (API, database, monitoring) | £1.50 | £1.50 |
| **Total cost** | **£30.20** | **£7.88** |
| **Gross margin at £79** | **£48.80 (62%)** | **£71.12 (90%)** |

Notes:

- **Support is the biggest unknown.** Venues phone when music stops. At 30 minutes of support per venue per month valued at £30 an hour, add £15: typical margin drops to about 71%, worst case to about 43%. Scouting measures this (BZ-0448-10).
- **Extra zones are thin in the worst case.** An extra zone adds mostly transitions and render-ahead: about £16.20 worst case against £25 (35% margin), about £2.53 typical (90%). The per-zone render budget (ADR-0448) is what keeps the worst case bounded.
- **Annual billing** reduces Stripe fees per month and cash risk, at £65.83 a month effective price.
- **US and EU card fees** are higher (Stripe US cards 2.9% + 30c); re-run the table per currency before B3.
- **Not our cost:** the venue's own licences (TheMusicLicence for a café or restaurant runs from a few hundred pounds a year, sized by venue), kiosk hardware (a mini PC or TV box, about £60 to £200 one-off, bought by the venue), and the venue's internet.

### 19.5 Competitor research

Background-music services for business mostly **include** a licensed catalogue and price per zone or per location. Most do not publish prices; the figures below come from vendor pages where available and otherwise from third-party summaries, and must be re-checked.

| Service | Published or reported price | What it includes | Source quality |
|---|---|---|---|
| Soundtrack (formerly Soundtrack Your Brand) | About €24 to €29 per zone per month in Europe; about $29 to $35 in the US and Canada; plans priced per zone, cheaper billed annually; Enterprise by quote | Licensed catalogue, scheduling, multi-zone control; in the UK the venue still needs its own PPL PRS licence | Third-party; official page renders prices dynamically |
| Rockbot | About $25 per zone per month billed annually (about $29.95 month to month); request add-on reported at $25 to $45 a month; media player from $149 | Licensed catalogue (US), guest requests as an add-on, messaging | Third-party and competitor pages |
| Pandora CloudCover (Cloud Cover Music) | $16.95 per location per month annual ($18.95 monthly); Manage $21.50; Messaging $26.95; extra zone $12.95 | US background-music licensing fees included; multi-location control on Manage | Vendor's own page |
| Soundsuit | From €29 per zone per month (Curated) and €39 (Control), billed yearly | Licensed catalogue; says US fees include the relevant licences | Vendor's own page |
| Mood Media (owns Vibenomics) | Quote only; one subscription per location or per separately programmed area | Licensed catalogue, hardware lease options, in-store messaging and advertising | Vendor says contact sales |
| Industry roundups | About $29 to $49 per location per month for commercial streaming | Varies | Third-party |

**Where £79 sits.** £79 is about $100. Against services that include a licensed catalogue, SelectaDJ at £79 per venue (including one zone) costs **two to four times** a single zone elsewhere (about 2x Soundsuit Control, about 3x Rockbot or Soundtrack, about 5x Cloud Cover's entry plan). A venue also gets nothing to play from SelectaDJ until it uploads its own music, and in the US the competitor price often already covers the PRO fees that a SelectaDJ venue must pay itself.

What has to justify the price:

1. **Mixing quality.** Beat-matched, key-aware transitions that sound like a DJ, not a crossfading playlist. No competitor above does this.
2. **The venue's own sound.** Bars and clubs with a curated library or resident DJs' crates keep their identity rather than renting a generic catalogue.
3. **Rooms for Business.** Guest requests that the mix plans musically, with staff approval, included rather than a $25 to $45 add-on.
4. **Multi-venue control and dayparts** with energy steering rather than hard cuts.

The likely buyers are therefore venues that today pay for DJs or care a lot about their sound (cocktail bars, late-opening bars, boutique hotels, gyms with class programming), not shops that just want inoffensive background music. That segment assumption is itself untested.

**Pricing risk (recorded as a risk, not a decision):** at £79 SelectaDJ is far above the catalogue-included market. If scouting shows venues compare it to Soundtrack rather than to a DJ, options are a lower entry price, a cheaper "Mix" tier without Rooms and HQ control, or per-zone pricing closer to £35 to £49.

### 19.6 Pricing risk and the test plan

The test plan runs inside **Phase B1 Scouting**, with selling still off.

1. **Pilot venues (BZ-0441-07).** 3 to 5 friendly venues of different types (for example a cocktail bar, a café, a gym or studio, a small hotel), each for at least 4 weeks, with its own licence attested. Measured automatically: silent minutes (target zero), staff interventions per opening day, requests per day, kiosk uptime, cost per venue. Asked: would you pay, how much, compared with what you use today.
2. **Price-sensitivity check (BZ-0441-08).** A Van Westendorp survey (too cheap, a bargain, getting expensive, too expensive) with the pilot venues plus at least 15 further venue owners or managers, shown a 2-minute demo recording. Record the acceptable range and where £79 falls in it.
3. **Conversion offer.** At the end of each pilot, a written offer at £79 (or the owner's chosen price) for after the legal gate, with no payment taken. Record yes, no, and the reason.
4. **Competitor framing check.** Ask each venue what they would compare SelectaDJ with (a DJ, Spotify, Soundtrack, nothing). If most say Soundtrack, the risk above is real.
5. **Decision rule (proposed).** Keep £79 if at least half the pilots and at least 30% of surveyed venues accept it; otherwise test a second price with the next pilots before launch.

### 19.7 Billing design and edge cases

Full decision: [ADR-0447](../adr/adr-0447-business-billing-quantities-vat-and-dunning.md). Stripe supports one subscription with several items, each with a quantity, which is the per-seat model; quantity changes create prorations unless turned off per request.

- **One subscription per organisation** with quantity items: venues, extra zones, extra seats. The server computes quantities from the organisation's data; webhooks are pokes (re-fetch and recompute, as in ADR-0403); nightly reconciliation fixes quantity drift.
- **No consumer cancellation flow** for business: the buyer confirms they act for a business, and business terms are accepted and versioned.

| Edge case | Behaviour |
|---|---|
| Add a venue, zone or seat mid-period | Immediate and prorated; a preview from Stripe's upcoming invoice shows the exact charge before confirming |
| Remove a venue mid-period | Takes effect at period end, no credit by default; remove and re-add in one period never double-charges |
| Payment fails | 14-day grace; emails to owner and admins on days 0, 3, 7 and 12; banner on manager devices only, never on the customer-facing display; then read-only management; playback stops only at each venue's next closing time after grace, with 72 h and 24 h warnings; never mid-service |
| Overnight or missing opening hours at grace end | Stop at the venue's close past midnight; with no hours, at the owner's chosen quiet point or 04:00 local, after warnings |
| Venue offline at stop time | The kiosk applies its cached schedule (ADR-0446) |
| Venue changes owner organisation | Both owners consent; moves at the next period boundary with its zones, devices, attestations and play logs; library rights do not move automatically; both quantities update; audited |
| VAT numbers | UK: 20% VAT. EU business with a VAT number valid at the time of sale: zero-rated with a reverse-charge note, validation stored, re-checked before each renewal; invalid number: EU sale blocked as in ADR-0403 |
| Invoices with POs | Up to four invoice custom fields (organisation PO, per-venue cost centre); consolidated invoice with venue-named lines and a per-venue cost CSV; bank transfer at net 30 for annual and Enterprise; custom fields cannot change after an invoice is finalised |
| Refunds | B2B has no statutory 14-day cooling-off; refunds and SLO service credits are staff decisions with reasons, normally as credit notes on the next invoice |
| Disputes and chargebacks | Never silence a venue automatically; billing staff review; a lost dispute enters the grace path. UK dispute fee about £20, with a further fee to counter (to confirm on Stripe's UK pricing) |
| Downgrade | The owner picks which venues stay; unpicked venues and zones over the paid count pause at their next close; nothing deleted; resuming restores them |
| Enterprise contracts outside Stripe | Audited contract entitlement (term, venues, zones, seats, price, invoice terms, expiry); reconciliation skips it; expiry warnings at 30, 14 and 3 days |

### 19.8 Licensing and the hard legal gate

Full decision: [ADR-0449](../adr/adr-0449-public-performance-licensing-and-play-logs.md).

**United Kingdom.** Playing recorded music in a business is a public performance and needs TheMusicLicence from PPL PRS, priced by tariffs that use sector, floor area, staff or capacity. The 2026 small-workplace tariff starts around £168 a year plus VAT for an office of four or fewer staff where customers cannot hear the music; cafés and restaurants pay more. Venues using a background-music provider still need their own PPL PRS licence. Separately, **copying** recordings to make a business music service is licensed: PPL issues dubbing licences to businesses that copy its repertoire to supply background music, and PRS for Music's ProDub licence covers copying works (paid per track copied, with limits on uploading to servers or shared networks). Personal downloads and CDs are licensed for personal use. SelectaDJ copies the business's files to cloud storage, renders derived audio (stems and transitions) and caches it on kiosks, so who needs which copying licence is the central open legal question.

**United States, briefly.** Venues license public performance from the performing rights organisations: ASCAP, BMI and SESAC, and GMR for its smaller invitation-only catalogue. Fees for bars and restaurants depend on capacity and live versus recorded music; small venues commonly report a few hundred dollars a year per PRO. Some business-music services include these fees; SelectaDJ does not.

**European Union, briefly.** Country by country through national societies (for example GEMA and GVL in Germany, SACEM in France), with fees by area, capacity or venue type. There is no EU-wide venue licence.

**What the product does** (all buildable in B0, selling off):

- **Per-venue licence attestation:** licence type per territory, number, holder, dates; plus an attestation that the business holds rights to copy and play what it uploads. A zone cannot start scheduled playback without one; expiry never stops music mid-service.
- **Expiry reminders:** 30, 14 and 3 days before; then 14 days of grace; then the zone does not start at the next opening.
- **Upload rights attestation** per upload batch; ADR-0413 takedown and repeat-infringer rules apply per organisation.
- **Play logs** per zone (title, artist, album, ISRC if known, label if known, start time UTC and local, seconds played, source, inside-transition flag), append-only, 3-year default, synced from offline kiosks; **CSV export** per venue and date range for licensing returns and audits.
- **Business terms:** the business is responsible for every licence and for rights to every track it uploads, copies and plays; SelectaDJ supplies no music; warranty and indemnity.

**Hard legal gate (Needs a person, BZ-0449-11).** A UK media and IP lawyer reviews public performance, dubbing and copying (cloud storage, renders, kiosk caches), derived audio, the business terms, play-log retention and the US and EU positions, and the owner records the outcome. **No business plan is sold until this passes.** The release-gate check refuses to turn `business.signups` on before it is ticked (BZ-0441-09). It does not block building or scouting.

### 19.9 Entitlements in one table

Full decision: [ADR-0448](../adr/adr-0448-business-entitlements-storage-seats-weight-lucy-slo.md).

| Entitlement | Business (per paid venue unless stated) |
|---|---|
| Storage | 250 GB per organisation + 50 GB per venue, pooled; derived data capped at 15% |
| Staff seats | 3 per venue, pooled; owners and admins free; then £5 each |
| Zones | 1 per venue; then £25 each |
| Processing weight | 8 inside opening hours (from 30 minutes before), 6 outside |
| Render-ahead | Up to 4 hours per open zone within a per-zone daily CPU budget |
| Analysis | 10,000 new songs a day per organisation |
| Lucy | 300 quick turns, 30 planning turns, 5 deep plans per venue per month, pooled |
| SLO | 99.9% of opening minutes without SelectaDJ-caused silence; 99.5% of transitions ready 60 s early; credits 10% per 0.1% below, capped at 50% |

### 19.10 What the owner must decide

| Decision | Options | Proposal |
|---|---|---|
| **Currency ("79 bucks")** | (a) £79 / $79 / €79, the same number everywhere (UK pays about 27% more than the US); (b) price parity: £79 / $99 / €89 | (b) parity, unless "79 bucks" meant the US price should be $79 |
| **Venue price** | £79, or a lower entry after scouting | Keep £79 for scouting; decide after the price check |
| **Zone price** | £25, or £19 to £35 | £25 (35% margin even in the worst case) |
| **Staff seat price** | £5 beyond 3 per venue, or unlimited staff | £5 |
| **Annual discount** | 2 months free (17%), or 10% like Cloud Cover, or 15% like Soundsuit | 2 months free |
| **Trial** | 14 days with card; 30 days; no trial but a pilot | 14 days with card after launch; pilots replace trials during scouting |
| **Volume tiers** | 10% at 10 to 24; Enterprise at 25+ | As proposed |
| **Pilot terms** | Free, or nominal (for example £1) under a pilot agreement | Free, with a written pilot agreement |
| **Early legal view before pilots** | Ask the lawyer before the first pilot plays in public, or only before selling | Ask early: pilots play in public too |
| **Launch market** | UK only first; US and EU later | UK only |
| **Grace and silence rule** | 14-day grace, stop at next close | As proposed |
| **Play-log retention** | 2, 3 or 6 years | 3 years (UK licensing look-back can reach 6) |
| **Who may switch selling on** | Owner only | Owner only, after the legal gate and Stripe staging run |

### 19.11 ADRs and checklist

| ADR | Title | Sub-chapter |
|---|---|---|
| [0441](../adr/adr-0441-business-goal-boundary-and-pricing.md) | Goal, product boundary and pricing model | 19 |
| 0442 to 0446 | Organisations and zones, zone sessions, opening hours, kiosks, offline playback | [19a](19a-venue-operations.md) |
| [0447](../adr/adr-0447-business-billing-quantities-vat-and-dunning.md) | Business billing: Stripe quantities, invoices, B2B VAT, dunning without silence | 19 |
| [0448](../adr/adr-0448-business-entitlements-storage-seats-weight-lucy-slo.md) | Business entitlements: pooled storage, seats, processing weight, Lucy, SLO | 19 |
| [0449](../adr/adr-0449-public-performance-licensing-and-play-logs.md) | Public performance licensing: attestation, play logs and business terms | 19 |
| 0450 to 0454 | Content controls, Rooms for Business, roles and SSO, UI, edge cases and testing | [19b](19b-business-experience.md) |

Progress: [docs/adr/selecta-business-implementation-checklist.md](../adr/selecta-business-implementation-checklist.md).

---

[← 18-test-plan.md](18-test-plan.md) · [Contents](README.md#chapters) · [19a-venue-operations.md →](19a-venue-operations.md)
