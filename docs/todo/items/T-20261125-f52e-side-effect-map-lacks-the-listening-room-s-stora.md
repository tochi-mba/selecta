---
id: T-20261125-f52e
title: Side-effect map lacks the Listening Room's storage keys
area: ci
status: open
priority: normal
who: claude
created: 2026-11-25
source: Workers page build
commit:
---

tests/test_ex_0114_side_effect_map.py::test_every_persisted_key_is_in_the_map_and_every_mapped_key_still_exists fails on feat/controller: persisted keys selecta.listeningRoom and selecta.listeningRoom.volume are not in docs/adr/selecta-experience-side-effect-map.md. Add their rows (the Listening Room's owner).
