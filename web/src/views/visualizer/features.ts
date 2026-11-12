/**
 * The shared musical feature layer for the Listen visualizers (docs/engineering/visualizer-design.md).
 *
 * Every value here is measured: it comes from the live analyser of the playing mix, or from the
 * song's own analysis (its beat grid and sections). Nothing is simulated. Motion in the styles
 * comes from these real events (a kick, a hi-hat, a bar line, a section change), which is the
 * honest form of the old "never invent signal" rule: geometry may be expressive, but every change
 * on screen is caused by something that happened in the music.
 */

/** Six bands, low to high: sub, bass, low mids, high mids, presence and air. */
export const BAND_EDGES: readonly [number, number][] = [
  [20, 60], [60, 160], [160, 800], [800, 2500], [2500, 6000], [6000, 16000],
];
export const BAND_NAMES = ['sub', 'bass', 'low mids', 'high mids', 'presence', 'air'] as const;
/** Log-spaced display bins from 30 Hz to 16 kHz. */
export const LEVEL_COUNT = 64;
export const WAVE_POINTS = 256;
/** WCAG 2.3.1: big flashes are held to three a second at most. */
export const MAX_FLASHES_PER_SECOND = 3;
const FLASH_GAP_MS = 1000 / MAX_FLASHES_PER_SECOND + 1;
const LOW_HZ = 30;
const HIGH_HZ = 16000;
/** Below this the analyser is hearing nothing (byte data 0 is -100 dB by default). */
const SILENT_DB = -95;
/** Auto-gain windows: the loudest recent level maps to 1 and this many dB below it to 0. */
const LEVEL_SPAN_DB = 34;
const BAND_SPAN_DB = 26;
/** How fast the auto-gain ceiling follows a song down into a quiet passage. */
const CEILING_FALL_DB_PER_S = 4;

export type BeatGrid = { beats: number[]; bars: number[]; sections: number[]; beatsPerBar: number };

export type FrameInput = {
  /** performance.now() in ms. */
  now: number;
  /** Measured dB per FFT bin (0 Hz to Nyquist), or null when the analyser has nothing. */
  db: Float32Array | null;
  sampleRate: number;
  /** Time-domain samples (-1..1) for the left and right channels when the taps exist. */
  left?: Float32Array | null;
  right?: Float32Array | null;
  /** Position in the song (s) when known, for the analysed beat grid and sections. */
  songTime?: number | null;
  grid?: BeatGrid | null;
};

export type Hit = { at: number; kind: 'kick' | 'snare' | 'hat' | 'onset'; strength: number; position: number };

export type Features = {
  silent: boolean;
  /** ms since the previous frame (bounded). */
  dt: number;
  now: number;
  /** Six band envelopes 0..1, auto-gained per band, fast attack and slow release. */
  bands: number[];
  /** LEVEL_COUNT log-frequency levels 0..1 (half A-weighted, auto-gained as one spectrum). */
  levels: Float32Array;
  /** Overall loudness envelope 0..1 after auto-gain, and the measured level in dB. */
  loudness: number;
  db: number;
  /** dB the auto-gain is lifting this song by, relative to a full-scale master. */
  gain: number;
  /** Decaying 0..1 envelopes that jump to the hit's strength on the frame it is detected. */
  kick: number;
  snare: number;
  hat: number;
  onset: number;
  /** Hits detected on THIS frame, plus running counts. */
  hits: Hit[];
  kicks: number;
  snares: number;
  hats: number;
  onsets: number;
  /** 0..1 position on the log-frequency axis of the strongest change in the last onset. */
  onsetPosition: number;
  /** 0..1 spectral centroid on the log-frequency axis (dark to bright). */
  centroid: number;
  /** Beat and bar phase 0..1. Locked to the song's analysed grid when gridLocked. */
  beatPhase: number;
  barPhase: number;
  beatInBar: number;
  beatsPerBar: number;
  gridLocked: boolean;
  /** Ages (s) of grid beats in the last few seconds, newest first; downbeats flagged. */
  recentBeats: { age: number; downbeat: boolean }[];
  section: number;
  /** 0..1, jumps to 1 when a section starts (or the energy changes sharply) and fades. */
  sectionPulse: number;
  /** -1..1, recent loudness against the longer-term level: a build or a drop. */
  lift: number;
  /** Stereo width 0 (mono) to 1 (all side), and balance -1 (left) to 1 (right). Null without taps. */
  width: number | null;
  balance: number | null;
  /** WAVE_POINTS samples of the triggered waveform (auto-gained), or null without taps. */
  wave: Float32Array | null;
  /** A 0..1 flash envelope for large-area brightness changes, never more than 3 a second. */
  flash: number;
};

type Detector = { mean: number; dev: number; last: number; floor: number; gap: number };

function follow(current: number, target: number, dt: number, attackMs: number, releaseMs: number) {
  const tau = target > current ? attackMs : releaseMs;
  return current + (target - current) * (1 - Math.exp(-dt / Math.max(1, tau)));
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** A-weighting in dB (IEC 61672). */
export function aWeighting(hz: number): number {
  if (hz <= 0) return -80;
  const f2 = hz * hz;
  const ra = (12194 ** 2 * f2 * f2)
    / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return 20 * Math.log10(ra) + 2;
}

/** Byte analyser output to dB, using the AnalyserNode's default -100..-30 dB range. */
export function bytesToDb(bytes: Uint8Array, out?: Float32Array, minDb = -100, maxDb = -30): Float32Array {
  const target = out && out.length === bytes.length ? out : new Float32Array(bytes.length);
  const span = (maxDb - minDb) / 255;
  for (let index = 0; index < bytes.length; index += 1) target[index] = minDb + bytes[index] * span;
  return target;
}

function search(times: number[], at: number): number {
  let low = 0;
  let high = times.length - 1;
  if (high < 0 || at < times[0]) return -1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (times[mid] <= at) low = mid; else high = mid - 1;
  }
  return low;
}

export type FeatureTracker = { update(input: FrameInput): Features; reset(): void };

export function createFeatureTracker(): FeatureTracker {
  const bands = [0, 0, 0, 0, 0, 0];
  const bandCeil = [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity, -Infinity];
  const levels = new Float32Array(LEVEL_COUNT);
  const rawLevels = new Float32Array(LEVEL_COUNT);
  const wave = new Float32Array(WAVE_POINTS);
  let previous: Float32Array | null = null;
  let levelCeil = -Infinity;
  let loudCeil = -Infinity;
  let waveCeil = 0;
  let loudness = 0;
  let shortDb = -Infinity;
  let longDb = -Infinity;
  let lastNow = -Infinity;
  let kick = 0; let snare = 0; let hat = 0; let onset = 0;
  let kicks = 0; let snares = 0; let hats = 0; let onsets = 0;
  let onsetPosition = 0.5;
  let centroid = 0;
  let width: number | null = null;
  let balance: number | null = null;
  let flash = 0;
  let lastFlash = -Infinity;
  let section = -1;
  let sectionPulse = 0;
  let lastSongTime: number | null = null;
  let lastEnergyPulse = -Infinity;
  const kickTimes: number[] = [];
  const detectors: Record<'kick' | 'snare' | 'hat' | 'onset', Detector> = {
    kick: { mean: 0, dev: 0, last: -Infinity, floor: 2.2, gap: 150 },
    snare: { mean: 0, dev: 0, last: -Infinity, floor: 1.8, gap: 130 },
    hat: { mean: 0, dev: 0, last: -Infinity, floor: 1.4, gap: 75 },
    onset: { mean: 0, dev: 0, last: -Infinity, floor: 1.2, gap: 90 },
  };
  let binMap: { size: number; rate: number; level: Int32Array[]; band: Int32Array[]; weight: Float32Array; centre: Float32Array } | null = null;

  function mapFor(size: number, rate: number) {
    if (binMap && binMap.size === size && binMap.rate === rate) return binMap;
    const hzPerBin = rate / 2 / size;
    const binOf = (hz: number) => Math.min(size - 1, Math.max(0, Math.round(hz / hzPerBin)));
    const level: Int32Array[] = [];
    const weight = new Float32Array(LEVEL_COUNT);
    const centre = new Float32Array(LEVEL_COUNT);
    for (let index = 0; index < LEVEL_COUNT; index += 1) {
      const low = LOW_HZ * (HIGH_HZ / LOW_HZ) ** (index / LEVEL_COUNT);
      const high = LOW_HZ * (HIGH_HZ / LOW_HZ) ** ((index + 1) / LEVEL_COUNT);
      const first = binOf(low);
      const last = Math.max(first, binOf(high) - 1);
      level.push(Int32Array.from({ length: last - first + 1 }, (_, offset) => first + offset));
      centre[index] = Math.sqrt(low * high);
      // Half A-weighting: tames the sub-bass bulge every master has without erasing the kick.
      weight[index] = aWeighting(centre[index]) * 0.5;
    }
    const band = BAND_EDGES.map(([low, high]) => {
      const first = Math.max(0, Math.floor(low / hzPerBin));
      const last = Math.max(first, Math.min(size - 1, Math.ceil(high / hzPerBin) - 1));
      return Int32Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
    });
    binMap = { size, rate, level, band, weight, centre };
    return binMap;
  }

  function detect(name: keyof typeof detectors, flux: number, now: number, dt: number): number {
    const detector = detectors[name];
    const threshold = detector.mean + 1.6 * detector.dev + detector.floor;
    const hit = flux > threshold && now - detector.last >= detector.gap;
    // Adaptive threshold: the running mean and deviation of this detector's flux over about a second.
    const rate = 1 - Math.exp(-dt / 900);
    detector.mean += (flux - detector.mean) * rate;
    detector.dev += (Math.abs(flux - detector.mean) - detector.dev) * rate;
    if (!hit) return 0;
    detector.last = now;
    return clamp01((flux - threshold) / (threshold + 4) + 0.55);
  }

  function silentFeatures(now: number, dt: number): Features {
    bands.fill(0); levels.fill(0);
    kick = snare = hat = onset = flash = loudness = 0;
    previous = null;
    return {
      silent: true, dt, now, bands: [...bands], levels, loudness: 0, db: -Infinity, gain: 0,
      kick: 0, snare: 0, hat: 0, onset: 0, hits: [], kicks, snares, hats, onsets, onsetPosition,
      centroid: 0, beatPhase: 0, barPhase: 0, beatInBar: 1, beatsPerBar: 4, gridLocked: false,
      recentBeats: [], section, sectionPulse: 0, lift: 0, width: null, balance: null, wave: null, flash: 0,
    };
  }

  function update(input: FrameInput): Features {
    const now = input.now;
    const dt = Number.isFinite(lastNow) ? Math.min(250, Math.max(1, now - lastNow)) : 33;
    lastNow = now;
    const db = input.db;
    let loudest = -Infinity;
    if (db) for (let index = 0; index < db.length; index += 1) if (db[index] > loudest) loudest = db[index];
    if (!db || !db.length || !(loudest > SILENT_DB)) return silentFeatures(now, dt);
    const map = mapFor(db.length, input.sampleRate || 44100);
    const hits: Hit[] = [];

    // 1. Log-frequency levels with half A-weighting, auto-gained as one spectrum so its shape stays true.
    let frameMax = -Infinity;
    let centroidSum = 0;
    let centroidWeight = 0;
    for (let index = 0; index < LEVEL_COUNT; index += 1) {
      let peak = -Infinity;
      for (const bin of map.level[index]) if (db[bin] > peak) peak = db[bin];
      const value = Math.max(-120, peak) + map.weight[index];
      rawLevels[index] = value;
      if (value > frameMax) frameMax = value;
      const power = 10 ** (value / 20);
      centroidSum += power * index;
      centroidWeight += power;
    }
    levelCeil = Number.isFinite(levelCeil) ? Math.max(frameMax, levelCeil - CEILING_FALL_DB_PER_S * dt / 1000) : frameMax;
    for (let index = 0; index < LEVEL_COUNT; index += 1) {
      const target = clamp01((rawLevels[index] - levelCeil + LEVEL_SPAN_DB) / LEVEL_SPAN_DB) ** 1.3;
      levels[index] = follow(levels[index], target, dt, 12, 170);
    }
    centroid = follow(centroid, centroidWeight > 0 ? centroidSum / centroidWeight / (LEVEL_COUNT - 1) : 0, dt, 60, 260);

    // 2. Band energies (mean power in dB), each with its own auto-gain like Milkdrop's bass/mid/treb.
    let totalPower = 0;
    const bandDb = map.band.map((bins) => {
      let power = 0;
      for (const bin of bins) power += 10 ** (Math.max(-120, db[bin]) / 10);
      totalPower += power;
      return 10 * Math.log10(power / bins.length + 1e-12);
    });
    bandDb.forEach((value, index) => {
      bandCeil[index] = Number.isFinite(bandCeil[index])
        ? Math.max(value, bandCeil[index] - CEILING_FALL_DB_PER_S * dt / 1000) : value;
      const target = clamp01((value - bandCeil[index] + BAND_SPAN_DB) / BAND_SPAN_DB) ** 1.4;
      bands[index] = follow(bands[index], target, dt, 10, 240);
    });
    const overall = 10 * Math.log10(totalPower + 1e-12);
    loudCeil = Number.isFinite(loudCeil) ? Math.max(overall, loudCeil - CEILING_FALL_DB_PER_S * dt / 1000) : overall;
    loudness = follow(loudness, clamp01((overall - loudCeil + BAND_SPAN_DB) / BAND_SPAN_DB) ** 1.3, dt, 15, 300);
    shortDb = Number.isFinite(shortDb) ? follow(shortDb, overall, dt, 900, 900) : overall;
    longDb = Number.isFinite(longDb) ? follow(longDb, overall, dt, 8000, 8000) : overall;
    const lift = Math.max(-1, Math.min(1, (shortDb - longDb) / 9));

    // 3. Spectral flux (half-wave rectified rise in dB) per region, then adaptive-threshold peak picking.
    let lowFlux = 0; let lowCount = 0; let midFlux = 0; let midCount = 0;
    let highFlux = 0; let highCount = 0; let allFlux = 0; let strongest = 0; let strongestAt = 0;
    if (previous && previous.length === db.length) {
      const hzPerBin = (input.sampleRate || 44100) / 2 / db.length;
      for (let bin = 1; bin < db.length; bin += 1) {
        const hz = bin * hzPerBin;
        if (hz > HIGH_HZ) break;
        const rise = Math.max(0, Math.max(-100, db[bin]) - Math.max(-100, previous[bin]));
        allFlux += rise;
        if (hz < 160) { lowFlux += rise; lowCount += 1; }
        else if ((hz >= 160 && hz < 300) || (hz >= 1500 && hz < 5000)) { midFlux += rise; midCount += 1; }
        if (hz >= 7000) { highFlux += rise; highCount += 1; }
        if (rise > strongest) { strongest = rise; strongestAt = hz; }
      }
    }
    if (!previous || previous.length !== db.length) previous = new Float32Array(db.length);
    previous.set(db);
    const low = lowCount ? lowFlux / lowCount : 0;
    const mid = midCount ? midFlux / midCount : 0;
    const high = highCount ? highFlux / highCount : 0;
    const broad = allFlux / Math.max(1, db.length * 0.6);
    const toAxis = (hz: number) => clamp01(Math.log(Math.max(LOW_HZ, hz) / LOW_HZ) / Math.log(HIGH_HZ / LOW_HZ));
    const kickHit = detect('kick', low, now, dt);
    // a snare is a mid-band rise that the low band does not dominate
    const snareHit = detect('snare', mid, now, dt) * (mid > low * 0.6 ? 1 : 0);
    const hatHit = detect('hat', high, now, dt) * (high > mid * 0.8 ? 1 : 0);
    const onsetHit = detect('onset', broad, now, dt);
    const decay = (value: number, ms: number) => value * Math.exp(-dt / ms);
    kick = Math.max(decay(kick, 160), kickHit);
    snare = Math.max(decay(snare, 190), snareHit);
    hat = Math.max(decay(hat, 90), hatHit);
    onset = Math.max(decay(onset, 200), onsetHit, kickHit, snareHit);
    if (kickHit) {
      kicks += 1;
      kickTimes.push(now);
      if (kickTimes.length > 9) kickTimes.shift();
      hits.push({ at: now, kind: 'kick', strength: kickHit, position: toAxis(Math.max(40, strongestAt < 200 ? strongestAt : 70)) });
    }
    if (snareHit) { snares += 1; hits.push({ at: now, kind: 'snare', strength: snareHit, position: toAxis(strongestAt || 2000) }); }
    if (hatHit) { hats += 1; hits.push({ at: now, kind: 'hat', strength: hatHit, position: toAxis(Math.max(7000, strongestAt)) }); }
    if (onsetHit || kickHit || snareHit) {
      onsets += 1;
      onsetPosition = toAxis(strongestAt || 100);
      if (onsetHit && !kickHit && !snareHit) hits.push({ at: now, kind: 'onset', strength: onsetHit, position: onsetPosition });
    }

    // 4. Beat and bar phase: the analysed grid when the song has one, otherwise the measured kicks.
    let beatPhase = 0; let barPhase = 0; let beatInBar = 1; let gridLocked = false;
    const beatsPerBar = Math.max(1, Math.round(input.grid?.beatsPerBar ?? 4));
    const recentBeats: { age: number; downbeat: boolean }[] = [];
    const time = input.songTime;
    const grid = input.grid;
    if (grid && time != null && grid.beats.length > 1) {
      const beat = search(grid.beats, time);
      if (beat >= 0 && beat < grid.beats.length - 1) {
        gridLocked = true;
        beatPhase = (time - grid.beats[beat]) / Math.max(1e-3, grid.beats[beat + 1] - grid.beats[beat]);
        const bar = search(grid.bars, time);
        if (bar >= 0 && bar < grid.bars.length - 1) {
          barPhase = (time - grid.bars[bar]) / Math.max(1e-3, grid.bars[bar + 1] - grid.bars[bar]);
          beatInBar = Math.max(1, Math.min(beatsPerBar, Math.floor(barPhase * beatsPerBar) + 1));
        } else {
          barPhase = ((beat % beatsPerBar) + beatPhase) / beatsPerBar;
          beatInBar = (beat % beatsPerBar) + 1;
        }
        const barSet = grid.bars;
        for (let index = beat; index >= 0 && time - grid.beats[index] < 6; index -= 1) {
          const at = grid.beats[index];
          const downbeat = barSet.length ? Math.abs(barSet[Math.max(0, search(barSet, at + 0.02))] - at) < 0.05 : index % beatsPerBar === 0;
          recentBeats.push({ age: time - at, downbeat });
        }
      }
    }
    if (!gridLocked && kickTimes.length) {
      const gaps = kickTimes.slice(1).map((at, index) => at - kickTimes[index]).filter((gap) => gap > 250 && gap < 1500).sort((a, b) => a - b);
      const interval = gaps.length ? gaps[gaps.length >> 1] : 500;
      beatPhase = clamp01((now - kickTimes[kickTimes.length - 1]) / interval);
      const count = kicks % beatsPerBar;
      barPhase = clamp01((count + beatPhase) / beatsPerBar);
      beatInBar = count + 1;
    }

    // 5. Sections from the analysis, or a sharp measured energy change when there are none.
    const sections = grid?.sections ?? [];
    if (time != null && sections.length) {
      const now_section = search(sections, time);
      const continuous = lastSongTime != null && Math.abs(time - lastSongTime) < 1;
      if (now_section !== section) {
        if (continuous && section !== -1 && now_section > section) sectionPulse = 1;
        section = now_section;
      }
    } else if (Math.abs(shortDb - longDb) > 6 && now - lastEnergyPulse > 4000) {
      lastEnergyPulse = now;
      section += 1;
      sectionPulse = 1;
    }
    lastSongTime = time ?? null;
    sectionPulse = decay(sectionPulse, 1100);

    // 6. Stereo width and the triggered waveform from the left and right taps.
    const left = input.left;
    const right = input.right;
    let triggered = false;
    if (left && left.length) {
      const other = right && right.length === left.length ? right : left;
      let mid2 = 0; let side2 = 0; let l2 = 0; let r2 = 0;
      for (let index = 0; index < left.length; index += 1) {
        const m = (left[index] + other[index]) / 2;
        const s = (left[index] - other[index]) / 2;
        mid2 += m * m; side2 += s * s; l2 += left[index] ** 2; r2 += other[index] ** 2;
      }
      // a mono source reaches the splitter as left only; that is mono, not hard-left
      const mono = r2 < l2 * 1e-4 || l2 < r2 * 1e-4;
      const measured = mono ? 0 : Math.sqrt(side2) / (Math.sqrt(mid2) + Math.sqrt(side2) + 1e-9);
      width = width == null ? measured : follow(width, measured, dt, 60, 220);
      const measuredBalance = mono ? 0 : (Math.sqrt(r2) - Math.sqrt(l2)) / (Math.sqrt(r2) + Math.sqrt(l2) + 1e-9);
      balance = balance == null ? measuredBalance : follow(balance, measuredBalance, dt, 80, 260);
      // trigger on a rising zero crossing so the trace stands still for a steady tone
      let start = 0;
      const span = Math.min(left.length, WAVE_POINTS * 2);
      for (let index = 1; index < left.length - span; index += 1) {
        const before = left[index - 1] + other[index - 1];
        const after = left[index] + other[index];
        if (before <= 0 && after > 0) { start = index; break; }
      }
      let peak = 0;
      const stride = span / WAVE_POINTS;
      for (let index = 0; index < WAVE_POINTS; index += 1) {
        const at = Math.min(left.length - 1, start + Math.floor(index * stride));
        const value = (left[at] + other[at]) / 2;
        wave[index] = value;
        peak = Math.max(peak, Math.abs(value));
      }
      waveCeil = Math.max(peak, waveCeil * Math.exp(-dt / 2500), 1e-4);
      for (let index = 0; index < WAVE_POINTS; index += 1) wave[index] = Math.max(-1, Math.min(1, wave[index] / waveCeil));
      triggered = true;
    } else {
      width = null;
      balance = null;
    }

    // 7. Large flashes follow kicks and section starts, but never more than three a second.
    if ((kickHit > 0.5 || sectionPulse > 0.95) && now - lastFlash >= FLASH_GAP_MS) {
      lastFlash = now;
      flash = 1;
    } else flash = decay(flash, 110);

    return {
      silent: false, dt, now, bands: [...bands], levels, loudness, db: overall, gain: Math.max(0, -30 - loudCeil),
      kick, snare, hat, onset, hits, kicks, snares, hats, onsets, onsetPosition, centroid,
      beatPhase: clamp01(beatPhase), barPhase: clamp01(barPhase), beatInBar, beatsPerBar, gridLocked,
      recentBeats, section, sectionPulse, lift, width, balance, wave: triggered ? wave : null, flash,
    };
  }

  function reset() {
    previous = null;
    bands.fill(0); levels.fill(0);
    bandCeil.fill(-Infinity);
    levelCeil = loudCeil = shortDb = longDb = -Infinity;
    lastNow = -Infinity;
    kick = snare = hat = onset = flash = loudness = centroid = 0;
    kickTimes.length = 0;
    section = -1; sectionPulse = 0; lastSongTime = null; width = null; balance = null; waveCeil = 0;
    for (const detector of Object.values(detectors)) { detector.mean = 0; detector.dev = 0; detector.last = -Infinity; }
  }

  return { update, reset };
}
