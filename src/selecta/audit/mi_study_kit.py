"""The code half of the MI studies and sign-offs: session sheets, record checks and raw counts.

Twenty-four MI tasks (ADR-0135 to ADR-0164) are closed only by people: an uncoached study, a
listening session, a named reviewer or the owner's signature. This kit does everything around
that which code can do, and nothing that pretends to be the people:

- ``sheet`` writes a blank record for one task with participant codes, a counterbalanced order
  of its conditions per participant (a Williams Latin square) and, for blind listening, a
  separate key file so the facilitator can hide labels from the listener.
- ``check`` refuses a record that could not be evidence: no exact 40-character SHA, a
  participant name instead of a code, no consent, a coached trial counted as a pass, an order that
  is not the sheet's conditions, a measure out of range, a superiority claim, or (for
  sign-offs) a missing owner, reviewer, alternative, no-go, disposition or SHA.
- ``summary`` prints the raw counts the checklist lines ask for: denominators, successes,
  hesitations, errors, times, rating spreads, every free-text answer as written, and the
  outcome by position so order effects are visible. It never ranks conditions.

Run ``python -m selecta.audit.mi_study_kit list`` for the tasks. Records hold participant codes
(P01, P02, ...), never names; keep raw notes and recordings outside the repository.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import statistics
import sys
from dataclasses import dataclass, field
from pathlib import Path

SHA = re.compile(r"[0-9a-f]{40}")
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
CODE = re.compile(r"P\d{2,3}")
# MI-0158-08: report raw counts; a ranking needs a defined comparison the kit does not make.
SUPERIORITY = re.compile(
    r"\b(better|best|superior|outperform\w*|beats?|wins?|winner|preferred overall)\b", re.I
)
KINDS = ("bool", "count", "seconds", "rating5", "text", "choice", "time")


@dataclass(frozen=True)
class Measure:
    name: str
    kind: str
    choices: tuple[str, ...] = ()


@dataclass(frozen=True)
class Study:
    task_id: str
    title: str
    conditions: tuple[str, ...]
    measures: tuple[Measure, ...]
    setup: str
    counterbalance: bool = True
    uncoached: bool = True
    blind: str = ""
    conditions_from_facilitator: bool = False


@dataclass(frozen=True)
class SignOff:
    task_id: str
    title: str
    roles: tuple[str, ...]
    entry: str
    entry_fields: tuple[str, ...]
    list_fields: tuple[str, ...] = ()
    extra: tuple[str, ...] = field(default=())


def m(name: str, kind: str, *choices: str) -> Measure:
    return Measure(name, kind, choices)


OK = m("success", "bool")
HESITATIONS = m("hesitations", "count")
ERRORS = m("errors", "count")
SECONDS = m("seconds", "seconds")
COACHED = m("coached", "bool")
WORDS = m("participant_words", "text")
CONFIDENCE = m("confidence", "rating5")
E2E = "fresh `python tests/e2e_server.py <port>` and a fresh browser profile per participant"
FAULTS = (
    "inject the fault with Playwright `page.route` from the matching `web/e2e/` spec, or stop "
    "the server mid-task; note exactly which fault was injected"
)

STUDIES: dict[str, Study] = {
    s.task_id: s
    for s in (
        Study(
            "MI-0135-06",
            "First-delight evaluation",
            ("first mix", "first transition", "first request"),
            (OK, HESITATIONS, CONFIDENCE, WORDS),
            E2E,
        ),
        Study(
            "MI-0141-08",
            "Time to first sound",
            ("setup", "first audible transition"),
            (
                m("completed", "bool"),
                m("abandoned", "bool"),
                SECONDS,
                m("satisfaction", "rating5"),
                WORDS,
            ),
            "the participant's real music folder (a copied SELECTA_HOME) on their own hardware",
            counterbalance=False,
        ),
        Study(
            "MI-0142-08",
            "Recommendation understanding",
            ("Play", "Edit first", "Save"),
            (m("predicted_correctly", "bool"), m("prediction", "text"), HESITATIONS),
            E2E,
        ),
        Study(
            "MI-0143-08",
            "Musical agency",
            ("shape a rough journey", "listen to the result"),
            (m("explained_intent", "bool"), m("achieved_journey", "bool"), COACHED, WORDS),
            "real music; the facilitator listens to the resulting mix with the participant",
            counterbalance=False,
        ),
        Study(
            "MI-0144-08",
            "Listener distraction",
            ("listening session",),
            (
                m("named_song", "bool"),
                m("named_next", "bool"),
                m("screen_glances", "count"),
                m("calm", "rating5"),
                WORDS,
            ),
            "real music on the Listen page for at least ten minutes",
            counterbalance=False,
        ),
        Study(
            "MI-0146-08",
            "Immersive comfort",
            ("Stage with lyrics", "Stage without lyrics"),
            (
                m("stayed_immersed", "bool"),
                m("distractions", "count"),
                m("lyric_movement", "choice", "too much", "about right", "too little"),
                m("comfort", "rating5"),
                WORDS,
            ),
            "real music with synced lyrics; normal and reduced motion noted per session",
        ),
        Study(
            "MI-0147-08",
            "Anticipation and trust",
            ("handoff 1", "handoff 2", "handoff 3"),
            (
                m("predicted_handoff", "bool"),
                m("observed_at", "time"),
                m("confidence_after", "rating5"),
                WORDS,
            ),
            "real music; observed_at is the playback clock when the participant answered",
            counterbalance=False,
        ),
        Study(
            "MI-0148-08",
            "Perceived fairness",
            ("request 1", "request 2", "request 3"),
            (
                m("explained_wait", "bool"),
                m("explained_approval", "bool"),
                m("predicted_next", "bool"),
                m("interview", "text"),
            ),
            "a party-like local session: several requesters on their own phones on one network",
            counterbalance=False,
        ),
        Study(
            "MI-0150-08",
            "Arrangement fluency",
            ("move", "insert", "remove", "lock", "Undo"),
            (OK, ERRORS, SECONDS, COACHED),
            E2E,
        ),
        Study(
            "MI-0151-08",
            "Sound correspondence",
            (),
            (m("heard_matches_shown", "choice", "yes", "no", "unsure"), WORDS),
            "rendered transitions at the exact SHA; the facilitator lists the sample ids",
            blind="the shown technique stays hidden until the listener has answered",
            conditions_from_facilitator=True,
        ),
        Study(
            "MI-0152-08",
            "Creator prediction",
            ("change cells", "improve a transition"),
            (m("predicted_sound", "bool"), m("before", "rating5"), m("after", "rating5"), WORDS),
            "real stems in the Studio; listen before and after each change",
            counterbalance=False,
        ),
        Study(
            "MI-0153-08",
            "Findability",
            ("find a song", "use a filter", "make a correction"),
            (OK, ERRORS, SECONDS),
            "SELECTA_E2E_STRESS=1 " + E2E,
        ),
        Study(
            "MI-0154-08",
            "Correction confidence",
            ("correct a BPM", "correct a key"),
            (m("predicted_changed", "bool"), m("predicted_unchanged", "bool"), WORDS),
            E2E,
        ),
        Study(
            "MI-0155-08",
            "Musical delight without bias",
            (),
            (m("quality", "rating5"), m("quality_notes", "text")),
            "real rendered connections; the facilitator lists the connection ids",
            blind="engine confidence and labels stay hidden; the key file maps A/B to ids",
            conditions_from_facilitator=True,
        ),
        Study(
            "MI-0156-08",
            "Operator recovery",
            ("analysis error", "storage error", "source error"),
            (m("resolved", "bool"), COACHED, SECONDS, WORDS),
            FAULTS,
        ),
        Study(
            "MI-0157-08",
            "Finished moment",
            ("export", "re-export after a change"),
            (m("right_file", "bool"), m("right_revision", "bool"), m("confused", "bool"), WORDS),
            E2E,
            counterbalance=False,
        ),
        Study(
            "MI-0159-08",
            "Error recovery",
            ("create", "move", "export", "request"),
            (m("recovered", "bool"), COACHED, SECONDS, WORDS),
            FAULTS,
        ),
        Study(
            "MI-0160-08",
            "Mobile task fluency",
            ("first play", "request", "edit", "export"),
            (OK, m("gesture_coached", "bool"), m("device", "text")),
            "real phones on the local network; record phone model and browser per trial",
        ),
        Study(
            "MI-0163-08",
            "Confidence and tone",
            ("readiness copy", "failure copy", "export copy"),
            (m("understood", "bool"), m("tone", "choice", "respectful", "robotic", "noisy"), WORDS),
            E2E,
        ),
        Study(
            "MI-0164-05",
            "Manual accessibility review",
            ("NVDA with Edge", "touch", "zoom 200 and 400%", "cognitive", "reduced motion"),
            (m("passed", "bool"), m("failures", "text"), m("environment", "text")),
            "named reviewers with the participant's own assistive technology",
            uncoached=False,
        ),
    )
}

SIGNOFFS: dict[str, SignOff] = {
    s.task_id: s
    for s in (
        SignOff(
            "MI-0135-08",
            "Scene and owner sign-off",
            ("owner", "accessibility_reviewer", "audio_reviewer"),
            "scenes",
            ("scene", "owner", "evidence"),
            ("alternatives", "no_go"),
        ),
        SignOff(
            "MI-0161-08",
            "Human accessibility sign-off",
            ("lead_reviewer",),
            "sessions",
            ("reviewer", "device", "browser", "assistive_technology"),
            ("failures",),
            ("passed", "total"),
        ),
        SignOff(
            "MI-0164-08",
            "Owner GO/NO-GO",
            ("owner",),
            "issues",
            ("id", "severity", "description"),
            (),
            ("decision", "decision_owners"),
        ),
    )
}

REPORT_ID = "MI-0158-08"


def williams(conditions: tuple[str, ...], n: int) -> list[list[str]]:
    """Balanced orders: each condition comes first, and follows each other, equally often."""
    k = len(conditions)
    if k < 2:
        return [list(conditions) for _ in range(n)]
    base, low, high = [0], 1, k - 1
    while len(base) < k:
        base.append(low)
        low += 1
        if len(base) < k:
            base.append(high)
            high -= 1
    rows = [[conditions[(c + r) % k] for c in base] for r in range(k)]
    if k % 2:
        rows += [list(reversed(row)) for row in rows]
    return [rows[i % len(rows)] for i in range(n)]


def sheet(
    task_id: str, participants: int, conditions: list[str] | None = None, seed: int = 0
) -> tuple[dict, dict | None]:
    """A blank record, and for blind listening the separate A/B key."""
    if task_id in SIGNOFFS:
        s = SIGNOFFS[task_id]
        row = {f: "" for f in s.entry_fields} | {f: [] for f in s.list_fields}
        record = {
            "task_id": task_id,
            "sha": "",
            "date": "",
            **{r: "" for r in s.roles},
            s.entry: [row],
            **{f: "" for f in s.extra},
        }
        if task_id == "MI-0164-08":
            record[s.entry][0] |= {"disposition": "", "disposition_owner": ""}
            record["decision_owners"] = []
        return record, None
    study = STUDIES[task_id]
    names = tuple(conditions or study.conditions)
    if not names:
        raise ValueError(f"{task_id} needs --conditions (the facilitator's sample ids)")
    orders = williams(names, participants) if study.counterbalance else [list(names)] * participants
    rng = random.Random(seed)
    people, key = [], {}
    for index in range(participants):
        code = f"P{index + 1:02}"
        order = list(orders[index])
        if study.blind:
            rng.shuffle(order)
            key[code] = {f"sample {i + 1}": name for i, name in enumerate(order)}
            order = [f"sample {i + 1}" for i in range(len(order))]
        people.append(
            {
                "code": code,
                "consent": False,
                "order": order,
                "trials": {c: {mm.name: None for mm in study.measures} for c in order},
            }
        )
    record = {
        "task_id": task_id,
        "sha": "",
        "date": "",
        "facilitator": "",
        "environment": "",
        "setup": study.setup,
        "conditions": list(names),
        "participants": people,
        "claims": "",
    }
    return record, ({"task_id": task_id, "blind": study.blind, "key": key} if key else None)


def _check_value(measure: Measure, value: object) -> str | None:
    if value is None:
        return "not recorded"
    kind = measure.kind
    if kind == "bool" and not isinstance(value, bool):
        return "must be true or false"
    if kind == "count" and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
        return "must be a whole number from 0"
    if kind == "seconds" and (
        isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0
    ):
        return "must be seconds from 0"
    if kind == "rating5" and (isinstance(value, bool) or value not in (1, 2, 3, 4, 5)):
        return "must be 1 to 5"
    if kind == "choice" and value not in measure.choices:
        return f"must be one of {', '.join(measure.choices)}"
    if kind == "time" and not (isinstance(value, str) and re.fullmatch(r"\d+:\d{2}", value)):
        return "must be the playback clock as m:ss"
    if kind == "text" and not isinstance(value, str):
        return "must be text"
    return None


def _common(record: dict) -> list[str]:
    problems = []
    if not SHA.fullmatch(str(record.get("sha", ""))):
        problems.append("sha: the exact 40-character commit is required")
    if not DATE.fullmatch(str(record.get("date", ""))):
        problems.append("date: YYYY-MM-DD is required")
    if SUPERIORITY.search(str(record.get("claims", ""))):
        problems.append(
            "claims: report raw counts; a superiority claim needs a defined comparison (MI-0158-08)"
        )
    return problems


def _check_signoff(record: dict, s: SignOff) -> list[str]:
    problems = _common(record)
    problems += [
        f"{r}: a named person is required" for r in s.roles if not str(record.get(r, "")).strip()
    ]
    entries = record.get(s.entry) or []
    if not entries:
        problems.append(f"{s.entry}: at least one is required")
    for i, row in enumerate(entries, 1):
        problems += [
            f"{s.entry} {i}: {f} is required"
            for f in s.entry_fields
            if not str(row.get(f, "")).strip()
        ]
        problems += [
            f"{s.entry} {i}: {f} needs at least one entry"
            for f in s.list_fields
            if f != "failures" and not row.get(f)
        ]
        if s.task_id == "MI-0161-08":
            passed, total = row.get("passed"), row.get("total")
            if not (
                isinstance(passed, int)
                and isinstance(total, int)
                and 0 <= passed <= total
                and total > 0
            ):
                problems.append(f"sessions {i}: passed and total must be counts, passed <= total")
            elif passed < total and not row.get("failures"):
                problems.append(f"sessions {i}: {total - passed} failed checks need failures")
    if s.task_id == "MI-0164-08":
        decision = record.get("decision")
        if decision not in ("GO", "NO-GO"):
            problems.append("decision: GO or NO-GO")
        if not record.get("decision_owners"):
            problems.append("decision_owners: name who owns each decision")
        for i, row in enumerate(entries, 1):
            severity, disposition = row.get("severity"), str(row.get("disposition", "")).strip()
            if severity not in ("P0", "P1", "P2"):
                problems.append(f"issues {i}: severity must be P0, P1 or P2")
            if severity == "P1" and not (disposition and row.get("disposition_owner")):
                problems.append(f"issues {i}: every P1 needs a disposition and its owner")
            if severity == "P0" and decision == "GO" and disposition != "fixed":
                problems.append(f"issues {i}: GO with an open P0")
    return problems


def check(record: dict) -> list[str]:
    """Every reason this record is not yet evidence; empty when it is."""
    task_id = record.get("task_id")
    if task_id in SIGNOFFS:
        return _check_signoff(record, SIGNOFFS[task_id])
    if task_id == REPORT_ID:
        return _common(record) + (
            ["records: name the study records the report covers"]
            if not record.get("records")
            else []
        )
    if task_id not in STUDIES:
        return [f"task_id: {task_id!r} is not an MI study"]
    study = STUDIES[task_id]
    problems = _common(record)
    if not str(record.get("facilitator", "")).strip():
        problems.append("facilitator: a named person is required")
    if not str(record.get("environment", "")).strip():
        problems.append("environment: machine, OS, browser and audio device are required")
    people = record.get("participants") or []
    if not people:
        problems.append("participants: none recorded")
    names = set(record.get("conditions") or study.conditions)
    seen = set()
    for person in people:
        code = str(person.get("code", ""))
        where = f"participant {code or '?'}"
        if not CODE.fullmatch(code):
            problems.append(f"{where}: use a code like P01, never a name")
        if code in seen:
            problems.append(f"{where}: code used twice")
        seen.add(code)
        if person.get("consent") is not True:
            problems.append(f"{where}: consent is not recorded")
        order = person.get("order") or []
        if not study.blind and sorted(order) != sorted(names):
            problems.append(f"{where}: order is not the sheet's conditions")
        trials = person.get("trials") or {}
        if sorted(trials) != sorted(order):
            problems.append(f"{where}: trials do not match the order")
        for condition, values in trials.items():
            for measure in study.measures:
                wrong = _check_value(measure, (values or {}).get(measure.name))
                if wrong:
                    problems.append(f"{where}, {condition}: {measure.name} {wrong}")
            # an uncoached study keeps coached trials (they are the finding) but never as passes
            if (
                study.uncoached
                and (values or {}).get("coached") is True
                and any(
                    (values or {}).get(x.name) is True
                    for x in study.measures[:1]
                    if x.kind == "bool" and x.name != "coached"
                )
            ):
                problems.append(
                    f"{where}, {condition}: a coached trial cannot count as a "
                    f"{study.measures[0].name}"
                )
    return problems


def summary(record: dict) -> dict:
    """Raw counts per condition and by position. No ranking, no winner."""
    study = STUDIES[record["task_id"]]
    people = record.get("participants") or []
    per: dict[str, dict[str, list]] = {}
    by_position: dict[int, list[bool]] = {}
    first_bool = next((x.name for x in study.measures if x.kind == "bool"), None)
    for person in people:
        for position, condition in enumerate(person.get("order") or [], 1):
            values = (person.get("trials") or {}).get(condition) or {}
            bucket = per.setdefault(condition, {})
            for measure in study.measures:
                bucket.setdefault(measure.name, []).append(values.get(measure.name))
            if first_bool and isinstance(values.get(first_bool), bool):
                by_position.setdefault(position, []).append(values[first_bool])
    out: dict[str, object] = {
        "task_id": study.task_id,
        "participants": len(people),
        "conditions": {},
    }
    for condition, columns in per.items():
        row = {}
        for measure in study.measures:
            values = [v for v in columns[measure.name] if v is not None]
            row[measure.name] = _raw(measure, values)
        out["conditions"][condition] = row
    if first_bool and len(by_position) > 1:
        out["by_position"] = {
            f"position {p}": f"{sum(v)}/{len(v)} {first_bool}"
            for p, v in sorted(by_position.items())
        }
    out["limits"] = f"{len(people)} participants; raw counts only, no condition is ranked" + (
        "; fewer than 5 participants" if len(people) < 5 else ""
    )
    return out


def _raw(measure: Measure, values: list) -> object:
    if measure.kind == "bool":
        return f"{sum(1 for v in values if v)}/{len(values)}"
    if measure.kind in ("count", "seconds") and values:
        return {"each": values, "total": sum(values), "median": statistics.median(values)}
    if measure.kind == "rating5" and values:
        return {
            "spread": {str(r): values.count(r) for r in range(1, 6)},
            "median": statistics.median(values),
        }
    if measure.kind == "choice":
        return {c: values.count(c) for c in measure.choices}
    return values


def report(records: list[dict], sha: str, date: str, claims: str = "") -> tuple[dict, list[str]]:
    """MI-0158-08: one report over several checked study records, raw and unranked."""
    head = {
        "task_id": REPORT_ID,
        "sha": sha,
        "date": date,
        "claims": claims,
        "records": [r.get("task_id") for r in records],
    }
    problems = check(head)
    for r in records:
        problems += [f"{r.get('task_id')}: {p}" for p in check(r)]
        if r.get("task_id") in STUDIES and r.get("sha") != sha:
            problems.append(f"{r.get('task_id')}: recorded at a different SHA than the report")
    studies = [summary(r) for r in records if r.get("task_id") in STUDIES]
    body = head | {"sample_count": sum(s["participants"] for s in studies), "studies": studies}
    return body, problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mi_study_kit", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list")
    make = sub.add_parser("sheet")
    make.add_argument("task_id")
    make.add_argument("--participants", type=int, default=6)
    make.add_argument("--conditions", help="comma-separated sample ids for blind listening")
    make.add_argument("--seed", type=int, default=0)
    make.add_argument("--out", type=Path, required=True)
    for name in ("check", "summary"):
        sub.add_parser(name).add_argument("path", type=Path)
    joined = sub.add_parser("report")
    joined.add_argument("paths", type=Path, nargs="+")
    joined.add_argument("--sha", required=True)
    joined.add_argument("--date", required=True)
    args = parser.parse_args(argv)
    if args.command == "report":
        records = [json.loads(p.read_text(encoding="utf-8")) for p in args.paths]
        body, problems = report(records, args.sha, args.date)
        for problem in problems:
            print(problem)
        if problems:
            print(f"{len(problems)} problems")
            return 1
        print(json.dumps(body, indent=2))
        return 0
    if args.command == "list":
        for s in [*STUDIES.values(), *SIGNOFFS.values()]:
            print(f"{s.task_id}  {s.title}")
        print(f"{REPORT_ID}  Study evidence report (summary of the records above)")
        return 0
    if args.command == "sheet":
        conditions = args.conditions.split(",") if args.conditions else None
        record, key = sheet(args.task_id, args.participants, conditions, args.seed)
        args.out.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        if key:
            key_path = args.out.with_suffix(".key.json")
            key_path.write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8")
            print(f"wrote {args.out} and the sealed key {key_path}; keep the key from listeners")
        else:
            print(f"wrote {args.out}")
        return 0
    record = json.loads(args.path.read_text(encoding="utf-8"))
    problems = check(record)
    if args.command == "check" or problems or record.get("task_id") not in STUDIES:
        for problem in problems:
            print(problem)
        print("ok" if not problems else f"{len(problems)} problems")
        return 1 if problems else 0
    print(json.dumps(summary(record), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
