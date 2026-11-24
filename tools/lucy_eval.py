"""Lucy's evaluation in browser-first Cloud (ADR-0476): real requests through the real path.

Usage (the key comes only from this process's environment, as the gateway reads it):

    PYTHONPATH=src python tools/lucy_eval.py --plan free --label baseline
    PYTHONPATH=src python tools/lucy_eval.py --plan standard --only hello,more-afrobeats

Each case in `tests/lucy_eval/requests.json` is sent, turn by turn, to the Cloud app's own
`/api/lucy-cloud` routes over a throwaway SQLite database seeded from
`tests/lucy_eval/library.json`; the gateway routes the plan to its model (Free: Claude Haiku
5.5). The runner records each answer, the tools called, the proposal, tokens, dollars and
seconds, checks it against the case's rules, and writes `results.json` and `report.md` to a
folder outside the repository. It stops before a case once `--budget-usd` is spent.

Nothing here prints or stores a request header or the key: the report holds the person's words,
Lucy's answers and the run's numbers only.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import sqlalchemy as sa

ROOT = Path(__file__).resolve().parents[1]
SET = ROOT / "tests" / "lucy_eval"
ORIGIN = "https://app.test"
ACTIVE = {"token": "eval-default"}
"""Each library variant is its own signed-up host and workspace; cases switch between them."""
BIG_EXTRA = 20_000


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {ACTIVE['token']}", "Origin": ORIGIN}


def load_set() -> tuple[dict, dict]:
    cases = json.loads((SET / "requests.json").read_text("utf-8"))
    library = json.loads((SET / "library.json").read_text("utf-8"))
    return cases, library


# Scoring -----------------------------------------------------------------------------------

SPANISH = re.compile(r"\b(puedo|mezcla|canciones|para|tu|biblioteca|claro|aquí|baile|bailar)\b",
                     re.IGNORECASE)
FRENCH = re.compile(r"\b(ton|votre|mix|chansons|dans|est|il y a|voici|bibliothèque)\b",
                    re.IGNORECASE)


def score(case: dict, defaults: dict, got: dict) -> list[dict[str, Any]]:
    """Every rule the case names, each with whether it held and why not."""
    text = got["answer"]
    tools = [call["name"] for call in got["tools"]]
    proposal = got["proposal"]
    checks: list[dict[str, Any]] = []

    def check(name: str, ok: bool, why: str = "") -> None:
        checks.append({"rule": name, "ok": bool(ok), "why": "" if ok else why})

    if case.get("special") == "empty":
        check("refused", got["outcome"] == "refused", got["outcome"])
        return checks
    if case.get("special") == "rapid":
        check("serialised", got["outcome"] == "serialised", got["outcome"])
        check("said_busy", "still answering" in text, text)
        return checks
    check("answered", bool(text.strip()), "no answer text")
    check("finished", got["outcome"] == "completed", f"outcome {got['outcome']}")
    limit = case.get("max_chars", defaults.get("max_chars"))
    if limit:
        check("max_chars", len(text) <= limit, f"{len(text)} chars > {limit}")
    if "tools_any" in case:
        check("tools_any", any(t in tools for t in case["tools_any"]),
              f"called {tools or 'nothing'}, wanted one of {case['tools_any']}")
    if "tools_none" in case:
        bad = [t for t in tools if t in case["tools_none"]]
        check("tools_none", not bad, f"called {bad}")
    if case.get("propose") is True:
        check("propose", proposal is not None, "no proposal made")
    if case.get("propose") is False:
        check("no_proposal", proposal is None, "made a proposal it should not have")
    if proposal is not None:
        titles = [s["title"] for s in proposal["songs"]]
        artists = [s["artist"] for s in proposal["songs"]]
        if "proposal_kind" in case:
            check("proposal_kind", proposal["kind"] == case["proposal_kind"],
                  f"kind {proposal['kind']}")
        if "proposal_minutes" in case:
            low, high = case["proposal_minutes"]
            check("proposal_minutes", low <= proposal["minutes"] <= high,
                  f"{proposal['minutes']} min, wanted {low}-{high}")
        if "proposal_artists_any" in case:
            check("proposal_artists_any", any(a in case["proposal_artists_any"] for a in artists),
                  f"artists {sorted(set(artists))}")
        if "proposal_artists_only" in case:
            stray = sorted({a for a in artists if a not in case["proposal_artists_only"]})
            check("proposal_artists_only", not stray, f"also {stray}")
        if "proposal_excludes" in case:
            kept = [t for t in titles if t in case["proposal_excludes"]]
            check("proposal_excludes", not kept, f"still has {kept}")
        if "proposal_excludes_artists" in case:
            kept = [a for a in artists if a in case["proposal_excludes_artists"]]
            check("proposal_excludes_artists", not kept, f"has {sorted(set(kept))}")
        if "proposal_first" in case:
            check("proposal_first", bool(titles) and titles[0] == case["proposal_first"],
                  f"starts with {titles[:1]}")
    for pattern in case.get("says_any", []) and [case["says_any"]]:
        check("says_any", any(re.search(p, text, re.IGNORECASE) for p in pattern),
              f"matched none of {pattern}")
    for pattern in [*defaults.get("says_none", []), *case.get("says_none", [])]:
        check(f"says_none:{pattern}", not re.search(pattern, text, re.IGNORECASE),
              "said it")
    if case.get("language") == "es":
        check("language", len(SPANISH.findall(text)) >= 2, "not answered in Spanish")
    if case.get("language") == "fr":
        check("language", len(FRENCH.findall(text)) >= 2, "not answered in French")
    return checks


def verdict(checks: list[dict]) -> str:
    failed = [c for c in checks if not c["ok"]]
    if not failed:
        return "pass"
    return "fail: " + "; ".join(f"{c['rule']} ({c['why']})" for c in failed)


# The app -----------------------------------------------------------------------------------


def make_world(plan: str, folder: Path):
    """A migrated database, the Cloud app, one signed-up host on `plan`, and the library."""
    from fastapi.testclient import TestClient

    from selecta import flags
    from selecta.ai import allowance, spend
    from selecta.ai.registry import RequestClass, Tier
    from selecta.api_cloud import CloudSettings, create_cloud_app
    from selecta.billing import stripe_sync
    from selecta.identity.tokens import BadSignature, Claims
    from selecta.persistence import db_now, make_engine, migrate, transaction

    class Host:
        def verify(self, token: str) -> Claims:
            if not token.startswith("eval-"):
                raise BadSignature("unknown")
            return Claims(subject=f"user_{token}", issued_at=1_000, expires_at=4_000_000_000,
                          email=f"{token}@example.test", email_verified=True)

    flags.use("+cloud.local_media +lucy.cloud_conversation")
    tier = Tier(plan)
    # the evaluation is many turns in one month: lift the allowance and the monthly ceiling;
    # the per-turn ceilings stay exactly as the plan has them
    allowance.ALLOWANCES[tier] = {c: 100_000 for c in RequestClass}
    spend.TIER_LIMITS[tier] = dataclasses.replace(spend.TIER_LIMITS[tier],
                                                  monthly_cost_ceiling_usd=50.0)
    engine = make_engine(f"sqlite:///{folder / 'eval.sqlite'}")
    migrate.upgrade(engine)
    settings = CloudSettings(database_url="sqlite:///eval", workos_client_id="client_eval",
                             issuer="https://issuer.test", audience="selecta-eval",
                             allowed_hosts=("testserver",), allowed_origins=(ORIGIN,))
    app = create_cloud_app(settings, engine=engine, verifier=Host())
    client = TestClient(app, base_url="https://testserver")
    client.__enter__()

    def onboard(token: str) -> str:
        made = client.post("/api/onboarding/complete", json={"age_confirmed": True},
                           headers={"Authorization": f"Bearer {token}", "Origin": ORIGIN})
        made.raise_for_status()
        workspace = made.json()["workspace_id"]
        if plan != "free":
            with transaction(engine) as conn:
                stripe_sync.grant_override(conn, workspace_id=workspace, plan_id=plan,
                                           reason="lucy eval", actor="eval",
                                           expires_at=db_now(conn) + 86_400)
        return workspace

    return client, engine, onboard


def seed(client, library: dict, variant: str = "default") -> dict[str, int]:
    songs = library["songs"]
    if variant == "empty":
        return {}
    if variant == "one":
        songs = songs[:1]
    rows = [
        {"content_sha256": f"{index + 1:064x}", "title": t, "artist": a, "album": al,
         "duration_s": float(seconds)}
        for index, (t, a, al, seconds) in enumerate(songs)
    ]
    if variant == "big":
        rows += [
            {"content_sha256": f"{10_000_000 + n:064x}", "title": f"Track {n:05d}",
             "artist": f"Artist {n % 4000:04d}", "album": None, "duration_s": 200.0}
            for n in range(BIG_EXTRA)
        ]
    ids: dict[str, int] = {}
    for start in range(0, len(rows), 500):
        batch = rows[start:start + 500]
        answer = client.post("/api/local-media/songs", headers=_headers(), json={"songs": batch})
        answer.raise_for_status()
        ids.update({row["title"]: entry["song_id"]
                    for row, entry in zip(batch, answer.json()["songs"], strict=True)})
    never = [ids[t] for t in library.get("never_play", []) if t in ids]
    if never:
        client.post("/api/local-media/songs/never", headers=_headers(), json={
            "never": True, "entries": [{"id": i, "expected": False} for i in never]
        }).raise_for_status()
    if variant == "one":
        return ids
    mix = library["current_mix"]
    made = client.post("/api/local-media/recipes", headers=_headers(),
                       json={"name": mix["name"], "song_ids": [ids[t] for t in mix["songs"]]})
    made.raise_for_status()
    chosen = client.put("/api/local-media/current", headers=_headers(),
                        json={"mix_id": made.json()["mix"]["mix_id"], "expected_mix_id": None})
    chosen.raise_for_status()
    return ids


def reset_mix(client, library: dict, ids: dict[str, int]) -> None:
    """Every case starts from the same current mix."""
    current = client.get("/api/local-media/current", headers=_headers()).json()["mix_id"]
    if current is None:
        return
    mix = client.get(f"/api/local-media/recipes/{current}", headers=_headers()).json()["mix"]
    wanted = [ids[t] for t in library["current_mix"]["songs"]]
    if [s["song_id"] for s in mix["songs"]] != wanted:
        client.post(f"/api/local-media/recipes/{current}/revisions", headers=_headers(),
                    json={"base_revision": mix["revision"], "song_ids": wanted}
                    ).raise_for_status()


def run_case(client, engine, case: dict) -> dict[str, Any]:
    from selecta.lucy import cloud_agent

    conversation = client.post("/api/lucy-cloud/conversations", headers=_headers(),
                               json={}).json()["id"]
    started = time.monotonic()
    special = case.get("special")
    if special == "empty":
        sent = client.post(f"/api/lucy-cloud/conversations/{conversation}/turns",
                           headers=_headers(), json={"client_id": "empty", "text": ""})
        return {"answer": f"(refused with {sent.status_code})", "outcome":
                "refused" if sent.status_code == 422 else f"accepted {sent.status_code}",
                "tools": [], "proposal": None, "seconds": 0, "runs": []}
    if special == "rapid":
        first = client.post(f"/api/lucy-cloud/conversations/{conversation}/turns",
                            headers=_headers(), json={"client_id": "r1", "text": case["turns"][0]})
        second = client.post(f"/api/lucy-cloud/conversations/{conversation}/turns",
                             headers=_headers(), json={"client_id": "r2",
                                                       "text": case["turns"][1]})
        cloud_agent.RUNNER.wait(240)
        detail = second.json().get("detail", {}) if second.status_code != 200 else {}
        outcome = ("serialised" if first.status_code == 200 and second.status_code == 409
                   else f"{first.status_code}/{second.status_code}")
        return {"answer": detail.get("message", "(second send accepted)"), "outcome": outcome,
                "tools": [], "proposal": None, "seconds": round(time.monotonic() - started, 2),
                "runs": _runs(engine, conversation)}
    for number, text in enumerate(case["turns"]):
        sent = client.post(f"/api/lucy-cloud/conversations/{conversation}/turns",
                           headers=_headers(), json={"client_id": f"{case['id']}-{number}",
                                                     "text": text})
        if sent.status_code != 200:
            return {"answer": "", "outcome": f"refused {sent.status_code}", "tools": [],
                    "proposal": None, "seconds": 0, "runs": []}
        cloud_agent.RUNNER.wait(240)
    seconds = round(time.monotonic() - started, 2)
    shown = client.get(f"/api/lucy-cloud/conversations/{conversation}",
                       headers=_headers()).json()
    events = client.get(f"/api/lucy-cloud/conversations/{conversation}/events.json?after=0",
                        headers=_headers()).json()["events"]
    last_turn = shown["messages"][-1]["turn"] if shown["messages"] else None
    tools = [
        {"name": e["payload"].get("op"), "ok": e["type"] == "step.completed",
         "count": e["payload"].get("count"), "error": e["payload"].get("error")}
        for e in events
        if e["type"] in {"step.completed", "step.failed"} and e["turn"] == last_turn
    ]
    proposal = None
    revision = (shown.get("proposal") or {}).get("current")
    if revision and revision.get("turn") == last_turn:
        songs = revision["snapshot"]["songs"]
        proposal = {
            "kind": "change" if revision["snapshot"]["versions"].get("target") == "current mix"
            else "new",
            "title": revision["snapshot"]["title"],
            "minutes": round(sum(s["duration"] for s in songs) / 60, 1),
            "songs": [{"title": s["title"], "artist": s["artist"]} for s in songs],
            "summary": revision["summary"],
        }
    runs = _runs(engine, conversation)
    answer = shown["messages"][-1]["content"] if shown["messages"] else ""
    last = runs[-1] if runs else {}
    return {"answer": answer, "outcome": last.get("outcome", "none"), "tools": tools,
            "proposal": proposal, "seconds": seconds, "runs": runs}


def _runs(engine, conversation: str) -> list[dict]:
    from selecta.ai.schema import ai_runs
    from selecta.persistence import transaction

    with transaction(engine) as conn:
        return [dict(r) for r in conn.execute(
            sa.select(ai_runs.c.deployment_id, ai_runs.c.outcome, ai_runs.c.tokens_in,
                      ai_runs.c.tokens_out, ai_runs.c.cache_read_tokens,
                      ai_runs.c.cache_write_tokens, ai_runs.c.cost_usd, ai_runs.c.limited)
            .where(ai_runs.c.conversation_id == conversation)
            .order_by(ai_runs.c.started_at)
        ).mappings()]


def write_report(folder: Path, meta: dict, results: list[dict]) -> None:
    (folder / "results.json").write_text(json.dumps({"meta": meta, "results": results},
                                                    indent=2, ensure_ascii=False), "utf-8")
    passed = sum(1 for r in results if r["verdict"] == "pass")
    lines = [
        f"# Lucy evaluation: {meta['label']} ({meta['plan']}, {meta['model']})", "",
        f"{passed} of {len(results)} cases pass. Spend ${meta['spend_usd']:.4f}; "
        f"{meta['tokens_in']} tokens in, {meta['tokens_out']} out; "
        f"{meta['seconds']:.0f} s. Prompt cache: {meta['cache_read']} tokens read, "
        f"{meta['cache_write']} written "
        f"({100 * meta['cache_read'] / max(1, meta['tokens_in']):.0f}% of input read from it).",
        "",
        "| case | kind | verdict | tools | $ | s |", "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in results:
        tools = ", ".join(t["name"] or "?" for t in r["tools"]) or "-"
        lines.append(f"| {r['id']} | {r['kind']} | {r['verdict'][:140]} | {tools} | "
                     f"{r['cost_usd']:.4f} | {r['seconds']} |")
    lines.append("")
    for r in results:
        lines += [f"## {r['id']}", "", *[f"> {t}" for t in r["turns"]], "",
                  r["answer"] or "(no answer)", ""]
        if r["proposal"]:
            p = r["proposal"]
            lines.append(f"Proposal ({p['kind']}, {p['minutes']} min): " + "; ".join(
                f"{s['title']} - {s['artist']}" for s in p["songs"]))
            lines.append("")
    (folder / "report.md").write_text("\n".join(lines), "utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--plan", default="free", choices=["free", "standard", "premium"])
    parser.add_argument("--label", default="run")
    parser.add_argument("--only", default="", help="comma-separated case ids")
    parser.add_argument("--budget-usd", type=float, default=2.0)
    parser.add_argument("--failed-from", default="", help="a results.json: rerun its failures")
    parser.add_argument("--out", default=os.environ.get("LUCY_EVAL_OUT") or str(
        Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "selecta-lucy-eval"))
    args = parser.parse_args(argv)
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY isn't in this process's environment; nothing was run.")
        return 2
    cases, library = load_set()
    wanted = {name.strip() for name in args.only.split(",") if name.strip()}
    if args.failed_from:
        earlier = json.loads(Path(args.failed_from).read_text("utf-8"))["results"]
        wanted |= {r["id"] for r in earlier if r["verdict"] != "pass"}
    chosen = [c for c in cases["cases"] if not wanted or c["id"] in wanted]
    folder = Path(args.out) / f"{time.strftime('%Y%m%d-%H%M%S')}-{args.plan}-{args.label}"
    folder.mkdir(parents=True, exist_ok=True)
    client, engine, onboard = make_world(args.plan, folder)
    worlds: dict[str, dict[str, int]] = {}

    def world(variant: str) -> dict[str, int]:
        ACTIVE["token"] = f"eval-{variant}"
        if variant not in worlds:
            onboard(ACTIVE["token"])
            worlds[variant] = seed(client, library, variant)
        return worlds[variant]

    results: list[dict] = []
    spent = 0.0
    started = time.monotonic()
    model = "?"
    for case in chosen:
        if spent >= args.budget_usd:
            print(f"Budget of ${args.budget_usd} reached; {case['id']} and later not run.")
            break
        ids = world(case.get("library", "default"))
        reset_mix(client, library, ids)
        got = run_case(client, engine, case)
        cost = sum(float(r["cost_usd"] or 0) for r in got["runs"])
        spent += cost
        model = got["runs"][-1]["deployment_id"] if got["runs"] else model
        checks = score(case, cases["defaults"], got)
        result = {"id": case["id"], "kind": case["kind"], "turns": case["turns"], **got,
                  "cost_usd": round(cost, 6), "checks": checks, "verdict": verdict(checks)}
        results.append(result)
        print(f"{case['id']:<20} {result['verdict'][:90]}  ${cost:.4f} "
              f"(total ${spent:.4f})  {got['seconds']}s", flush=True)
    meta = {
        "label": args.label, "plan": args.plan, "model": model,
        "spend_usd": round(spent, 6), "seconds": time.monotonic() - started,
        "tokens_in": sum(r2["tokens_in"] for r in results for r2 in r["runs"]),
        "tokens_out": sum(r2["tokens_out"] for r in results for r2 in r["runs"]),
        "cache_read": sum(r2["cache_read_tokens"] for r in results for r2 in r["runs"]),
        "cache_write": sum(r2["cache_write_tokens"] for r in results for r2 in r["runs"]),
        "prompt_version": __import__("selecta.lucy.cloud_prompt",
                                     fromlist=["PROMPT_VERSION"]).PROMPT_VERSION,
    }
    write_report(folder, meta, results)
    passed = sum(1 for r in results if r["verdict"] == "pass")
    print(f"\n{passed}/{len(results)} pass, ${spent:.4f}. Report: {folder}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
