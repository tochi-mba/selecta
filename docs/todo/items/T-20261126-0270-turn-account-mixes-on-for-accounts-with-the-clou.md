---
id: T-20261126-0270
title: Turn account mixes on for accounts with the cloud library
area: editor
status: open
priority: normal
who: owner
created: 2026-11-26
source: plan Phase 7, docs/engineering/engine-store-mixes.md Turning it on
commit:
---

Account mixes are built and tested for accounts with the cloud library, behind cloud.account_mixes, whose build default stays off. To turn them on: check them on a copy of your own library (My Mixes lists drafts, a draft opens in the editor, two devices follow the current mix, Undo brings the one before back). Then save the follows rule (cloud_brain/mix_current.WITH_THE_CLOUD_LIBRARY: kind follows, params flag cloud.hosted_media) as the rules of cloud.account_mixes with the console's set_rules, and add +cloud.account_mixes to the deployment's SELECTA_FLAGS. Good looks like: every account with the cloud library has account mixes and no other account does (the admin's explain for one of each says so).
