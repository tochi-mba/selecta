"""Library + Lucy (LX) study kit: the scripts and scoring for the LX user studies.

Nineteen LX tasks close only after a study with real people (LX-0341-08, -0343-08 ... -0363-08),
and 23 more end with a short per-task study (the CARDS, triage package WP3).
This module is the code half: one protocol per task (route, made-up library from
tests/e2e_server.py, who takes part, the uncoached prompts and what counts as success), a checker
for the session records a facilitator writes, and a scorer that compares timed tasks with the
baseline. It never invents a participant or a result; an empty or unsigned record scores nothing.

    python -m selecta.audit.lx_study_kit --write   # regenerate docs/verification/lx-study-kit.md
    python -m selecta.audit.lx_study_kit --check   # exit 1 when that page is out of date
"""

from __future__ import annotations

import argparse
import re
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path

OUT = Path("docs/verification/lx-study-kit.md")
FIXTURE = "tests/e2e_server.py made-up library (python tests/e2e_server.py <port>)"
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CODE = re.compile(r"^P\d{2,3}$")  # participant codes, never names
GROUPS = {"novice", "expert"}


@dataclass(frozen=True)
class Study:
    """One uncoached study protocol for one LX task."""

    task: str
    title: str
    route: str
    groups: tuple[str, ...]
    prompts: tuple[str, ...]
    success: str
    timed: bool = False
    mobile: bool = False
    hesitation: str = ""  # per-task study cards only: what counts as hesitating
    setup: str = ""  # per-task study cards only: the state to put the fixture in first
    pilot: str = ""  # per-task study cards only: the preparation walkthrough, never a result

    @property
    def card(self) -> bool:
        """A per-task study card (WP3) also records confidence and hesitation on every outcome."""
        return bool(self.hesitation)


def _s(task, title, route, prompts, success, groups=("novice", "expert"), **kw) -> Study:
    return Study(task, title, route, groups, tuple(prompts), success, **kw)


STUDIES: tuple[Study, ...] = (
    _s(
        "LX-0341-08",
        "Overview value",
        "/library",
        [
            "Without help, say what each count at the top means.",
            "Find the song 'Same Name' by its second artist.",
        ],
        "Every count explained correctly; retrieval no slower than baseline.",
        timed=True,
    ),
    _s(
        "LX-0343-08",
        "Musical refinement",
        "/library",
        ["Find a ready song with a slow tempo.", "Find any song by its title."],
        "Experts faster than baseline; novices no slower; no hidden step needed.",
        timed=True,
    ),
    _s(
        "LX-0344-08",
        "Scan efficiency",
        "/library",
        ["In light theme find the set-aside talk.", "In dark theme find the broken file."],
        "Both themes match or beat baseline for both groups.",
        timed=True,
    ),
    _s(
        "LX-0345-08",
        "Discovery benefit",
        "/library (Card view)",
        ["Browse and pick two songs you have not heard of.", "Then find recording 10."],
        "More unfamiliar songs opened than in List view; retrieval no slower.",
        timed=True,
    ),
    _s(
        "LX-0346-08",
        "Novice meaning",
        "/library",
        ["Before pressing each row action, say what it will do."],
        "Every prediction matches what happens.",
        groups=("novice",),
    ),
    _s(
        "LX-0347-08",
        "Selection confidence",
        "/library",
        [
            "Select three songs, say how many are selected and what Set aside would change.",
            "Undo or cancel before anything changes.",
        ],
        "Scope stated correctly and cancelled with nothing changed.",
        groups=("novice",),
    ),
    _s(
        "LX-0348-08",
        "Inspector confidence",
        "/library?song=10",
        [
            "Explain which tempo is active and which was measured.",
            "Correct the tempo, then put it back.",
        ],
        "Active versus measured explained before applying; restore done unaided.",
    ),
    _s(
        "LX-0351-08",
        "Mobile journey",
        "/library on a phone, one hand",
        ["Search for a song, open that exact recording and add it to a mix."],
        "Done one-handed with no desktop step.",
        timed=True,
        mobile=True,
    ),
    _s(
        "LX-0353-08",
        "Decision confidence",
        "/mixes",
        ["You want music now: pick a way in.", "You want to plan a set: pick a way in."],
        "Each person picks the way in that fits the stated outcome.",
    ),
    _s(
        "LX-0354-08",
        "Creation continuity",
        "/mixes",
        ["Choose a mood, carry it to Lucy, then to the editor, with music playing."],
        "No lost context and no sound that was not asked for.",
    ),
    _s(
        "LX-0355-08",
        "Creator workspace",
        "/mixes/lucy/<id>",
        ["Describe the current proposal.", "Ask Lucy for a change and say what changed."],
        "Both groups explain the proposal while revising.",
        timed=True,
    ),
    _s(
        "LX-0356-08",
        "Response comprehension",
        "/mixes/lucy/<id>",
        ["Summarise what Lucy did and what is still unbuilt."],
        "Both parts summarised correctly without coaching.",
    ),
    _s(
        "LX-0357-08",
        "Touch and AT parity",
        "/mixes/lucy/<id> at 320px",
        ["Ask, edit the request, send, then stop, one-handed and with TalkBack or VoiceOver."],
        "Whole task done with touch and with a screen reader.",
        mobile=True,
    ),
    _s(
        "LX-0358-08",
        "Working-state trust",
        "/mixes/lucy/<id>",
        ["After a mixed run, say what happened and whether anything was saved or played."],
        "Predictions match the run log.",
    ),
    _s(
        "LX-0359-08",
        "Readiness understanding",
        "/mixes/lucy/<id>",
        ["Say whether this plan is unbuilt, saved or fully playable."],
        "State named correctly without reading code-like labels.",
    ),
    _s(
        "LX-0360-08",
        "Musical flow",
        "/mixes/lucy/<id>",
        ["Describe the opening, build and close.", "Point to the seam that sounds wrong."],
        "Shape described and the problem seam located.",
        timed=True,
    ),
    _s(
        "LX-0361-08",
        "Revision decisions",
        "/mixes/lucy/<id>",
        ["Compare two versions, choose one and say what happens before you commit."],
        "Intended version chosen; consequences stated before commit.",
    ),
    _s(
        "LX-0362-08",
        "Informed consent",
        "/mixes/lucy/<id> with music playing",
        ["Say what Save and Save and play each do, then stop or cancel."],
        "Effects predicted; stop or cancel leaves the player untouched.",
    ),
    _s(
        "LX-0363-08",
        "Recovery confidence",
        "/mixes/lucy/<id> after closing the tab",
        ["Come back, find the last proposal and say what was saved."],
        "Last proposal found and saved state stated correctly.",
    ),
)

# WP3 (triage 2026-11-12): one study card for each LX task whose last step is a short study with
# people. Each card names the route on the made-up library, the state to set up, one neutral
# uncoached prompt, what counts as success and as hesitation. Every outcome also records seconds
# and a 1-5 confidence rating. The pilot line is Claude's own walkthrough of the card in a real
# browser at PILOT_SHA: preparation showing whether the task can be completed and the prompt
# is clear, never a participant, a finding or a study result.
HESITATE = "a pause over 10 s, a question to the facilitator, or "
PILOT_SHA = "eb9e6eab"
CONSENT = (
    "This session tests SelectaDJ, not you. It uses made-up songs only. You can stop at any time."
    " We note the time, whether you paused and how sure you felt, under a code such as P01;"
    " no name, voice or screen recording is kept."
)


def _c(task, title, route, prompt, success, hesitation, setup="", groups=None) -> Study:
    return Study(
        task,
        title,
        route,
        groups or ("novice", "expert"),
        (prompt,),
        success,
        timed=True,
        hesitation=HESITATE + hesitation,
        setup=setup,
        pilot=PILOTS.get(task, ""),
    )


PILOTS: dict[str, str] = {
    "LX-0340-01": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; searching Same Name leaves two rows told apart by artist (Hal "
        "Greene, Iris Vale), so the prompt has one right answer."
    ),
    "LX-0340-04": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; Needs attention leaves Broken File, and its More actions menu "
        "holds Prioritize and Never play."
    ),
    "LX-0341-03": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "prompt is clear, but no made-up fixture separates the counts (12 ready, 12 "
        "analysed, 13 songs; 18, 18 and 19 with SELECTA_E2E_STRESS=1), so a "
        "misleading-value state still has to be prepared before any session."
    ),
    "LX-0342-06": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; the empty result says Looking in: Needs attention, searching for "
        "zzqx, and Clear search brings Broken File back with the filter still on."
    ),
    "LX-0343-01": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; Ready shows 12 songs and Set aside shows Episode 12 (Long and "
        "talky)."
    ),
    "LX-0343-07": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; the empty result says Looking in: Ready, searching for Episode. "
        "Clear search alone does not bring Episode 12 back (it is set aside, not "
        "ready). A second walkthrough at a7747636 showed Show all songs leaves "
        "Everything plus Episode with 0 songs: set-aside songs are searched only under "
        "Set aside. The page now says so on a no-match search, and the success line "
        "names Set aside."
    ),
    "LX-0344-04": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable with nothing playing; Last Call's visible action is Start a mix "
        "and its More menu holds Add to current mix, Prioritize and Never play, so the "
        "success line now says both actions are in More."
    ),
    "LX-0345-01": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; Card view shows title, artist, tempo, key, length and readiness "
        "per song and List view switches back. Motif artwork was not judged."
    ),
    "LX-0346-02": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; every row shows one visible action (Start a mix, or Try analysing "
        "again on Broken File) and a More actions menu."
    ),
    "LX-0348-02": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; song 11's sheet lists Length 1:27, Tempo in use 124 BPM and Key "
        "in use 8A above the Correct it form."
    ),
    "LX-0348-06": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "the first prompt (file location, last analysed) was not completable: Advanced "
        "holds beat grid confidence, measured energy, genre tag, readiness and song "
        "number. Prompt rewritten to what Advanced shows; note Advanced prints the raw "
        "readiness code mix_ready."
    ),
    "LX-0349-01": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; the form shows Tempo (measured 124), Between 40 and 240 BPM and "
        "says the measured value is kept so it can be put back; an empty Save "
        "correction is refused. There is no Reset button, so the success line now names "
        "what is shown."
    ),
    "LX-0349-04": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; Prioritize is in Last Call's More menu and the song sheet says "
        "these actions never move or delete the file. Whether the word conveys analysis "
        "order is the study question."
    ),
    "LX-0352-03": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "the zero-match screen works (Nothing matches zzqx, with Clear search and Show "
        "all songs), but Set aside is not empty in this fixture (Episode 12), so the "
        "set-up now names Priority list, which is empty here. At a7747636 its screen "
        "still said to try another spelling with no search typed; that copy is fixed "
        "(it now says no song is in Priority list right now)."
    ),
    "LX-0353-01": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; Make a Mix shows Listen now, shape later (Quick Play) and Create "
        "with Lucy, which says Quick Play does not use Lucy."
    ),
    "LX-0353-03": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; Create with Lucy and Plan a mix with Lucy sit above Choose "
        "another feeling at 1280 by 900."
    ),
    "LX-0354-01": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; the first card reads House party, 120-123 BPM, its feeling line, "
        "8 matching songs, then Play, Shape first and Save draft, so the success line "
        "now asks what Play does."
    ),
    "LX-0354-03": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; Play, Shape first and Save draft are three separate buttons on "
        "the House party card. Nothing was pressed."
    ),
    "LX-0357-01": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; a new conversation with the built-in planner shows the Message to "
        "Lucy box, Send and three example requests."
    ),
    "LX-0359-01": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; after make me 6 songs the reply says it is proposed, not built, "
        "and Your mix shows PROPOSED - NOT BUILT."
    ),
    "LX-0361-04": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "NOT completable as written: Morning Light is not in the proposal (Lucy says it "
        "cannot find it), and keep Last Call and make it calmer locked a different song "
        "(Same Name; Paper Moon with the stress fixture), dropped Last Call and showed "
        "no met, not met or unknown wording, only PREFER Keep it calm. Reported for a "
        "product fix; rerun the pilot after it."
    ),
    "LX-0362-01": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; Your mix shows Save as draft and Save and play and says Save and "
        "play also replaces what is playing, after you confirm."
    ),
    "LX-0363-02": (
        f"{PILOT_SHA} cognitive walkthrough by Claude (Edge, made-up library, preparation only): "
        "completable; the conversation's More menu holds Rename, Archive and Delete, "
        "and the Delete dialog says saved drafts are kept and music is never touched. "
        "Delete was not confirmed."
    ),
}
CARDS: tuple[Study, ...] = (
    _c(
        "LX-0340-01",
        "Collection-first journeys",
        "/library",
        "You want something to listen to from this collection. Show me how you would choose."
        " Then find the song Same Name by Iris Vale.",
        "Browses to a song and finds the exact recording without asking what a word means.",
        "asking what any Library word means",
    ),
    _c(
        "LX-0340-04",
        "Browse versus manage",
        "/library",
        "Narrow the list to songs that need attention, then stop one song from ever playing.",
        "Narrows with a visible control first, then finds Never play in the row's menu.",
        "opening two or more menus before finding the record action",
    ),
    _c(
        "LX-0341-03",
        "Readiness meaning",
        "/library",
        "Looking only at the top of this page, how many songs could go into a mix right now?",
        "Answers with the Ready count and does not confuse it with analysed songs or transitions.",
        "reading a different count aloud first",
        setup="Prepare a state where Ready and analysed differ; neither made-up fixture does.",
    ),
    _c(
        "LX-0342-06",
        "Zero-match recovery",
        "/library",
        "You searched and nothing came back. Get your songs back without losing the filter.",
        "Clears only the search and the Needs attention filter stays on.",
        "clearing everything and setting the filter again",
        setup="Turn on Needs attention and search for zzqx before handing over.",
    ),
    _c(
        "LX-0343-01",
        "Frequent filters",
        "/library",
        "Show only the songs that are ready, then only the ones you have set aside.",
        "Uses the Ready chip, then the Set aside chip, and says what each one shows.",
        "hovering over three or more chips before choosing",
    ),
    _c(
        "LX-0343-07",
        "Empty and combined constraints",
        "/library",
        "Nothing shows. Say why, then bring back the song you were looking for.",
        "Names both the search and the filter, then finds Episode 12 under Set aside.",
        "clearing everything without first saying why the list is empty",
        setup="Turn on Ready and search for Episode before handing over.",
    ),
    _c(
        "LX-0344-04",
        "Row action choice",
        "/library",
        "Add Last Call to the mix that is playing, then make it analyse sooner.",
        "Finds Add to current mix and Prioritize in the Last Call row's More menu.",
        "opening a different row's menu first",
    ),
    _c(
        "LX-0345-01",
        "Cards versus list",
        "/library (List view, then Card view)",
        "Look at the list for 5 seconds, then at the cards for 5 seconds."
        " Which would you use to pick something new, and why?",
        "Names a reason tied to what the cards show (motif, title, artist, readiness).",
        "asking what the two views are for",
    ),
    _c(
        "LX-0346-02",
        "Action priority",
        "/library",
        "On any row, show me the one thing you would most often do with a song.",
        "Points to the row's one visible action and reaches the rest through More.",
        "pointing at two different controls before deciding",
    ),
    _c(
        "LX-0348-02",
        "Facts before controls",
        "/library?song=11",
        "Without editing anything, tell me this song's tempo, key and length.",
        "Reads tempo, key and length from the facts without opening an edit field.",
        "opening a correction field to read a value",
    ),
    _c(
        "LX-0348-06",
        "Advanced facts",
        "/library?song=11",
        "Find how sure SelectaDJ is about this song's beat grid, and its measured energy.",
        "Opens the folded Advanced section and reads the beat grid confidence and energy.",
        "scrolling past the advanced section twice",
        groups=("expert",),
    ),
    _c(
        "LX-0349-01",
        "Correction form",
        "/library?song=11",
        "The tempo looks wrong. Before saving, tell me what a correction will change"
        " and how you would undo it.",
        "States the allowed range, the measured value and that it can be put back, before Save.",
        "pressing Save before describing the effect",
    ),
    _c(
        "LX-0349-04",
        "Priority meaning",
        "/library",
        "Before pressing Prioritize on Last Call, tell me what it will change.",
        "Says it moves the song up for analysis and keeps it cached, not that it plays sooner.",
        "saying it changes play order and then correcting themself",
    ),
    _c(
        "LX-0352-03",
        "Empty versus no match",
        "/library",
        "For each of these two screens, say what is wrong and what you would do next.",
        "Tells an empty filter from a search with no match and picks each screen's own action.",
        "giving the same next step for both screens",
        setup="Show Needs attention plus search zzqx, then Priority list with no search.",
    ),
    _c(
        "LX-0353-01",
        "Two creation paths",
        "/mixes",
        "Before you press anything: what would happen with each of the two ways to start?",
        "Says Quick Play starts music now and Lucy plans first, before pressing either.",
        "pressing a button to find out",
    ),
    _c(
        "LX-0353-03",
        "Lucy entry in 5 seconds",
        "/mixes",
        "Look at this page for 5 seconds. Where would you go to plan a mix with help?",
        "Points to Create with Lucy within 5 seconds.",
        "naming another control first",
    ),
    _c(
        "LX-0354-01",
        "Mood cards",
        "/mixes",
        "Pick one feeling card and tell me what it is, what it is based on and what its"
        " button does.",
        "Reads the name, the feeling and a real fact, and says what Play does.",
        "reading a different card's text as this card's",
    ),
    _c(
        "LX-0354-03",
        "Three action paths",
        "/mixes",
        "For one feeling, say what Play, Shape first and Save draft would each do."
        " Do not press them.",
        "Three different correct predictions; none says Save draft starts music.",
        "giving two of them the same outcome",
    ),
    _c(
        "LX-0357-01",
        "First message",
        "/mixes/lucy/<id> (new conversation)",
        "Ask for a mix you would like, in your own words.",
        "Types into the Message to Lucy box and sends a musical request unaided.",
        "looking for a form or settings before typing",
        setup="Turn Lucy on (built-in planner, no AI service); open a new conversation.",
    ),
    _c(
        "LX-0359-01",
        "Lifecycle words",
        "/mixes/lucy/<id>",
        "Is this mix only an idea, saved, or ready to play? How can you tell?",
        "Names the stage shown and points to the words that say so.",
        "asking what a stage word means",
        setup="A conversation with one proposal from 'make me 6 songs'.",
    ),
    _c(
        "LX-0361-04",
        "Critique outcomes",
        "/mixes/lucy/<id>",
        "You asked Lucy to keep a song and make the mix calmer. Which of those did it do?",
        "Reads each instruction's met, not met or unknown wording correctly.",
        "scrolling the whole chat to work it out",
        setup="Proposal, then 'keep <a song in it> and make it calmer'; see the pilot line.",
    ),
    _c(
        "LX-0362-01",
        "Save draft versus Save and play",
        "/mixes/lucy/<id> (Your mix)",
        "Before pressing either, say what Save as draft and Save and play would each do.",
        "Says only Save and play replaces what is playing; draft leaves the player alone.",
        "pressing one to find out",
        setup="A conversation with one proposal; open the Your mix tab.",
    ),
    _c(
        "LX-0363-02",
        "Archive versus delete",
        "/mixes/lucy/<id> (Conversations)",
        "You want this conversation out of the way but might want it back. What do you press,"
        " and what would Delete do instead?",
        "Chooses Archive and says Delete removes the chat but keeps drafts and music.",
        "opening Delete's confirmation to read it",
        setup="A conversation with one proposal; open the conversation list.",
    ),
)
BY_TASK = {study.task: study for study in STUDIES + CARDS}


def record_problems(record: dict) -> list[str]:
    """Why a facilitator's session record cannot count (empty when it can)."""
    problems: list[str] = []
    study = BY_TASK.get(record.get("task", ""))
    if not study:
        return [f"unknown study task {record.get('task')!r}"]
    if not str(record.get("facilitator") or "").strip():
        problems.append("no named facilitator")
    if not DATE.match(str(record.get("date") or "")):
        problems.append("no session date")
    if not CODE.match(str(record.get("participant") or "")):
        problems.append("participant must be a code such as P01, never a name")
    if record.get("group") not in study.groups:
        problems.append(f"group must be one of {', '.join(study.groups)}")
    if record.get("coached"):
        problems.append("a coached session does not count")
    outcomes = record.get("outcomes") or []
    if len(outcomes) != len(study.prompts):
        problems.append(f"{len(outcomes)} outcomes for {len(study.prompts)} prompts")
    for outcome in outcomes:
        if not isinstance(outcome.get("success"), bool):
            problems.append("every outcome needs success true or false")
        if study.timed and not isinstance(outcome.get("seconds"), (int, float)):
            problems.append("a timed study needs seconds on every outcome")
        if study.card:
            if outcome.get("confidence") not in (1, 2, 3, 4, 5):
                problems.append("a study card needs confidence 1 to 5 on every outcome")
            if not isinstance(outcome.get("hesitated"), bool):
                problems.append("a study card needs hesitated true or false on every outcome")
    if study.card and record.get("consent") is not True:
        problems.append("a study card needs the consent line read and agreed")
    return problems


def score(task: str, records: list[dict], baseline_seconds: float | None = None) -> dict:
    """Pool the valid sessions for one task: success rate, median time and the baseline verdict."""
    study = BY_TASK[task]
    valid = [r for r in records if r.get("task") == task and not record_problems(r)]
    groups = {g: [r for r in valid if r["group"] == g] for g in study.groups}
    outcomes = [o for r in valid for o in r["outcomes"]]
    result: dict = {
        "task": task,
        "sessions": len(valid),
        "rejected": sum(1 for r in records if r.get("task") == task) - len(valid),
        "groups": {g: len(rs) for g, rs in groups.items()},
        "success_rate": (sum(o["success"] for o in outcomes) / len(outcomes)) if outcomes else None,
        "median_seconds": None,
        "versus_baseline": None,
        "enough": bool(valid) and all(groups.values()),
    }
    if study.timed and outcomes:
        median = statistics.median(o["seconds"] for o in outcomes)
        result["median_seconds"] = median
        if baseline_seconds:
            result["versus_baseline"] = (
                "faster"
                if median < baseline_seconds * 0.95
                else "matched"
                if median <= baseline_seconds * 1.05
                else "slower"
            )
    return result


def render() -> str:
    lines = [
        "# LX study kit",
        "",
        "Generated by `python -m selecta.audit.lx_study_kit --write`; do not edit by hand.",
        "",
        f"Fixture for every study: {FIXTURE}. Sessions are uncoached; record participants as",
        "codes (P01, P02), never names. One JSON record per participant and study:",
        '`{"task", "facilitator", "date", "participant", "group", "coached": false,',
        '"outcomes": [{"success", "seconds"}]}`. `score()` drops any record that fails',
        "`record_problems()`, so nothing unsigned or coached is ever counted.",
        "",
    ]
    for study in STUDIES:
        lines += [
            f"## {study.task} - {study.title}",
            "",
            f"- Route: {study.route}" + (" (real phone)" if study.mobile else ""),
            f"- Who: {' and '.join(study.groups)}"
            + ("; timed against baseline" if study.timed else ""),
        ]
        lines += [f"- Prompt {n}: {p}" for n, p in enumerate(study.prompts, 1)]
        lines += [f"- Success: {study.success}", ""]
    lines += [
        "## Per-task study cards",
        "",
        "One card per LX task that closes with a short study (triage package WP3). Each is timed:",
        "record `seconds`, `confidence` (1 to 5, asked after the task) and `hesitated` (true or",
        'false, by the card\'s rule) on every outcome, plus `"consent": true` on the record.',
        "",
        f"Consent line, read before starting: {CONSENT}",
        "",
        "The pilot line on each card is Claude's own walkthrough in a real browser on the made-up",
        "library, done to check the task can be completed and the prompt is clear. It is",
        "preparation only: no participant took part and it is not a study result.",
        "",
    ]
    for card in CARDS:
        lines += [
            f"### {card.task} - {card.title}",
            "",
            f"- Route: {card.route}",
            f"- Who: {' and '.join(card.groups)} (participant codes only)",
        ]
        if card.setup:
            lines.append(f"- Set up first: {card.setup}")
        lines += [
            f"- Prompt (read as written, no coaching): {card.prompts[0]}",
            f"- Success: {card.success}",
            f"- Hesitation: {card.hesitation}.",
            "- Record: seconds, confidence 1 to 5, hesitated, success",
            f"- Pilot (preparation, not a result): {card.pilot or 'not piloted yet'}",
            "",
        ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    text = render()
    if args.write:
        OUT.write_text(text, encoding="utf-8", newline="\n")
        return 0
    if args.check:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != text:
            print(f"{OUT} is out of date; run with --write")
            return 1
        return 0
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
