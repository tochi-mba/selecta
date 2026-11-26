---
id: T-20261126-acdf
title: Listen to loop room and tempo bridge
area: local-app
status: open
priority: normal
who: owner
created: 2026-11-26
source: Transition craft II (One brain phase 8), feat/one-brain-5
commit:
---

Two new moves are built and off (move.loop_room, move.tempo_bridge) until you have heard them. On the Desktop, in the repo: (1) uv run selecta move-trial loop_room --register and uv run selecta move-trial tempo_bridge --register. Each finds up to 6 pairs in your library where the planner would now pick the new move, renders each pair twice with the same 12 s before and 16 s after (once with the move on, once with what the planner picks without it), writes the WAVs under your home folder's move-trials folder and adds them to the blind listening study (loop_room-trial, tempo_bridge-trial). (2) Grade them in the Workshop's Blind listening study. (3) uv run selecta listening-report loop_room-trial (and tempo_bridge-trial). To hear one pair directly: SELECTA_FLAGS=+move.loop_room uv run selecta mix A B --style loop_room. Listen for: the loop joins (any click or stutter on the bar line), whether the repeats feel like a held groove or a stuck record, whether the bridge's 16 stripped bars feel like a breakdown or a hole, and whether the tempo walk is audible. Turn a flag on by default only if its reel rates up; the rankings in planner_core/choose.py (LOOP_ROOM_FIT, TEMPO_BRIDGE_FIT) are guesses until then.
