---
id: T-20261126-9223
title: Confirm the hosted daily caps (transition minutes per plan, analysis per day)
area: billing
status: open
priority: high
who: owner
created: 2026-11-26
source: hosted gaps, walkthrough section 11
commit:
---

selecta/hosted_caps.py holds the numbers in one place. Transitions a day: Free 20 minutes (at most 0.08 dollars a day at the cpu-heavy 0.24 dollars an hour), Standard 60 minutes (0.24), Premium 3 hours (0.72); analysis keeps the plan's analysis_songs_per_day (Free 150, Standard 1,500, Premium 5,000; at 0.002 to 0.006 dollars a song, at most 0.90, 9 and 30 dollars a day). Default if you do nothing: these numbers stay. To change one, edit TRANSITION_SECONDS_PER_DAY; the cloud.hosted_caps flag turns the caps off.
