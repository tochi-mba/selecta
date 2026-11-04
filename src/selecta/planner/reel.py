"""Build a listening reel: real songs, real transitions, for a person to judge.

I can measure timing but I can't hear. A reel is how the person who can gets to tell me whether
any of this is actually good.
"""

from __future__ import annotations

import html
import json
import random
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

import soundfile as sf

from selecta.analysis.key import camelot_distance
from selecta.analysis.song import SongInfo, load_song
from selecta.config import SAMPLE_RATE, Settings
from selecta.planner.choose import Choice, choose_transition, enumerate_candidates, tempo_gap
from selecta.render.engine import SongCache, in_context

DEFAULT_MIX = (
    ("bass_swap_blend", 3),
    ("filter_sweep", 1),
    ("echo_out", 2),
    ("cut_on_one", 2),
    ("reverb_wash", 1),
    ("delay_throw", 1),
)
PAIRS_PER_STYLE = 1600
ATTEMPTS_PER_STYLE = 6
CONTEXT_BEFORE = 16.0
CONTEXT_AFTER = 24.0


@dataclass
class ReelEntry:
    file: str
    style: str
    a: str
    b: str
    why: str
    seam_at: float
    seconds: float
    tempo_gap: float
    keys: str
    bars: int
    audit: dict
    drift_ms: dict


def load_library(conn: sqlite3.Connection, settings: Settings) -> list[SongInfo]:
    rows = conn.execute(
        "SELECT song_id FROM analysis WHERE error IS NULL AND bpm IS NOT NULL ORDER BY song_id"
    ).fetchall()
    songs: list[SongInfo] = []
    for row in rows:
        song = load_song(conn, settings, row["song_id"])
        if not song.vocals_known and not song.instrumental:
            continue
        songs.append(song)
    return songs


def _fits_style(style: str, a: SongInfo, b: SongInfo) -> bool:
    """Show each move where a DJ would really reach for it."""
    gap = tempo_gap(a, b)
    if style in {"bass_swap_blend", "filter_sweep"}:
        return gap <= 0.05 and camelot_distance(a.camelot, b.camelot) <= 2
    if style in {"echo_out", "reverb_wash"}:
        return gap > 0.08 or a.family != b.family
    if style == "cut_on_one":
        return a.family == b.family or gap > 0.08
    return True


def _pick_pairs(
    style: str, library: list[SongInfo], used: set[int], rng: random.Random
) -> list[tuple[float, SongInfo, SongInfo]]:
    pool = [song for song in library if song.id not in used]
    scored: list[tuple[float, SongInfo, SongInfo]] = []
    for _ in range(PAIRS_PER_STYLE):
        if len(pool) < 2:
            break
        a, b = rng.sample(pool, 2)
        if a.artist == b.artist or not _fits_style(style, a, b):
            continue
        candidates = enumerate_candidates(a, b, style)
        if candidates:
            scored.append((candidates[0].score, a, b))
    scored.sort(key=lambda item: -item[0])
    return scored


def _entry(number: int, choice: Choice, out_dir: Path, cache: SongCache) -> ReelEntry:
    script = choice.rendered.script
    heard, clip_at = in_context(choice.rendered, CONTEXT_BEFORE, CONTEXT_AFTER, cache)
    name = f"{number:02d}_{script.style}.flac"
    sf.write(out_dir / name, heard, SAMPLE_RATE, subtype="PCM_16")
    a, b = script.a.song, script.b.song
    seam = clip_at + script.overlap[0]
    return ReelEntry(
        file=name,
        style=script.style,
        a=a.name,
        b=b.name,
        why="; ".join(choice.candidate.reasons),
        seam_at=round(seam, 2),
        seconds=round(heard.shape[0] / SAMPLE_RATE, 1),
        tempo_gap=round(tempo_gap(a, b) * 100, 1),
        keys=f"{a.camelot} to {b.camelot}",
        bars=choice.candidate.bars,
        audit={c.name: f"{c.value}{c.unit}" for c in choice.report.checks},
        drift_ms=choice.rendered.drift_ms,
    )


def build_reel(
    conn: sqlite3.Connection,
    settings: Settings,
    out_dir: Path,
    mix: tuple[tuple[str, int], ...] = DEFAULT_MIX,
    seed: int = 7,
    log=print,
) -> list[ReelEntry]:
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)
    library = load_library(conn, settings)
    log(f"{len(library)} analysed songs with vocal timing to choose from.")
    cache = SongCache(capacity=4)
    used: set[int] = set()
    entries: list[ReelEntry] = []
    number = 0
    for style, wanted in mix:
        for _ in range(wanted):
            pairs = _pick_pairs(style, library, used, rng)
            for _, a, b in pairs[:ATTEMPTS_PER_STYLE]:
                started = time.perf_counter()
                choice = choose_transition(a, b, style=style, cache=cache, max_repairs=2)
                if choice.fell_back or not choice.report.passed:
                    failed = [c.name for c in choice.report.failures]
                    log(f"  rejected {style}: {a.name} > {b.name} {failed}")
                    continue
                number += 1
                entry = _entry(number, choice, out_dir, cache)
                entries.append(entry)
                used.update((a.id, b.id))
                log(
                    f"{number:2d} {style:16s} {time.perf_counter() - started:5.1f}s "
                    f"{a.name[:30]} > {b.name[:30]}"
                )
                break
    (out_dir / "reel.json").write_text(
        json.dumps([e.__dict__ for e in entries], indent=2), encoding="utf-8"
    )
    (out_dir / "index.html").write_text(_page(entries), encoding="utf-8")
    return entries


_STYLE_NAMES = {
    "bass_swap_blend": "Bass swap blend",
    "filter_sweep": "Filter sweep",
    "echo_out": "Echo out",
    "cut_on_one": "Cut on the one",
    "reverb_wash": "Reverb wash",
    "delay_throw": "Delay throw",
}


def _page(entries: list[ReelEntry]) -> str:
    rows = "\n".join(_row(i, entry) for i, entry in enumerate(entries))
    return _PAGE.replace("{{rows}}", rows).replace("{{count}}", str(len(entries)))


def _row(index: int, entry: ReelEntry) -> str:
    style = _STYLE_NAMES.get(entry.style, entry.style)
    bars = f", {entry.bars} bars" if entry.bars else ""
    detail = f"{entry.tempo_gap}% tempo gap, keys {entry.keys}{bars}. {entry.why.capitalize()}."
    return f"""
<article data-index="{index}" data-style="{html.escape(entry.style)}">
  <header>
    <span class="n">{index + 1:02d}</span>
    <div>
      <h2>{html.escape(style)}</h2>
      <p class="pair">{html.escape(entry.a)}<i>into</i>{html.escape(entry.b)}</p>
      <p class="detail">{html.escape(detail)}</p>
    </div>
  </header>
  <audio controls preload="none" src="{html.escape(entry.file)}" data-seam="{entry.seam_at}"></audio>
  <div class="actions">
    <button class="jump">Jump to the seam</button>
    <button class="rate" data-rate="good" aria-pressed="false">Good</button>
    <button class="rate" data-rate="bad" aria-pressed="false">Bad</button>
    <input class="note" placeholder="What did you hear?" aria-label="Note on this transition">
  </div>
</article>"""


_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Selecta reel</title>
<style>
:root{--bg:#f6f4ef;--ink:#16140f;--soft:#6a655a;--line:#d8d3c7;--accent:#c8401f;--field:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#141310;--ink:#f3efe6;--soft:#a39d8f;--line:#37342c;--accent:#ff6a3d;--field:#1d1b17}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 16px 80px}
h1{font-size:clamp(48px,12vw,96px);line-height:.95;letter-spacing:-.04em;margin:0 0 16px;font-weight:800}
.lede{color:var(--soft);margin:0 0 32px;max-width:56ch}
article{border-top:1px solid var(--line);padding:24px 0}
header{display:flex;gap:16px}
.n{font:600 13px ui-monospace,monospace;color:var(--soft);padding-top:6px}
h2{margin:0;font-size:24px;letter-spacing:-.02em}
.pair{margin:4px 0 0;font-weight:500}
.pair i{font-style:normal;color:var(--accent);margin:0 8px;font-size:13px}
.detail{margin:4px 0 0;color:var(--soft);font-size:14px}
audio{width:100%;margin-top:16px}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
button{font:inherit;font-size:14px;padding:8px 14px;border:1px solid var(--line);background:transparent;color:inherit;border-radius:6px;cursor:pointer}
button:hover{border-color:var(--ink)}
button[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.note{flex:1 1 200px;font:inherit;font-size:14px;padding:8px 12px;border:1px solid var(--line);background:var(--field);color:inherit;border-radius:6px}
footer{border-top:1px solid var(--line);padding-top:24px}
#copy{background:var(--accent);border-color:var(--accent);color:#fff}
#status{margin-left:8px;color:var(--soft);font-size:14px}
textarea{width:100%;height:120px;margin-top:12px;font:13px ui-monospace,monospace;background:var(--field);color:inherit;border:1px solid var(--line);border-radius:6px;padding:8px;display:none}
</style></head><body><main>
<h1>Selecta reel</h1>
<p class="lede">{{count}} transitions from your own songs. Each one starts about 16 seconds before the seam. Use Jump to get 8 seconds ahead of it, rate it, and note anything you heard.</p>
{{rows}}
<footer>
<button id="copy">Copy my ratings</button><span id="status"></span>
<textarea id="out" readonly aria-label="Your ratings"></textarea>
</footer>
</main>
<script>
const KEY='selecta-reel-ratings';
let saved={};
try{saved=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(saved))}catch(e){}};
const players=[...document.querySelectorAll('audio')];
players.forEach(p=>p.addEventListener('play',()=>players.forEach(o=>{if(o!==p)o.pause()})));
document.querySelectorAll('article').forEach(card=>{
  const i=card.dataset.index,audio=card.querySelector('audio');
  const state=saved[i]||(saved[i]={style:card.dataset.style,rating:null,note:''});
  card.querySelector('.jump').onclick=()=>{
    audio.preload='auto';
    const go=()=>{audio.currentTime=Math.max(0,parseFloat(audio.dataset.seam)-8);audio.play()};
    audio.readyState>0?go():audio.addEventListener('loadedmetadata',go,{once:true});
    audio.load&&audio.readyState===0&&audio.load();
  };
  const buttons=card.querySelectorAll('.rate');
  const paint=()=>buttons.forEach(b=>b.setAttribute('aria-pressed',String(state.rating===b.dataset.rate)));
  buttons.forEach(b=>b.onclick=()=>{state.rating=state.rating===b.dataset.rate?null:b.dataset.rate;paint();persist()});
  const note=card.querySelector('.note');
  note.value=state.note||'';
  note.oninput=()=>{state.note=note.value;persist()};
  paint();
});
document.getElementById('copy').onclick=async()=>{
  const text=Object.entries(saved).map(([i,s])=>`${String(+i+1).padStart(2,'0')} ${s.style}: ${s.rating||'unrated'}${s.note?' - '+s.note:''}`).join('\\n');
  const out=document.getElementById('out'),status=document.getElementById('status');
  out.value=text;
  try{await navigator.clipboard.writeText(text);status.textContent='Copied. Paste it into the chat.'}
  catch(e){out.style.display='block';out.select();status.textContent='Copy this into the chat.'}
};
</script></body></html>
"""
