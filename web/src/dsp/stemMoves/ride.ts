/** Vocal ride: a port of src/selecta/styles/wordplay.py `vocal_ride` / `_ride`.
 *
 * B's band (drums, bass, melody) comes in under A, locked to A's bars, rising equal-power while a
 * lowpass opens from 300 Hz to 20 kHz, and the low end swaps on a bar line across one beat. A's
 * band leaves once A's own voice is carrying the ride, so A's voice ends up singing over B's band.
 * A's last word is sent into an in-time echo, and B's full mix takes over as B starts singing.
 *
 * Local mode finds A's last word and B's first from line-synced lyrics; the browser has none, so
 * both edges come from the vocal stem (singingSpans, then voiceEdge), as locate_voice_edge does.
 * Ride lengths follow wordreel.py ride_lengths: 16, 12, 8 or 4 bars, as long as A sings at least
 * half of it.
 */

import { fadeInPoints, type GainPoint } from '../crossfade';
import {
  barPins,
  beatIndexAt,
  gate,
  HANDOVER_SECONDS,
  KEY_NOT_CHECKED,
  leaveAfter,
  medianPeriod,
  outsideWindows,
  STEM_MOVES_IMPLEMENTATION,
  STRETCH_CONTEXT_SECONDS,
  timeAtBeat,
  warpAt,
  windowRange,
  type MoveRule,
  type StemEcho,
  type StemLayer,
  type StemPair,
  type StemRecipe,
} from './types';
import { singingSeconds, singingSpans, voiceEdge, type Span } from './voice';

/** word_blend's gates in wordreel.py modes_for, which a ride needs. */
export const RIDE_RULE: MoveRule = { label: 'a vocal ride', maxTempoGap: 0.08, minGrid: 0.8, maxKeyDistance: 2 };
export const RIDE_LENGTHS = [16, 12, 8, 4] as const;
export const MIN_RIDE_SINGING = 0.5;
/** wordreel.py `RIDE_BARS`: A must be singing over this many bars before its last word. */
export const RIDE_BARS = 4;
/** wordreel.py `WINDOW_LEAD`: B's band can start at most this long before its voice. */
export const WINDOW_LEAD = 30;
/** ride_exit_line leaves at least this much of A after the line it ends on. */
export const RIDE_TAIL_SECONDS = 15;
const PAD = 0.02;
const CROSSFADE = 0.015;
const BAND_LEAVES = 0.3;
const BAND_GONE = 0.65;
const EDGE_WORD_SECONDS = 0.3;

/** How many bars this ride could run, longest first, as far as A's singing carries it. */
export function rideLengths(spans: readonly Span[], end: number, barSeconds: number): number[] {
  const fit: number[] = [];
  for (const bars of RIDE_LENGTHS) {
    const seconds = bars * barSeconds;
    if (seconds > WINDOW_LEAD - 3) continue;
    if (singingSeconds(spans, end - seconds, end) / seconds >= MIN_RIDE_SINGING) fit.push(bars);
  }
  return fit.length ? fit : [8, 4];
}

interface Edges { aLine: Span; aEnd: number; bStart: number }

/** `_handoff_shift`: how many beats B sits ahead of A so bars line up and B's voice follows A's
 * by the smallest wait. Downbeats are grid indexes that are multiples of `perBar`. */
export function handoffShift(aWordBeat: number, bVoiceBeat: number, perBar: number): number {
  const base = Math.floor(bVoiceBeat / perBar) * perBar - Math.floor(aWordBeat / perBar) * perBar;
  let best: number | null = null;
  for (let k = -64; k <= 64; k += 1) {
    const shift = base + k * perBar;
    const wait = bVoiceBeat - shift - aWordBeat;
    if (wait >= -0.25 && (best === null || wait < bVoiceBeat - best - aWordBeat)) best = shift;
  }
  return best ?? base;
}

function buildRide(pair: StemPair, edges: Edges, bars: number, keyChecked: boolean, spans: readonly Span[]): StemRecipe {
  const { a, b } = pair;
  const perBar = pair.beatsPerBar?.a ?? 4;
  const beat = medianPeriod(a.beats);
  const wordEnd = edges.aEnd;
  const enterB = edges.bStart - PAD;
  const aWordBeat = beatIndexAt(a.beats, wordEnd);
  const bVoiceBeat = beatIndexAt(b.beats, edges.bStart);
  const shift = handoffShift(aWordBeat, bVoiceBeat, perBar);
  const latest = Math.max(bVoiceBeat - shift, aWordBeat) + 0.5;
  const aEnd = Math.ceil(latest / perBar) * perBar;
  const aStart = aEnd - bars * perBar;
  if (aStart < 0 || aEnd >= a.beats.length) return { refused: 'The first song\'s beat grid doesn\'t cover the ride.' };
  const start = a.beats[aStart];
  if (start < leaveAfter(pair)) return { refused: 'A ride here would leave the first song before it has played 30 seconds.' };
  const handoffBeat = beatIndexAt(b.beats, enterB) - shift;
  const handoff = timeAtBeat(a.beats, handoffBeat);
  const voiceEnd = wordEnd + PAD;
  const lastWord = Math.max(wordEnd - EDGE_WORD_SECONDS, edges.aLine[0]) - PAD;
  if (handoff <= start + 2 || voiceEnd > handoff + beat / 2) {
    return { refused: 'The next song\'s voice would come in before the first song\'s has finished.' };
  }
  const span = voiceEnd - start;
  const firstVoice = spans.find(([from]) => from >= start)?.[0] ?? start;
  let bandLeaves = Math.min(Math.max(start + span * BAND_LEAVES, firstVoice), voiceEnd - 2 * beat);
  let bandGone = Math.min(bandLeaves + span * (BAND_GONE - BAND_LEAVES), voiceEnd - beat);
  if (bandGone <= bandLeaves) {
    bandLeaves = start + span * BAND_LEAVES;
    bandGone = start + span * BAND_GONE;
  }
  const echoRoomBeats = Math.max((handoff - voiceEnd) / beat, 0);
  const echoRoom = Math.min(Math.max(echoRoomBeats / 2, 0), 1);
  const echo: StemEcho = { delaySeconds: beat, feedback: 0.15 + 0.25 * echoRoom, wet: 0.1 + 0.18 * echoRoom, returnHighpassHz: 220, dampLowpassHz: 6500 };
  const swap = start + Math.max(Math.round(bars * BAND_LEAVES), 1) * perBar * beat;
  const aLow: GainPoint[] = [[swap - beat / 2, 1], [swap + beat / 2, 0]];
  const bLow: GainPoint[] = [[swap - beat / 2, 0], [swap + beat / 2, 1]];
  const bandGain: GainPoint[] = [...fadeInPoints(start, bandGone), [handoff - CROSSFADE, 1], [handoff + CROSSFADE, 0]];
  const pins = barPins(pair, aStart, Math.ceil(handoffBeat / perBar) * perBar + perBar, shift);

  const aFrom = start - CROSSFADE - 0.02;
  const layers: StemLayer[] = [{
    side: 'a',
    stem: 'vocals',
    from: aFrom,
    until: voiceEnd + 0.1,
    sourceFrom: aFrom,
    gain: [[start - CROSSFADE, 0], [start + CROSSFADE, 1], [voiceEnd - CROSSFADE, 1], [voiceEnd + CROSSFADE, 0]],
    sends: [{ effect: 'echo', points: [[lastWord - 0.01, 0], [lastWord, 1], [voiceEnd, 1], [voiceEnd + 0.02, 0]] }],
  }];
  for (const stem of ['drums', 'bass', 'other'] as const) {
    layers.push({
      side: 'a',
      stem,
      from: aFrom,
      until: bandGone + 0.1,
      sourceFrom: aFrom,
      gain: [[start - CROSSFADE, 0], [start + CROSSFADE, 1], [bandLeaves, 1], [bandGone, 0]],
      eq: [{ band: 'low', points: aLow }],
    });
  }
  for (const stem of ['drums', 'bass', 'other'] as const) {
    layers.push({
      side: 'b',
      stem,
      from: start,
      until: handoff + 0.1,
      sourceFrom: warpAt(pins, start),
      gain: bandGain,
      eq: [{ band: 'low', points: bLow }],
      filter: [{ filter: 'lowpass', points: [[start, 300], [bandGone, 20000]] }],
    });
  }
  // A's stems read their own stretch context, as `_reaches` checks local's stretched stems.
  if (aFrom - STRETCH_CONTEXT_SECONDS < windowRange(pair.aWindow)[0]) {
    return { refused: 'The ride would start before the stretch of the first song that was split.' };
  }
  if (warpAt(pins, start) - STRETCH_CONTEXT_SECONDS < windowRange(pair.bWindow)[0]) {
    return { refused: 'The next song\'s band would have to start before the stretch that was split.' };
  }
  const outside = outsideWindows(pair, layers, pins);
  if (outside) return { refused: outside };
  const startAt = handoff - CROSSFADE;
  return {
    implementation: STEM_MOVES_IMPLEMENTATION,
    move: 'vocal_ride',
    startSeconds: start,
    endSeconds: handoff + CROSSFADE,
    windowSeconds: handoff + CROSSFADE - (start - CROSSFADE),
    bars,
    layers,
    native: {
      a: [[start - CROSSFADE, 1], [start + CROSSFADE, 0]],
      b: [[handoff - CROSSFADE, 0], [handoff + CROSSFADE, 1]],
    },
    bStartSourceAt: warpAt(pins, start),
    bSourcePerSecond: a.tempo.bpm / b.tempo.bpm,
    bWarp: pins,
    handoverToNative: { at: handoff + CROSSFADE, startAt, bSourceAt: warpAt(pins, startAt), crossfadeSeconds: 2 * CROSSFADE },
    echo,
    keyChecked,
    why: `The first song's voice rides the next song's band for ${bars} bars, its last word echoes out, and the next song takes over as its own voice comes in. Where each voice stops and starts was heard in the vocal stem, not read from lyrics.${keyChecked ? '' : ` ${KEY_NOT_CHECKED}`}`,
  };
}

/** A vocal ride from A into B, or why it can't be done. Spans can be passed in when the caller
 * has already sensed them; otherwise they are sensed from the windows' vocal stems. */
export function vocalRide(pair: StemPair, sensed?: { a: Span[]; b: Span[] }): StemRecipe {
  const checked = gate(pair, RIDE_RULE);
  if ('refused' in checked) return checked;
  const aSpans = sensed?.a ?? singingSpans(pair.aWindow);
  const bSpans = sensed?.b ?? singingSpans(pair.bWindow);
  if (!aSpans.length) return { refused: 'Nobody is singing near the end of the first song, so there\'s no voice to ride.' };
  if (!bSpans.length) return { refused: 'Nobody is singing near the start of the next song, so there\'s no voice to hand over to.' };
  const perBar = pair.beatsPerBar?.a ?? 4;
  const barSeconds = medianPeriod(pair.a.beats) * perBar;
  const [, aTo] = windowRange(pair.aWindow);
  const [, bTo] = windowRange(pair.bWindow);
  const bStarts: number[] = [];
  bSpans.forEach((line, index) => {
    const edge = voiceEdge(pair.bWindow, line, bSpans[index + 1]?.[0] ?? bTo, false);
    if (edge !== null) bStarts.push(edge);
  });
  if (!bStarts.length) return { refused: 'The next song\'s voice never starts cleanly enough to hand over to.' };
  let lastRefusal = 'The first song\'s voice never stops cleanly enough to ride.';
  for (let index = aSpans.length - 1; index >= 0; index -= 1) {
    const line = aSpans[index];
    const aEnd = voiceEdge(pair.aWindow, line, aSpans[index + 1]?.[0] ?? aTo, true);
    if (aEnd === null) continue;
    if (pair.a.durationSeconds - aEnd < RIDE_TAIL_SECONDS) continue;
    const ride = RIDE_BARS * barSeconds;
    if (singingSeconds(aSpans, aEnd - ride, aEnd) / ride < MIN_RIDE_SINGING) {
      lastRefusal = 'The first song isn\'t singing through enough of its last bars to carry a ride.';
      continue;
    }
    for (const bars of rideLengths(aSpans, aEnd, barSeconds)) {
      for (const bStart of bStarts) {
        const recipe = buildRide(pair, { aLine: line, aEnd, bStart }, bars, checked.keyChecked, aSpans);
        if (!('refused' in recipe)) return recipe;
        lastRefusal = recipe.refused;
      }
    }
  }
  return { refused: lastRefusal };
}
