# Worth paying for: what makes a visitor feel SelectaDJ is worth buying

*Research for the owner, 26 November 2026. Three research tracks ran in parallel: the psychology of buying (about 50 papers and meta-analyses), the craft of SaaS and consumer-subscription conversion (RevenueCat, ChartMogul, ProfitWell, NN/g, Baymard, UK law firms on the DMCC Act), and the music and DJ market (about 15 competitors, reviews, forums and press). Then each finding was checked against what a visitor meets in SelectaDJ today, file by file.*

**How to read the evidence.** Each claim carries its source. "Vendor" means a company that sells conversion or billing tools published the figure about its own customers: useful for direction, not for targets. "[mem]" marks a classic paper cited from the researcher's memory and not re-opened this session. Several famous effects come from papers co-authored by Dan Ariely; those used here are not known to be affected by the data problems in some of his other work, but independent replications matter more than usual for them, and they are noted. RevenueCat studies mobile apps and ChartMogul surveys mostly B2B products; SelectaDJ is a consumer web app, so treat their numbers as direction.

---

## 1. The short answer

A person looks at a product and thinks "I'd pay for that" when four things happen before they are asked for money:

1. **They recognise their own job in it.** Not a feature list: the thing they are trying to get done. For SelectaDJ that is "host the night without babysitting the laptop" and "make my own music feel new".
2. **They feel the result, early.** The first session is the sale. About half of paid subscription conversions happen on day 0, and people remember an experience by its best moment and its ending.
3. **They can see real work being done for them.** Visible, honest effort raises perceived value, most of all when quality is hard to judge, which is exactly the case with music analysis.
4. **Trying it feels safe.** A clear price with nothing added at checkout, real cancellation, fair refunds, and a price that is compared with a night out or a hired DJ rather than with other apps.

Everything below is the evidence for those four, then what it means for SelectaDJ (section 6) and a ranked list of changes filed as to-do items (section 7).

---

## 2. What a visitor meets in SelectaDJ today

| Surface | File | What it does now | Gap the research points at |
|---|---|---|---|
| Landing page | `web/src/cloud/Welcome.tsx` | Headline "Your music, mixed seamlessly.", a drawn blend (`BlendArt`), three benefits, three steps, Sign in / Create account. By design: no screenshot, no price, no quote. | **No sound.** An audio product nobody can hear before making an account. No price shown. |
| Plan cards | `web/src/cloud/Billing.tsx` | Standard "More from Lucy", Premium "Rooms and Lucy Advanced". Lucy described by level (`LUCY_LEVEL_WORDS`, ADR-0484 and ADR-0485). Standard and Monthly preselected. | Sells allowances, not the job. "Devices" is identical on both paid plans. The fallback words in `LOCAL_FIRST_AXES` still said "400 turns" and named models (fixed on this branch). |
| Checkout consent | `Billing.tsx` `ConsentForm` | Three UK consent ticks (terms, immediate start, cancellation right). | Legally needed. Says "change or cancel at any time" but not how, and nothing on refunds. VAT wording waits on the owner (T-20261124-8c73). |
| Rooms for Free | `web/src/cloud/CloudApp.tsx` `RoomsCard` | Locked card: "Rooms are part of Premium", button "Explore Premium". | Nobody can feel a Room before paying. |
| Why a blend worked | `web/src/views/Now.tsx` `WhyThisTransition` | A "Why this transition?" details element, folded shut, flag `listen.why_transition`. | Already built and rare in the market, but hidden. |
| Room recap | `web/src/rooms/RoomRecap.tsx` | End-of-room recap. | A pattern the first listen could reuse. |
| One-off purchases | `docs/saas/08-billing.md` Lucy packs | Stripe payment mode, prepaid, refundable for 14 days. | The same path could sell a party pass if the owner wants one. |
| First run | ADR-0141 | Honest readiness labels; first play at six mix-ready songs; time to first sound measured only by a person-run study (MI-0141-08). | Shows counts, not findings. |
| Renewal reminders | `08-billing.md` | Stripe upcoming-renewal reminders on for yearly prices. | Monthly reminders will be wanted under the UK subscription rules. |
| Guest page | `web/src/guest/main.ts` | SelectaDJ brandline; "What SelectaDJ keeps". | No invitation for a guest who might host next. |

---

## 3. The psychology of "I'd pay for that"

### 3.1 Perceived value and the pain of paying

- **Value and fit drive actual purchase.** A 2025 study of SaaS users (Information Systems and e-Business Management) found perceived value and satisfaction shape both the intention to pay and real purchases, moderated by price consciousness, with the fit between value and the user's needs playing a deciding role. A 2023 study of 2,195 respondents on SaaS lifetime deals found human support, refund options, regular updates and perceived trust all raise purchase intent.
- **Paying hurts, less when it is decoupled from each use.** Prelec and Loewenstein (1998, Marketing Science) predict people prefer flat-rate pricing even when it costs more; their model fit 60% of subjects against 29% for standard discounting. Knutson et al. (2007, Neuron) found brain activity linked to a product's appeal and to its price predicted buying beyond self-report; an excessive price raised insula activity, which predicted not buying (small 2007 fMRI sample: supporting evidence, not proof).
- **Flat-rate bias.** Lambrecht and Skiera (2006, JMR): people over-buy flat rates more often and more persistently than the reverse, and it did not raise churn; pay-per-use customers who would have saved on a flat rate churned more.
- **Mental accounting** (Thaler 1985): spending is sorted into budgets. A party has a budget; apps have another.
- **Price as a quality signal.** Shiv, Carmon and Ariely (2005, JMR): people who drank a discounted energy drink solved fewer puzzles. Völckner and Hofmann's meta-analysis (2007) found the price-quality link has weakened over time and is weaker for services. A price far below the band reads as a toy.
- **The zero-price effect.** Shampanier, Mazar and Ariely (2007): cutting both chocolates by one cent so one became free moved its share from about 27% to 69% [mem]. Free is a category, not a low price.
- **Pennies a day.** Gourville (1998, JCR): restating a small price as a daily amount makes it feel smaller; the effect flips for large totals.

**For SelectaDJ.** Keep plans flat (no meter running on party night). Compare Premium with the party budget, not the apps budget. Show "about 23p a day" beside the Standard price, never instead of it. Make Free do the core job well, so upgrading means getting more, not unlocking something broken. Never use a fake "was" price (unlawful in the UK).

### 3.2 Loss, ownership and effort

- **Endowment and loss aversion** are real but context-dependent. Gal and Rucker (2018, JCP) argue losses do not, on balance, loom larger than gains, and attribute many endowment results to inertia.
- **Trial length.** Yoganarasimhan, Barzegary and Pani (2023, Management Science) randomised 7, 14 and 30-day trials at a software company: 7 days was best for acquisition, retention and profit (about +5.6% subscriptions), while experienced users did better with longer trials. No peer-reviewed evidence was found on reverse trials; their numbers are practitioner or vendor claims.
- **IKEA effect.** Norton, Mochon and Ariely (2012, JCP): people value what they helped build well above an identical ready-made item, but only when the building succeeds. The mechanism is feeling competent.

**For SelectaDJ.** Ratings, pinned links and named crates should visibly improve the next mix, because the IKEA effect needs success. On downgrade or cancel, keep the analysis and ratings and let members export them. "Cancel and lose your analysed library" would be holding their work hostage.

### 3.3 Showing the work (the labor illusion)

- **Buell and Norton (2011, Management Science, five experiments):** people preferred a travel or dating site that showed its work over one giving an identical result instantly, through perceived effort and the reciprocity it triggers.
- **Buell, Kim and Tsay (2017, Management Science):** when cooks and diners could see each other, customer-rated quality rose 22.2% and throughput time fell 19.2%. A related study found the same for trust in government services (Buell, Porter and Norton 2021).
- **Boundaries** (from the abstract and secondary summaries; the full text could not be opened): the effect fades with excessive waits, and transparency backfires when it exposes sloppy work. The related effort heuristic is strongest when quality is hard to judge [mem].

**For SelectaDJ.** This is the most SelectaDJ-shaped finding in the whole report. The product already measures things nobody can see: key, tempo, phrase, vocals, lyric links. Show them as they are found ("124 BPM, key 8A, phrase at bar 33", "lyric link: fire to burning"), and say why each blend worked. Never fake a delay on a cached result, never show retries as progress, and never add a wait during a live room: show the work in setup, not on the dance floor.

### 3.4 First impressions, looks and credibility

- **Snap judgements.** Lindgaard et al. (2006): visual appeal rated after 50 ms correlated highly with ratings after 500 ms.
- **Aesthetic-usability effect.** Kurosu and Kashimura (1995) and Tractinsky et al. (2000): better-looking interfaces are rated easier to use. NN/g: good looks forgive minor problems, not major ones.
- **Credibility.** Fogg et al. (Stanford and Consumer WebWatch, 2002, 2,684 people): "design look" was the most common factor in credibility comments (46.1%). Stanford's guidelines add that ease of use and usefulness win credibility too.
- **Processing fluency** (Reber, Schwarz and Winkielman 2004) [mem]: what is easy to process feels truer and nicer.

**For SelectaDJ.** What reads as expensive and trustworthy: restraint, consistency, sharp type, real product visuals, a visible company identity and a clear price. And for an audio product, the craft is the audio: a clashing drop at a party will not be forgiven by any amount of polish.

### 3.5 Anchors, decoys, the middle option and defaults

- **Decoys mostly fail to replicate.** Frederick, Lee and Baskin (2014, JMR) found no attraction effect in 19 studies with realistic stimuli; Yang and Lynn found 11 reliable effects in 91 attempts. Don't design around a decoy tier.
- **The compromise effect** (Simonson 1989) [mem] is more robust: people drift to the middle. Standard should be a genuinely good middle.
- **Choice overload is weak overall.** Iyengar and Lepper's jam study (2000: 30% bought from 6 jams vs 3% from 24) [mem]; Scheibehenne et al.'s meta-analysis (2010, 63 conditions, N=5,036) found a mean effect near zero with large variation; Chernev et al. (2015) found real effects when choices are complex or preferences unclear. Three tiers and one recommended vibe beat twenty sliders.
- **Defaults** are strong (Jachimowicz et al. 2019, d=0.68 across 58 studies) but nudge effects shrink once publication bias is corrected (Maier et al. 2022, PNAS). Default to smart transitions on. Never pre-tick an add-on or preselect annual without showing it.
- **ProfitWell (vendor):** adding tiers shows no clear pattern on conversion; one to three tiers plus an upgrade path keeps conversion and nearly doubles revenue per user. Anchoring steers which tier people choose, not whether they buy.

### 3.6 How a first session is remembered

- **Peak-end rule.** Kahneman et al. (1993): about 69% chose to repeat a longer cold-water trial because it ended less painfully [mem]. Alaybek et al.'s meta-analysis (2022, OBHDP): r=0.58 across 174 effect sizes, with duration largely ignored.
- **Goal gradient.** Kivetz, Urminsky and Zheng (2006, JMR): people speed up near a goal; a 12-stamp card with 2 bonus stamps was completed faster than a 10-stamp card.
- **Endowed progress.** Nunes and Drèze (2006): cards with 2 stamps pre-filled were completed more often [mem]. Only with real progress.
- **Zeigarnik.** Ghibellini and Meier's meta-analysis (2025): no memory advantage for unfinished tasks, but a reliable urge to go back and finish them.

**For SelectaDJ.** Engineer the first session's peak: one "how did it do that" blend from the member's own songs. End on a recap (best moment, links found), not a paywall. Offer "Resume your half-built set", never nag.

### 3.7 Identity, status and hosting

- **Subtle signals.** Berger and Ward (2010, JCR): insiders prefer subtle signals, especially in public, identity-relevant consumption.
- **STEPPS** (Berger, Contagious, 2013; a framework, not one tested model): social currency, triggers, emotion, public, practical value, stories.

**For SelectaDJ.** Hosting is public and reflects on the host. Rooms give the host credit and the guests agency, since their requests really play. A small, tasteful "mixed with SelectaDJ" on the guest page and a shareable best-blend card from the night fit; forcing guests to sign up or harvesting their data does not.

### 3.8 Trust and lowering the risk

- **Risk reversal works.** Janakiraman, Syrdal and Freling's meta-analysis of return-policy leniency (2016, Journal of Retailing): lenient policies raise purchases more than returns; leniency on money and effort raises purchases, and longer windows reduce returns.
- **Social proof is weaker than its fame.** Goldstein, Cialdini and Griskevicius (2008): 44.1% towel reuse with a "most guests" message vs 35.1%; Bohner and Schlüter (2014) found it may not be robust. Use only real numbers; fake reviews are banned in the UK.
- **Honest limits build trust:** "files you own only", "Lucy can be wrong about lyrics".

### 3.9 Habit and staying subscribed

- **Hook model** (Eyal): trigger, action, variable reward, investment. Thin evidence for the model itself. Habits form through repetition in a stable context (Lally et al. 2010, median 66 days) [mem].
- **Self-determination theory.** Ryan, Rigby and Przybylski (2006): autonomy, competence and relatedness drive enjoyment and continued play. In SelectaDJ terms: override any blend (autonomy), learn why a key change works (competence), Rooms (relatedness). The natural variable reward is the surprising link Lucy finds in the member's own library.
- **Auto-renew traps cost subscribers.** Miller, Sahni and Strulov-Shlain (Stanford field experiment with a newspaper): offering an auto-renewing contract scared off 24 to 36% of potential subscribers; two years later there were 10% fewer subscribers, and revenue matched the auto-cancel option after a year. People who pay without using are a liability, not retention.
- **Churn reasons.** Deloitte 2025: 24% cancelled and resubscribed within six months; almost 60% would cancel a favourite service over a $5 rise.

### 3.10 Kano and Jobs to be Done

- **Kano** (1984): must-be, performance and delighter qualities (that delighters decay into must-haves is weakly supported). For SelectaDJ: must-be is no dead air, clean blends, works on party wifi; performance is blend quality and analysis speed; delighters are lyric links, guest requests and Lucy.
- **Jobs to be Done** (Christensen et al. 2016, HBR): people "hire" a product for a job; the milkshake was hired for a boring commute. Write the landing page around the job.

### 3.11 The ethical line

- **Dark patterns are common.** Mathur et al. (2019, CSCW) crawled about 11,000 shopping sites: 1,818 dark-pattern instances on 11.1% of them, 183 sites outright deceptive. Gray et al. (2018, CHI) name nagging, obstruction, sneaking, interface interference and forced action.
- **Mild manipulation works quietly.** Luguri and Strahilevitz (2021): acceptance 11% (control), 26% (mild dark patterns), 42% (aggressive); only the aggressive ones caused a backlash, and less-educated people were more susceptible to the mild ones. That is why regulators now target them.
- **UK.** The DMCC Act's unfair-practice rules apply since April 2025, with CMA fines up to 10% of global turnover; fake reviews and drip pricing are banned. **US.** The FTC click-to-cancel rule was vacated in July 2025; a new rulemaking began in 2026; ROSCA and state laws still apply.

---

## 4. The craft: what the best subscription products do

### 4.1 The first ten seconds

- NN/g: the first 10 seconds decide whether a visitor stays; the value proposition must be clear in them. People who stay past about 30 seconds tend to stay two minutes or more.
- **Letting people in before an account costs nothing.** ChartMogul and ProductLed (2026, 200 B2B products, self-reported), per 1,000 visitors: ungated freemium 70 sign-ups and 5.6 payers; gated freemium 90 sign-ups and 5 payers.
- Interactive demos (vendor, Navattic, about 28,000 demos): top 1% get 84.4% of viewers past step 1. Vendor definitions differ, so these are not comparable across tools.
- **Moises,** the nearest audio product, leads with "The Creative Suite for Musicians", "Start creating", a direct link to the web app and "Trusted by +80 million artists". Its hero has no audio demo: a gap a DJ product can take.

### 4.2 Time to value

- Userpilot (vendor, 2025): median SaaS time to value about 1 day 12 hours (from only 62 of 547 companies).
- **Consumer subscriptions are front-loaded.** RevenueCat 2026 (vendor, 115,000+ apps): about 50% of paid conversions happen on day 0; 55.4% of 3-day-trial cancellations happen on day 0 and 84% by day 1; over 80% of trial starts were on day 0 in 2025.
- Famous "magic moments" (secondary sources, folklore-grade): Slack's 2,000 messages, Facebook's 7 friends in 10 days, Dropbox's one file in one folder.

**For SelectaDJ.** The magic moment is the first blend that makes someone say "ooh", and it should arrive within about a minute of landing. For hosts, it is a guest's request landing in the queue live.

### 4.3 Free, freemium, trial, reverse trial, hard paywall

| Model | Evidence (mostly vendor) |
|---|---|
| Hard paywall | RevenueCat 2026: day-35 conversion 10.7% (12.1% in 2025); revenue per install at day 60 $3.09. Refunds 5.8% vs 3.4% for freemium (2025, secondary). |
| Freemium | RevenueCat 2026: 2.1% at day 35; $0.38 per install. ChartMogul: 3 to 5% good, 8 to 12% great. Elena Verna: freemium tops out near 5% even for the best. |
| Trial, card required | ChartMogul: 25 to 35% good, 50 to 60% great; but far fewer sign-ups (35 per 1,000 visitors vs 90). First Page Sage via Userpilot: 48.8% vs 18.2% opt-in. |
| Trial length | RevenueCat 2026: 17 to 32 day trials 42.5% median vs 25.5% under 4 days; yet 46.5% of apps use trials under 4 days. The randomised study in 3.2 found 7 days best for one software company. |
| Reverse trial | Everyone starts on the paid tier with no card, then drops to Free. Verna reports +10 to 40% (her experience, not a study). ChartMogul: 4 to 6% good, 8 to 12% great (small sample). Risk: if onboarding does not expose the premium value, it collapses into a worse free trial. |
| Duolingo | A "strict guardrail" not to degrade the free experience; earns by making Super richer and trials longer. Replacing Hearts (penalty) with Energy (reward) lifted daily users and conversion (Q2 2025 letter). |

**For SelectaDJ.** Parties are episodic, so a 7-day clock can expire before the party. A generous Free tier plus a Premium taste measured in events (one room, one party) fits better than a calendar trial. The owner decides the model (T-20261126-528f).

### 4.4 The pricing page

- **Value metric.** Patrick Campbell (ProfitWell, via Lenny's Newsletter): companies pricing on a value metric grow about twice as fast with half the churn. Keep annual discounts at or under about 20%; deeper discounts convert but correlate with churn.
- **Which tier to highlight.** A practitioner interview on RevenueCat: highlighting "Most popular" beat highlighting the cheapest. Of 200 SaaS sites, 71% highlight a recommended tier, 41% the middle one. Claims like "four tiers to three lifts conversion 27%" are second-hand and unverified.
- **Show the price.** NN/g: hiding prices introduces hostility.
- **UK law.** Drip-pricing rules since 6 April 2025: headline prices include unavoidable charges, VAT included. Show the yearly total and the monthly equivalent.
- **Price before product.** Madhavan Ramanujam (Monetizing Innovation): hold willingness-to-pay conversations before building, rank features by what people would pay, and treat a near-100% win rate with no pushback as underpricing.
- **Split tiers by user type,** not checklists: home listener, regular host, gigging or venue use.

### 4.5 Upgrade moments

- Superwall (vendor): JourneyStamp's context-specific paywalls lifted conversion 50% to 7.3%. RevenueCat (vendor, unnamed app): trial opt-in 2% after onboarding, 8% before, 15% with a three-screen value carousel first.
- **Practice:** show the upgrade at the moment of desire, let people experience the paid thing once, no penalty for saying no. Track paywall views against conversions, because a paywall shown too often reads as spam.

### 4.6 Craft as a value signal

- **Speed.** Superhuman: 100 ms maximum for any interaction, aiming under 50 ms (the 100 ms rule is Paul Buchheit's). The Doherty threshold is 400 ms (a heuristic). Google's Interaction to Next Paint: 200 ms or less at the 75th percentile is "good". Past 400 ms, show partial results or skeletons, not spinners.
- **Quality pulls.** Karri Saarinen (Linear): quality pulls customers in so marketing does not have to push; Linear says it passed 10,000 paying customers with effectively no marketing (its own claim).
- **Measure must-have.** Superhuman's survey: "How would you feel if you could no longer use it?"; 40% or more "very disappointed" signals product-market fit. Superhuman started at 22% and segmented toward its most demanding users.
- **Polish everywhere,** not only on the landing page: empty states, loading states, honest errors ("blends are best with tracks that have a clear beat").

### 4.7 Trust signals and UK subscription rules

- **Honest trials.** Blinkist's trial timeline with a reminder before any charge reported +23% conversion and 55% fewer complaints (Blinkist via RevenueCat). Replications are mixed: one saw 23 to 25% more trial starts with no conversion drop; another saw 54% more starts but worse retention.
- **DMCC Act subscription regime.** Law-firm notes from September and October 2026 say January 2027, after earlier dates of spring 2026, autumn 2026 and spring 2027; secondary legislation and CMA guidance were still pending in October. It covers auto-renewing plans and trials that roll into paid: key information before the contract, reminder notices on a durable medium (email counts), an easy online exit where sign-up was online, a 14-day cooling-off period and a renewal cooling-off. The 2024 proposals put monthly-plan reminders before the 6th payment and every 6 after; final timing unconfirmed.
- **Fake urgency backfires.** Moises's homepage once showed a "50% off, ends in 00d00h00m" timer that had already run out.

### 4.8 Retention

- **Why people cancel** (RevenueCat, sample not stated): too little use 37%, cost 35%, a better alternative 10%, technical problems 7%. YouGov (US, 2025): 66% cancel because services cost too much.
- **Pause before cancel** (Recurly, vendor): most pausers return, with figures from about three in four to 65% within three months depending on the source. Forrester: two thirds of US online adults wish they could pause.
- **Annual plans** (RevenueCat 2026): 95% of cancelled annual subscribers never return; monthly ones come back at four times the rate; 35% of annual cancellations happen in month 1.
- **AI apps** (RevenueCat 2026): 41% more year-1 revenue per user, but monthly plans retain 36% worse. Lucy can help sell SelectaDJ; she should not be the only reason to stay.
- **Recurring value for SelectaDJ:** new blend styles, a recap after each room, saved set history, and a seasonal pause ("pause until December").

### 4.9 Phones, TVs and checkout

- **TV** (Apple tvOS talk): a 3-click subscription converted 61%, 4 clicks 48%, 9 clicks 7%. Never make people type on a TV; finish payment on the phone by QR.
- **Web vs app store** (RevenueCat controlled test, one app): in-app checkout converted 27.0% vs 18.1% on the web, while web trial-to-paid was slightly higher and web kept 93 cents per in-app dollar after fees.
- **For SelectaDJ:** on phones, wallet payment and one plan shown first; on desktop, the full comparison; on a TV, a QR to finish on the phone. Guests never see a paywall.

### 4.10 What makes people say "no way"

- **Surprise costs at checkout** (Baymard: 39 to 48% abandon over extra costs; about 24% over forced account creation, secondary).
- **Ads in a paid tier** (Prime Video UK, 2024, drew a class action, later dismissed).
- **Filler AI.** CNET and YouGov (2025): 50% of US smartphone owners would not pay extra for AI features, about 3% would. Other surveys disagree with different wording.
- **Subscription fatigue** (Capterra 2023: 44% tired; Motley Fool: 57% feel they overpay).
- **Retroactive gating:** taking away something people used free (a Moises review, one anecdote, the classic "ransom" feeling).
- **Hard-to-cancel flows,** now a CMA priority.
- **A subscription where a one-off fits:** occasional hosts may want a party pass.

---

## 5. The music and DJ market

### 5.1 Competitors

| Product | Price model | Audience | How it sells | Praise | Complaint |
|---|---|---|---|---|---|
| Algoriddim djay Pro | Free plus PRO about $6.99/month or $49.99/year; Automix in PRO; no perpetual | Hobbyists, Apple users | "AI Mixer", Automix, Neural Mix stems | Stem quality, ease, cross-device | Subscription for features once bought; free play limit; owned files flagged as DRM; Automix exits unreliable |
| Serato DJ Pro | $11.99/month or $299 once | Aspiring to pro | Buy or rent | Can buy outright | Costs stack with streaming and DJ pools |
| rekordbox | Subscription only, about $120 to $360/year, free tier | Club ecosystem | Booth compatibility | | 2020 move to subscription; older controllers needed a subscription for v7 (2025); an outage auto-cancelled plans; encrypted database read as lock-in |
| VirtualDJ | Free Home; Pro about $19/month or $299 | Everyone, mobile and wedding DJs | 2026 AI features | Free to try | AI features add "little value" (Gearnews) |
| Traktor Pro 4 | $149 perpetual | Aspiring to pro | Ownership | You own it | Paying again for majors |
| DJ.Studio | Perpetual from about $119; no-card trial that does not auto-convert; no-questions refund | Mix creators | "Pay once, create mixes forever", timeline | Value against Serato and rekordbox | Mixes lost when the trial ends |
| Mixxx | Free, open source, Auto DJ | Budget hobbyists | Free | Good for free | Auto DJ basic and crossfade-led |
| Fadr | Free basic; Plus $10/month | Creators | All-in-one AI in the browser | Generous free tier | New stems need a subscription |
| Moises | Freemium; Premium about $5.99/month (sources conflict) | Musicians practising | Practice tools | | Billing and cancellation complaints |
| Spotify Mix, AI DJ, Jam | In Premium, £12.99/month UK since November 2025 | Everyone | Mixes by big-name DJs; Jam shared queue | "Pretending I'm the world's best DJ" (TechRadar) | AI DJ loops about 20 songs; Jam needs a Premium host |
| Apple Music AutoMix (iOS 26) | In Apple Music | Everyone | Keynote blend | Works "surprisingly well" (Applesfera) | Cuts endings, skips first verses, odd pairings; catalogue songs only, not your own files (Tom's Guide) |
| Offtrack | Free app, premium unverified; claims 850k installs, 80M songs mixed | Casual listeners | "The AI DJ app in your pocket" | Hands-off flow | Depends on Spotify, TIDAL, SoundCloud; now sells a B2B API |
| Pacemaker, Serato Pyro, Jukestar (dead) | | Casual hosts | Auto-mixed streaming | Pioneered the category | Died when Spotify changed its rules |
| Party request apps (Rekwest, BeatTribe, DJfy, EasySongCue) | Free to €29 per party to $7/month | Hosts, working DJs | No app or account for guests, tips | Speed | Every one found routes through a streaming service; none serves a host's own files |

**The pattern.** Consumer auto-DJ products either died when Spotify changed its terms or moved to selling to businesses. Free consumer auto-mixing has been hard to charge for, so the paid reason has to be something streaming cannot do.

### 5.2 What people say

**When it works:** "seamless", "smooth", "like a DJ", "set the vibe", intro points "pretty much on point". The love is about flow and about not babysitting the music. A djay user switched because dancers want a clear start and finish to each track.

**What breaks the spell:**
1. Songs cut short, endings lost.
2. Intros and first verses skipped.
3. Random or clashing pairings (heise: Kate Bush into Limp Bizkit).
4. Mixing out over vocals.
5. Tempo drift on big BPM jumps.
6. Works only on four-to-the-floor dance music.
7. Repetition (Spotify AI DJ's loop; people want permanent exclusions).
8. Glitches and dropouts.
9. Requests that ruin the vibe; an unattended laptop invites guests to take over; DJs rarely play requests that don't fit.
10. Platform rug-pulls.
11. Paywall surprises and free features moved behind the paywall.

**Sceptics:** a venue gave poor feedback to a substitute DJ who leaned on automix; Berlin's club scene is divided, though small bars and low-budget parties are named as places an automatic DJ could work.

### 5.3 Subscriptions in music software

- **Paid happily:** Spotify Premium (UK streaming subscriptions passed £2bn in 2025 even after rises); about £7/month for djay among users who see features keep arriving.
- **Resented:** paying for nothing between updates, losing access to their own work, lock-in, hardware suddenly needing a subscription, billing outages, totals that end up above a one-off price.
- **Preferred:** a choice of buy or rent (Serato); perpetual with paid updates (DJ.Studio, Traktor); rent-to-own (Splice, called an "excellent middle ground" by DJ Mag).
- **Fair-feeling prices:** one-off $149 to $300; subscriptions $7 to $12 a month.
- **Event tools sell per event or pay for themselves** (DJfy €29 per party; request apps with guest tips).
- **The Spotify comparison:** Standard at £6.99 matches djay Pro. Premium at £12.99 is exactly Spotify Premium's UK price, so visitors will compare a DJ for their own files with all the music in the world (T-20261126-e3bb).

### 5.4 Who would buy, and for what job

| Persona | Job | Would pay for | Likely model |
|---|---|---|---|
| House party host | Keep the music great so I can host, not babysit a laptop | Rooms, no dead air, approve or veto requests, an energy arc to a peak time | Per-party pass or Premium; no licence needed at home in the UK |
| Bar, cafe or shop | Fitting background music, legal, no staff fiddling | Scheduled arcs, explicit filter, licence guidance, reliability | Business tier plus TheMusicLicence (from about £235.50 + VAT a year for a small shop) |
| DIY wedding or event | Skip the DJ fee without a dead floor | Lucy planning each part of the day, requests collected in advance | One-off event pass |
| Collector of owned music | Rediscover what I own, mixed well | Library intelligence, lossless playback, lyric links, privacy, no lock-in | Annual or lifetime; most hostile to subscriptions |
| Bedroom DJ learner | Understand why mixes work | Explanations per blend, a practice mode | Standard; compares with djay and free Mixxx |
| Runner or gym | Steady tempo, no gaps | Tempo arcs | Low willingness to pay |
| Dinner or background | Pleasant flow | Little | Free |

**Demand signals:** UK download sales £39.9m in 2025 (down 3.5%): a shrinking but real niche. UK vinyl up about 18.5 to 19.9%. Bandcamp Fridays paid $19m in 2025. An "ownership" mood among Gen Z is widely covered. Market-size reports for DJ software are low quality.

### 5.5 Licensing and trust

- Home parties: PRS makes no charge for functions of a purely domestic or family nature. Hired halls or marquees may need a licence. Shops, bars and cafes need TheMusicLicence even when they own every track.
- A browser app that analyses files locally and lets members export their data has a real trust advantage over encrypted, locked databases. Claim it only where true.

### 5.6 What nobody else does

1. Auto-mixing **your own files** with **guest requests from the same library**, no app or account for guests.
2. Mainstream automix that works on owned files (Apple AutoMix does not; Spotify Mix is streaming only).
3. **Explaining why a blend worked.** Not found anywhere.
4. **Lyric wordplay links** between songs. Not found anywhere.
5. Steering without faders, between full auto and full manual.
6. Durability no partner can switch off.
7. Clear licensing guidance for small venues on their own files.
8. Per-event pricing inside an auto DJ.

### 5.7 How audio products prove themselves before purchase

- **"Hear it on your own track":** LANDR previews a master of your own song free with no sign-up and charges to download. The benchmark pattern.
- Big names (Spotify Mix), one polished keynote blend (Apple), usage counters (Offtrack's "80 million songs mixed"), low-risk trials (DJ.Studio).
- On-page audio plays only when pressed, never autoplays.
- Sharing clips of commercial songs publicly raises copyright questions: share the blend card and track list, keep the audio private.

---

## 6. What this means for SelectaDJ

1. **Lead with the job, in the hero.** "Your party, handled, with your own music" for hosts; "make your own music feel new" for collectors. Features follow.
2. **Let them hear it on their own songs, without an account.** This is the single biggest gap (Welcome.tsx has no sound) and the strongest pattern in the research.
3. **Make the intelligence visible.** SelectaDJ measures what nobody else shows. Every blend can say why it worked, and first run can show findings, not counts. This answers "a real person is better" and feeds the learner.
4. **Promise against the spell-breakers by name, only where the planner guarantees them.**
5. **Sell Premium as hosting, not allowances:** "Guests request, you stay in charge." Requests come only from the host's library and fit the energy arc.
6. **Let a Free host feel one Room,** in whichever model the owner chooses.
7. **Price honestly and visibly:** VAT included, yearly total shown, per-day figure beside, compared with the party budget. Decide Premium against Spotify's £12.99.
8. **Make trying safe:** clear cancellation and refunds before checkout, reminders before renewals, a pause, and the library kept on downgrade.
9. **Lead with durability and privacy:** your files, no platform can switch them off.
10. **Measure must-have before locking prices.**

### What SelectaDJ never does

- Fake countdown timers or "ends soon" banners.
- Fake reference prices ("was £20").
- Guilt-trip wording in the cancel path.
- Holding a library, ratings or mixes hostage on cancel or downgrade.
- Fake progress, fake delays, or retries shown as progress.
- Annual billing or add-ons preselected without being shown.
- A sign-up wall for guests, or guest data collected for marketing.
- Fake or unverifiable reviews and testimonials.

---

## 7. Recommendations, ranked, with their to-do items

| # | Change | Who | To-do |
|---|---|---|---|
| 1 | Hear SelectaDJ blend two of your own songs on the landing page, in the browser, no account (fallback: an A/B demo with tracks we have rights to) | Claude; owner for demo-track rights | T-20261126-e5dd |
| 2 | Show real analysis findings during first run; open Why this transition for the first blends | Claude | T-20261126-7a23 |
| 3 | Plan cards sell the job each plan does; one shared "every plan includes" line | Claude | T-20261126-2e99 |
| 4 | Decide how a Free host tries one Room (events-based reverse trial, a party pass, or neither) | Owner | T-20261126-528f |
| 5 | Decide Premium at £12.99 against Spotify Premium | Owner | T-20261126-e3bb |
| 6 | VAT-inclusive prices on the landing page, yearly total and per-day figure beside | Claude, after T-20261124-8c73 | T-20261126-012b |
| 7 | Say before checkout how cancelling and refunds work | Claude, after T-20261124-c389 | T-20261126-6a1b |
| 8 | Monthly renewal reminders and a pause option in Stripe | Owner | T-20261126-f825 |
| 9 | End the first listen on its best moment with a recap | Claude | T-20261126-aa2d |
| 10 | Name the spell-breakers SelectaDJ avoids, after checking the planner | Claude | T-20261126-fd85 |
| 11 | "Your files. No platform can switch them off." | Claude | T-20261126-3767 |
| 12 | After a guest's request lands, one quiet "Host your own night" link | Claude, after T-20261125-f0d1 | T-20261126-ec51 |
| 13 | Very-disappointed survey and willingness-to-pay talks with beta members | Owner | T-20261126-63ba |

Fixed on this branch rather than filed: the plan-card fallback words in `LOCAL_FIRST_AXES` that still said "400 turns" and named models, against ADR-0484 rule 4.

Every built recommendation gets its own `SELECTA_FLAGS` flag, and its page must still lay out properly with the flag off.

---

## Sources

### Psychology
- Buell and Norton 2011, labor illusion: https://pubsonline.informs.org/doi/10.1287/mnsc.1110.1376
- Buell, Kim and Tsay 2017, operational transparency: https://papers.ssrn.com/abstract=2449029
- Buell, Porter and Norton 2021: https://pubsonline.informs.org/doi/suppl/10.1287/msom.2020.0877
- Knutson et al. 2007: https://pubmed.ncbi.nlm.nih.gov/17196537/
- Prelec and Loewenstein 1998: https://pubsonline.informs.org/doi/fpi/10.1287/mksc.17.1.4
- Thaler 1985: https://pubsonline.informs.org/doi/10.1287/mksc.4.3.199
- Lambrecht and Skiera 2006: https://www.anderson.ucla.edu/documents/areas/fac/marketing/paying_too_much.pdf
- Shampanier, Mazar and Ariely 2007: https://pubsonline.informs.org/doi/10.1287/mksc.1060.0254
- Gourville 1998: https://ideas.repec.org/a/oup/jconrs/v24y1998i4p395-408.html
- Pennies-a-day limits: https://link.springer.com/article/10.1023/A:1025467002310
- Völckner and Hofmann 2007: https://link.springer.com/doi/10.1007/s11002-007-9013-2
- Shiv, Carmon and Ariely 2005: https://scholars.duke.edu/publication/861346
- Gal and Rucker 2018: https://papers.ssrn.com/abstract=3049660
- Norton, Mochon and Ariely 2012: https://dash.harvard.edu/bitstream/handle/1/12136084/norton%20mochon%20ariely%20third%20round[1].pdf
- Mochon, Norton and Ariely: https://dash.harvard.edu/bitstream/1/11320608/1/mochon,norton,ariely_bolstering.pdf
- Yoganarasimhan, Barzegary and Pani 2023: https://arxiv.org/abs/2006.13420
- Lindgaard et al. 2006: https://tandfonline.com/doi/abs/10.1080/01449290500330448
- Fogg et al. 2002: https://advocacy.consumerreports.org/research/how-do-people-evaluate-a-web-sites-credibility
- Stanford credibility guidelines: https://credibility.stanford.edu/guidelines
- NN/g aesthetic-usability effect: https://www.nngroup.com/articles/aesthetic-usability-effect/
- Tractinsky et al. 2000: https://mycourses.aalto.fi/pluginfile.php/1645430/mod_folder/content/0/Tractinsky%20%282000%29.pdf
- Aesthetics boundary work: https://uxpajournal.org/?p=4392
- Frederick, Lee and Baskin 2014: https://marketing.wharton.upenn.edu/wp-content/uploads/2016/10/The-Limits-of-Attraction.pdf
- Yang and Lynn: https://ecommons.cornell.edu/entities/publication/0c5b506a-f8d3-4a4c-8825-b2c715e9f956
- Scheibehenne et al. 2010: https://abcwest.cogs.indiana.edu/pmwiki/pdf/scheibehenne.options.2010.pdf
- Chernev et al. 2015: https://www.kellogg.northwestern.edu/academics-research/research/detail/2015/when-product-assortment-leads-to-choice-overload-a-conceptual/
- Jachimowicz et al. 2019: https://ideas.repec.org/a/cup/bpubpo/v3y2019i02p159-186_00.html
- Maier et al. 2022: https://pmc.ncbi.nlm.nih.gov/articles/PMC9351501
- Alaybek et al. 2022: https://ideas.repec.org/a/eee/jobhdp/v170y2022ics0749597822000334.html
- Kivetz, Urminsky and Zheng 2006: https://business.columbia.edu/sites/default/files-efs/pubfiles/1200/goalgradient.pdf
- Nunes and Drèze 2006: https://ideas.repec.org/a/oup/jconrs/v32y2006i4p504-512.html
- Ghibellini and Meier 2025: https://ideas.repec.org/a/pal/palcom/v12y2025i1d10.1057_s41599-025-05000-w.html
- Berger and Ward 2010: https://faculty.wharton.upenn.edu/wp-content/uploads/2012/04/Subtle_Signals.pdf
- Janakiraman, Syrdal and Freling 2016: https://econpapers.repec.org/RePEc:eee:jouret:v:92:y:2016:i:2:p:226-235
- Bohner and Schlüter 2014: https://pmc.ncbi.nlm.nih.gov/articles/PMC4118982
- Ryan, Rigby and Przybylski 2006: https://link.springer.com/content/pdf/10.1007%2Fs11031-006-9051-8.pdf
- Hook model critique: https://bigthink.com/?p=54491
- Deloitte digital media trends 2025: https://www.deloitte.com/us/en/insights/industry/technology/digital-media-trends-consumption-habits-survey/2025/digital-media-monitor-dashboard.html
- Miller, Sahni and Strulov-Shlain: https://gsb.stanford.edu/insights/auto-renew-snags-new-subscribers-its-not-good-way-keep-them
- Kano model review: https://flore.unifi.it/retrieve/handle/2158/795457/584482/TQMBE_post%20referaggio.pdf
- Christensen et al. 2016: https://hbr.org/2016/09/know-your-customers-jobs-to-be-done
- Mathur et al. 2019: https://arxiv.org/abs/1907.07032v2
- Gray et al. 2018: https://dl.acm.org/doi/10.1145/3173574.3174108
- Luguri and Strahilevitz 2021: https://academic.oup.com/jla/article/13/1/43/6180579
- SaaS perceived value 2025: https://ideas.repec.org/a/spr/infsem/v23y2025i2d10.1007_s10257-024-00690-2.html
- SaaS lifetime deals 2023: https://gcris.ieu.edu.tr/bitstream/20.500.14365/5083/1/5083-825817.pdf
- Cited from memory, not re-opened: Iyengar and Lepper 2000 https://doi.org/10.1037/0022-3514.79.6.995 · Kahneman et al. 1993 https://doi.org/10.1111/j.1467-9280.1993.tb00589.x · Huber, Payne and Puto 1982 https://doi.org/10.1086/208899 · Simonson 1989 https://doi.org/10.1086/209205 · Kruger et al. 2004 https://doi.org/10.1016/S0022-1031(03)00065-9 · Reber, Schwarz and Winkielman 2004 https://doi.org/10.1207/s15327957pspr0804_3 · Lally et al. 2010 https://doi.org/10.1002/ejsp.674

### Conversion, pricing and retention
- RevenueCat 2026 benchmarks: https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026
- RevenueCat State of Subscription Apps 2025: https://www.revenuecat.com/state-of-subscription-apps-2025
- RevenueCat paywalls: https://www.revenuecat.com/blog/growth/how-top-apps-approach-paywalls
- RevenueCat web vs in-app test: https://www.revenuecat.com/blog/growth/iap-vs-web-purchases-conversion-test
- RevenueCat contextual paywalls: https://www.revenuecat.com/blog/growth/contextual-paywall-targeting
- RevenueCat churn reasons: https://www.revenuecat.com/blog/growth/subscription-app-churn-reasons-how-to-fix
- Annual subscribers rarely return: https://9to5mac.com/2026/05/27/new-report-shows-annual-app-subscribers-rarely-return-after-they-cancel/
- AI apps retention: https://techcrunch.com/2026/03/10/ai-powered-apps-struggle-with-long-term-retention-new-report-shows
- ChartMogul conversion report: https://chartmogul.com/reports/saas-conversion-report/
- Userpilot trial conversion: https://userpilot.com/blog/free-trial-conversion-rate/
- Userpilot time to value: https://userpilot.com/blog/time-to-value-benchmark-report-2024
- Elena Verna on reverse trials: https://www.elenaverna.com/p/reverse-trials-examples
- Amplitude on reverse trials: https://amplitude.com/en-us/blog/reverse-trial.md
- ProfitWell tier anchoring: https://paddle.com/studios/shows/profitwell-report/price-tier-anchoring
- Patrick Campbell on pricing: https://lennysnewsletter.com/p/saas-pricing-strategy
- Hey.com pricing teardown: https://www.profitwell.com/studios/shows/pricing-page-teardown/teardown-heycom-a-bold-and-opinionated-pricing-strategy
- 200 pricing pages: https://atticusli.com/blog/posts/pricing-page-conversion-benchmark-insights-200-saas-websites/
- Price before product: https://review.firstround.com/its-price-before-product-period/
- NN/g first 10 seconds: https://www.nngroup.com/articles/how-long-do-users-stay-on-web-pages/
- NN/g show the price: https://www.nngroup.com/articles/show-price/
- Navattic demo report: https://navattic.com/report/state-of-the-interactive-product-demo-2025
- Superwall JourneyStamp: https://superwall.com/case-studies/journeystamp.md
- Superhuman product-market fit: https://review.firstround.com/how-superhuman-built-an-engine-to-find-product-market-fit
- Superhuman speed: https://blog.superhuman.com/superhuman-is-built-for-speed/
- Linear on quality: https://linear.app/now/why-is-quality-so-rare
- Karri Saarinen's rules: https://www.figma.com/blog/karri-saarinens-10-rules-for-crafting-products-that-stand-out/
- Doherty threshold: https://lawsofux.com/doherty-threshold/
- Duolingo on the free experience: https://www.customerexperiencedive.com/news/duolingo-ceo-monetize-without-degrading-free-user-experience/873877/
- Blinkist honest paywall: https://onboardme.substack.com/p/why-most-free-trials-fail-and-how-blinkist-gets-it-right
- Recurly pause and return: https://www.subscriptioninsider.com/article-type/news/recurlys-annual-state-of-subscriptions-pause-and-return-becomes-a-core-retention-lever
- Forrester on pause: https://www.forrester.com/blogs/us-consumers-want-subscription-companies-to-do-better
- Apple tvOS subscriptions: https://developer.apple.com/videos/play/tech-talks/803
- Baymard checkout abandonment: https://baymard.com/blog/cart-abandonment-rate-statistics
- Paying for AI features: https://www.emarketer.com/content/consumers-unwilling-pay-ai-features-1
- Subscription fatigue: https://www.capterra.com/resources/subscription-fatigue/
- YouGov streaming 2025: https://yougov.com/en-us/articles/53008-what-drives-americans-streaming-choices-in-2025
- Moises: https://moises.ai/

### UK and US law
- DMCC subscriptions, January 2027: https://www.lewissilkin.com/insights/2026/09/15/key-takeaways-the-subscription-shake-up-are-you-ready-for-january-2027-102o14n
- DMCC, preparing for the restrictions: https://dwfgroup.com/en/news-and-insights/insights/2026/10/dmcca-subscription-contracts-regime-preparing-for-the-new-restrictions
- DMCC brought forward: https://www.tlt.com/insights-and-events/insight/dmcc-act-subscription-contracts-regime-brought-forward-by-the-pm-what-do-businesses-need-to-know
- DMCC spring 2027 response: https://www.taylorwessing.com/en/insights-and-events/insights/2026/04/subscription-contracts
- 2024 proposals: https://www.cooley.com/news/insight/2024/2024-12-09-uk-crackdown-on-subscription-traps-government-reveals-new-proposals-for-incoming-subscription-contracts-regime-under-dmcc-act
- Drip pricing: https://www.taylorwessing.com/en/insights-and-events/insights/2025/04/dmcca-drip-pricing
- FTC click-to-cancel: https://www.jonesday.com/en/insights/2026/05/ftc-revives-clicktocancel-rule-new-risks-for-subscription-businesses

### Music and DJ market
- djay PRO: https://help.algoriddim.com/hc/en-us/articles/11269681416476-What-is-the-difference-between-the-free-version-and-the-PRO-subscription-of-djay-Pro-for-Windows
- djay Pro 5 review: https://www.digitaldjtips.com/reviews/algoriddim-djay-pro-5/
- djay Automix thread: https://community.algoriddim.com/t/my-automix-thoughts-and-open-to-yours/40059
- djay one-time pricing thread: https://community.algoriddim.com/t/add-one-time-pricing-option-for-djay/16978.md?page=2
- Serato pricing: https://serato.com/dj/pro/pricing
- rekordbox subscription issues: https://gearnews.com/alphatheta-rekordbox-subscription-issues
- rekordbox 7 controllers: https://www.digitaldjtips.com/owners-of-older-pioneer-dj-controllers-must-now-subscribe-to-use-rekordbox-7/
- rekordbox outage: https://rekordbox.com/en/2025/01/subscription-problem-caused-by-server-issues/
- VirtualDJ: https://virtualdj.com/buy/ and https://www.gearnews.com/virtualdj-2026-dj/
- Traktor: https://www.native-instruments.com/en/products/traktor/dj-software/traktor-pro-4/pricing/
- DJ.Studio: https://dj.studio/pricing
- Mixxx review: https://www.digitaldjtips.com/reviews/mixxx-2-5-1-dj-software/
- Fadr: https://fadr.com/plus
- Spotify Mix: https://www.tomsguide.com/entertainment/music-streaming/spotifys-new-mixing-feature-lets-you-dj-your-own-playlists-heres-how-it-works
- Spotify Mix review: https://www.techradar.com/audio/spotify/ive-been-using-spotify-mix-for-weeks-and-i-cant-stop-pretending-that-im-the-worlds-best-dj
- Spotify AI DJ repeats: https://community.spotify.com/t5/Live-Ideas/Make-Spotify-DJ-less-repetitive/idc-p/6948101/highlight/true
- Spotify UK price: https://www.musicbusinessworldwide.com/spotify-raises-uk-and-switzerland-premium-prices-again-as-analysts-see-us-hike-by-early-2026/
- Apple AutoMix criticism: https://bgr.com/2059450/how-to-turn-off-automix-apple-music-worst-feature and https://heise.de/-11139247
- Apple AutoMix and own files: https://www.tomsguide.com/phones/iphones/automix-gets-the-hype-in-ios-26s-music-app-but-theres-another-change-thats-even-better
- Offtrack: https://www.offtrack.com/ and https://www.prnewswire.com/news-releases/offtrack-launches-dj-as-a-service-api-to-license-ai-powered-mixing-to-every-music-platform-302742958.html
- Pacemaker: https://archive.completemusicupdate.com/article/pacemaker-dj-app-to-directly-license-music-after-spotify-drops-api-access/
- Spotify leaves djay: https://www.digitaldjtips.com/2020/03/spotify-to-stop-working-in-djay/
- Rekwest: https://apps.apple.com/us/app/rekwest-song-requests/id6468363286
- BeatTribe: https://www.capterra.com.au/software/1102134/BeatTribe
- Jukestar and Spotify: https://community.spotify.com/t5/Spotify-for-Developers/Spotify-for-3rd-party-apps-such-as-Jukestar/m-p/5426785/highlight/true
- PPL PRS: https://pplprs.co.uk/how-is-the-cost-calculated/ and https://pplprs.co.uk/help
- Splice rent-to-own: https://direct.djmag.com/tech/are-plugin-subscriptions-good-producers
- UK streaming income 2025: https://www.musicweek.com/public_html/index.php/labels/read/era-uk-music-streaming-subscription-income-tops-2-billion-in-2025-as-vinyl-sales-surge-by-18/093312
- Bandcamp Fridays: https://www.musicbusinessworldwide.com/bandcamp-fridays-hit-154m-in-payouts-since-2020-with-19m-paid-in-2025-alone
- Gen Z and subscriptions: https://fortune.com/2026/03/06/gen-z-analog-lifestyle-subscription-economy-burnout/
- LANDR free preview: https://www.landr.com/en/master
- Berlin and AI DJs: https://www.semafor.com/article/10/04/2024/berlin-club-scene-divided-over-new-ai-dj-tech
- VirtualDJ automix thread: https://virtualdj.com/forums/252170/General_Discussion/DJs_using_automix_when_playing_live_....._thoughts%3F.html
- Requests at parties: https://www.sevendaysvt.com/music/hey-burlington-djs-do-you-take-requests-27879400/ and https://www.zola.com/expert-advice/how-to-dj-your-own-wedding

**Not verified in this research:** YouTube Music, Rave and Soundverse DJ pricing; Festify's status; djay and Apple Music GBP prices; Offtrack's premium price; VirtualDJ Pro Infinity's current price; whether Spotify's consumer terms bar business use; subreddit sizes (Reddit could not be reached directly, so its voice comes through press quotes). Moises prices conflict between sources.
