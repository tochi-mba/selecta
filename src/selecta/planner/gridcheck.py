"""A by-ear check of the analysis, mostly on the music with no published benchmarks.

Each clip is a slice of a song with clicks on the beats, a higher click on each downbeat, and then
a soft drone in the detected key. A person can tell in seconds whether the clicks sit in the
pocket and whether the drone belongs. Nothing else can check this as directly.
"""

from __future__ import annotations

import html
import json
import random
import sqlite3
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from selecta.analysis.key import tonic_of_camelot
from selecta.analysis.song import SongInfo, load_song
from selecta.config import SAMPLE_RATE, Settings
from selecta.planner.reel import PAGE_STYLE
from selecta.render.engine import SongCache

CLIP_SECONDS = 20.0
DRONE_SECONDS = 8.0
FAMILY_PRIORITY = ("hiphop", "latin", "afro", "rnb", "dance", "pop", "rock", "other")


@dataclass
class GridClip:
    file: str
    song: str
    family: str
    bpm: float
    key: str
    confidence: float
    steady: bool


def _click(frequency: float, seconds: float = 0.03) -> np.ndarray:
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return (np.sin(2 * np.pi * frequency * t) * np.exp(-t * 120.0)).astype(np.float32)


def _drone(camelot: str, seconds: float) -> np.ndarray:
    tonic_pitch, major = tonic_of_camelot(camelot)
    root = 110.0 * 2.0 ** (((tonic_pitch - 9) % 12) / 12.0)
    third = root * (2.0 ** (4 / 12) if major else 2.0 ** (3 / 12))
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    tone = sum(np.sin(2 * np.pi * f * t) for f in (root, third, root * 1.5, root * 2))
    envelope = np.minimum(1.0, np.minimum(t, seconds - t) / 0.4)
    return (tone * envelope / 4.0).astype(np.float32)


def render_clip(song: SongInfo, native: np.ndarray) -> np.ndarray:
    bars = song.bar_times
    start_bar = int(np.searchsorted(bars, song.duration * 0.4))
    start = float(bars[min(start_bar, bars.size - 1)]) - song.period
    begin = max(0, int(start * SAMPLE_RATE))
    count = int(CLIP_SECONDS * SAMPLE_RATE)
    gain = 10.0 ** (song.gain_db / 20.0)
    clip = native[begin : begin + count] * gain * 0.7
    mono = np.zeros(clip.shape[0], dtype=np.float32)

    beat_click, bar_click = _click(1000.0), _click(2200.0)
    downbeats = set(song.bar_starts.tolist())
    for index, beat in enumerate(song.beats):
        at = int(round(beat * SAMPLE_RATE)) - begin
        if at < 0 or at >= mono.size:
            continue
        sound = bar_click if index in downbeats else beat_click
        length = min(sound.size, mono.size - at)
        mono[at : at + length] += sound[:length] * (0.5 if index in downbeats else 0.3)

    drone = _drone(song.camelot, DRONE_SECONDS)
    drone_at = max(0, mono.size - drone.size)
    mono[drone_at : drone_at + drone.size] += drone[: mono.size - drone_at] * 0.22
    return np.clip(clip + mono[:, None], -0.98, 0.98)


def _pick(songs: list[SongInfo], count: int, rng: random.Random) -> list[SongInfo]:
    chosen: list[SongInfo] = []
    rng.shuffle(songs)
    for family in FAMILY_PRIORITY:
        chosen += [song for song in songs if song.family == family][: max(2, count // 3)]
        if len(chosen) >= count:
            break
    return chosen[:count]


def build_grid_check(
    conn: sqlite3.Connection,
    settings: Settings,
    out_dir: Path,
    count: int = 20,
    seed: int = 5,
) -> list[GridClip]:
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = conn.execute(
        "SELECT song_id FROM analysis WHERE error IS NULL AND bpm IS NOT NULL AND version = "
        "(SELECT MAX(version) FROM analysis)"
    ).fetchall()
    songs = [load_song(conn, settings, row["song_id"]) for row in rows]
    cache = SongCache(capacity=2)
    clips: list[GridClip] = []
    for number, song in enumerate(_pick(songs, count, random.Random(seed)), 1):
        audio = render_clip(song, cache.get(song.path))
        name = f"grid_{number:02d}.flac"
        sf.write(out_dir / name, audio, SAMPLE_RATE, subtype="PCM_16")
        clips.append(
            GridClip(
                name,
                song.name,
                song.family,
                round(song.bpm, 1),
                song.camelot,
                round(song.grid_confidence, 2),
                song.constant_tempo,
            )
        )
    (out_dir / "grid.json").write_text(json.dumps([asdict(c) for c in clips], indent=2), "utf-8")
    (out_dir / "grid.html").write_text(_page(clips), "utf-8")
    return clips


def _page(clips: list[GridClip]) -> str:
    rows = "\n".join(_row(i, clip) for i, clip in enumerate(clips))
    return _PAGE.replace("{{style}}", PAGE_STYLE).replace("{{rows}}", rows)


def _row(index: int, clip: GridClip) -> str:
    return f"""
<article data-index="{index}" data-song="{html.escape(clip.song)}">
  <header><span class="n">{index + 1:02d}</span><div>
    <h2>{html.escape(clip.song)}</h2>
    <p class="detail">{clip.family}, {clip.bpm} BPM, key {clip.key}</p>
  </div></header>
  <audio controls preload="none" src="{clip.file}"></audio>
  <div class="actions">
    <button class="rate" data-group="beat" data-rate="good" aria-pressed="false">Beats fit</button>
    <button class="rate" data-group="beat" data-rate="off" aria-pressed="false">Beats off</button>
    <button class="rate" data-group="bar" data-rate="good" aria-pressed="false">High click on the one</button>
    <button class="rate" data-group="bar" data-rate="off" aria-pressed="false">High click off</button>
    <button class="rate" data-group="key" data-rate="good" aria-pressed="false">Drone fits</button>
    <button class="rate" data-group="key" data-rate="off" aria-pressed="false">Drone clashes</button>
  </div>
</article>"""


_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Selecta beat check</title>
<style>{{style}}</style></head><body><main>
<h1>Beat check</h1>
<p class="lede">Clicks mark where Selecta thinks the beats are, with a higher click on each downbeat. In the last 8 seconds a soft drone plays the key it detected. Do the clicks sit in the pocket, and does the drone belong? <a href="index.html">Back to the transitions</a>.</p>
{{rows}}
<footer>
<button id="copy">Copy my answers</button><span id="status"></span>
<textarea id="out" readonly aria-label="Your answers"></textarea>
</footer>
</main>
<script>
const KEY='selecta-grid-check';
let saved={};
try{saved=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(saved))}catch(e){}};
const players=[...document.querySelectorAll('audio')];
players.forEach(p=>p.addEventListener('play',()=>players.forEach(o=>{if(o!==p)o.pause()})));
document.querySelectorAll('article').forEach(card=>{
  const i=card.dataset.index;
  const state=saved[i]||(saved[i]={song:card.dataset.song});
  const buttons=[...card.querySelectorAll('.rate')];
  const paint=()=>buttons.forEach(b=>b.setAttribute('aria-pressed',String(state[b.dataset.group]===b.dataset.rate)));
  buttons.forEach(b=>b.onclick=()=>{const g=b.dataset.group;state[g]=state[g]===b.dataset.rate?null:b.dataset.rate;paint();persist()});
  paint();
});
document.getElementById('copy').onclick=async()=>{
  const text=Object.entries(saved).map(([i,s])=>`${String(+i+1).padStart(2,'0')} ${s.song}: beats ${s.beat||'-'}, downbeat ${s.bar||'-'}, key ${s.key||'-'}`).join('\\n');
  const out=document.getElementById('out'),status=document.getElementById('status');
  out.value=text;
  try{await navigator.clipboard.writeText(text);status.textContent='Copied. Paste it into the chat.'}
  catch(e){out.style.display='block';out.select();status.textContent='Copy this into the chat.'}
};
</script></body></html>
"""
