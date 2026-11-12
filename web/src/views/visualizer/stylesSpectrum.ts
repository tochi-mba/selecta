import { WAVE_POINTS } from './features';
import { cap, colour, hash, resample, smoothLine, type Painter } from './kit';

/** Frequency bars: the whole log-frequency spectrum, auto-gained, with falling peak caps. A kick
 * throws a bright full-width floor line and lifts the bass bars at once. */
export const bars: Painter = (context, width, height, f, brush, state) => {
  const count = Math.min(72, Math.max(24, Math.floor(width / 9)));
  const levels = resample(f.levels, count);
  if (!state.peaks || state.peaks.length !== count) state.peaks = new Float32Array(count);
  const peaks = state.peaks;
  const gap = Math.max(1, width / count * 0.22);
  const column = Math.max(1, (width - gap * (count - 1)) / count);
  const middle = height / 2;
  context.fillStyle = brush.gradient;
  context.globalAlpha = 0.92;
  levels.forEach((level, index) => {
    const lowBoost = index < count * 0.2 ? f.kick * 0.25 : 0;
    const size = Math.max(1, Math.min(1, level + lowBoost) * height * 0.86);
    context.fillRect(index * (column + gap), middle - size / 2, column, size);
    peaks[index] = Math.max(level + lowBoost, peaks[index] - f.dt / 1000 * 0.9);
  });
  context.fillStyle = colour(brush, 1);
  context.globalAlpha = 0.95;
  peaks.forEach((peak, index) => {
    if (peak <= 0.02) return;
    const y = middle - Math.min(1, peak) * height * 0.43;
    context.fillRect(index * (column + gap), y - 2, column, 2);
  });
  if (f.kick > 0.05) {
    context.globalAlpha = Math.min(1, f.kick);
    context.fillStyle = brush.accent;
    const thick = Math.max(2, height * 0.07 * f.kick);
    context.fillRect(0, middle - thick / 2, width, thick);
  }
};

/** Bar ribbon: a mirrored spectrum ribbon that breathes with the analysed bar. It is fullest on the
 * downbeat and narrows across the bar; kicks swell it and the beat dots mark where you are. */
export const ribbon: Painter = (context, width, height, f, brush) => {
  const n = 48;
  const levels = resample(f.levels, n, 0, 0.85);
  const breath = 0.45 + 0.55 * (1 - f.barPhase) ** 2;
  const scale = height * 0.42 * Math.min(1.25, breath + f.kick * 0.45);
  const middle = height / 2;
  const xs = levels.map((_, index) => width * index / (n - 1));
  const top = levels.map((level) => middle - Math.max(0.02, level) * scale);
  const bottom = levels.map((level) => middle + Math.max(0.02, level) * scale);
  context.beginPath();
  smoothLine(context, xs, top);
  for (let index = n - 1; index >= 0; index -= 1) context.lineTo(xs[index], bottom[index]);
  context.closePath();
  context.fillStyle = brush.gradient;
  context.globalAlpha = 0.5 + 0.4 * f.loudness;
  context.fill();
  context.beginPath();
  smoothLine(context, xs, top);
  context.strokeStyle = colour(brush, 1);
  context.lineWidth = Math.max(1.5, height * (0.012 + f.kick * 0.03));
  context.globalAlpha = 0.95;
  context.stroke();
  // one dot per beat of the bar, the current one filled
  const beats = f.beatsPerBar;
  for (let beat = 0; beat < beats; beat += 1) {
    const x = width * (beat + 0.5) / beats;
    const on = beat + 1 === f.beatInBar;
    context.globalAlpha = on ? 1 : 0.4;
    context.fillStyle = on ? brush.accent : colour(brush, 1);
    context.beginPath();
    context.arc(x, height * 0.93, Math.max(2, height * (on ? 0.035 + f.kick * 0.03 : 0.02)), 0, Math.PI * 2);
    context.fill();
  }
};

const ROWS = 32;
const COLUMNS = 96;

/** Scrolling spectrogram: time runs right to left and pitch bottom to top, so the song draws its own
 * score. Kicks stamp a bright block on the floor of the newest column. */
export const waterfall: Painter = (context, width, height, f, brush, state) => {
  state.columns.push({ levels: Float32Array.from(resample(f.levels, ROWS)), kick: f.kick, snare: f.snare });
  cap(state.columns, COLUMNS);
  const columnWidth = width / COLUMNS;
  const rowHeight = height / ROWS;
  const offset = COLUMNS - state.columns.length;
  // batch cells by brightness step: six fills, not three thousand
  for (let step = 1; step <= 6; step += 1) {
    context.beginPath();
    state.columns.forEach((column, index) => {
      const x = (offset + index) * columnWidth;
      for (let row = 0; row < ROWS; row += 1) {
        if (Math.min(6, Math.ceil(column.levels[row] * 6)) !== step) continue;
        context.rect(x, height - (row + 1) * rowHeight, columnWidth + 0.5, rowHeight + 0.5);
      }
    });
    context.fillStyle = step >= 5 ? colour(brush, 1) : brush.accent;
    context.globalAlpha = 0.1 + step * 0.14;
    context.fill();
  }
  context.fillStyle = brush.accent;
  state.columns.forEach((column, index) => {
    if (column.kick < 0.3) return;
    context.globalAlpha = Math.min(1, column.kick);
    context.fillRect((offset + index) * columnWidth, height - height * 0.18, columnWidth + 0.5, height * 0.18);
  });
  const newest = state.columns[state.columns.length - 1];
  if (newest && newest.kick > 0.05) {
    context.globalAlpha = Math.min(1, newest.kick);
    context.fillRect(width - columnWidth * 3, 0, columnWidth * 3, height);
  }
};

/** Kick pulse field: a wide grid of dots shaped by the spectrum. Every dot swells together on a kick,
 * so the whole field pumps with the drums and settles between them. */
export const pulse: Painter = (context, width, height, f, brush) => {
  const rows = 5;
  const spacing = height / rows;
  const columns = Math.max(12, Math.floor(width / spacing));
  const levels = resample(f.levels, columns);
  const radiusMax = spacing * 0.48;
  const pump = 0.22 + 0.78 * Math.max(f.kick, (f.bands[0] + f.bands[1]) * 0.35);
  for (let row = 0; row < rows; row += 1) {
    const distance = Math.abs(row - (rows - 1) / 2) / ((rows - 1) / 2);
    context.beginPath();
    for (let index = 0; index < columns; index += 1) {
      const level = levels[index];
      const radius = radiusMax * Math.min(1, pump * (0.35 + level * 0.9) * (1 - distance * 0.45 * (1 - level)));
      if (radius < 0.6) continue;
      const x = (index + 0.5) * width / columns;
      const y = (row + 0.5) * spacing;
      context.moveTo(x + radius, y);
      context.arc(x, y, radius, 0, Math.PI * 2);
    }
    context.fillStyle = row === 2 ? brush.accent : colour(brush, 1);
    context.globalAlpha = 0.45 + 0.5 * pump;
    context.fill();
  }
};

/** Bass horizon: a standing wave whose height is the sub and bass and which travels one wavelength
 * per beat of the analysed grid. A kick lifts a sun over the horizon. */
export const horizon: Painter = (context, width, height, f, brush) => {
  const bass = Math.max(f.bands[0], f.bands[1]);
  const line = height * 0.66;
  const sun = height * (0.08 + 0.3 * f.kick + 0.06 * bass);
  context.fillStyle = colour(brush, 3);
  context.globalAlpha = 0.35 + 0.6 * f.kick;
  context.beginPath();
  context.arc(width / 2, line, sun, Math.PI, 0);
  context.fill();
  const points = 64;
  const xs: number[] = [];
  const ys: number[] = [];
  const phase = (f.beatPhase + f.beatInBar - 1) * Math.PI * 2;
  for (let index = 0; index < points; index += 1) {
    const x = width * index / (points - 1);
    const travel = Math.sin(index / (points - 1) * Math.PI * 4 - phase);
    xs.push(x);
    ys.push(line - (0.04 + bass * 0.5) * height * 0.5 * travel - f.kick * height * 0.12);
  }
  context.beginPath();
  smoothLine(context, xs, ys);
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fillStyle = brush.gradient;
  context.globalAlpha = 0.85;
  context.fill();
  context.beginPath();
  smoothLine(context, xs, ys);
  context.strokeStyle = colour(brush, 1);
  context.lineWidth = Math.max(1.5, height * (0.015 + 0.03 * f.kick));
  context.globalAlpha = 1;
  context.stroke();
};

/** Hi-hat sparkle: each detected hi-hat scatters a handful of sparks across the width, and the air
 * band keeps a fine shimmer alive. A kick glows along the floor beneath them. */
export const sparkle: Painter = (context, width, height, f, brush, state) => {
  for (const hit of f.hits) {
    if (hit.kind !== 'hat' && hit.kind !== 'snare') continue;
    const count = hit.kind === 'hat' ? 9 : 5;
    for (let index = 0; index < count; index += 1) {
      const seed = (hit.kind === 'hat' ? f.hats : f.snares + 999) * 31 + index;
      state.particles.push({
        x: hash(seed) * width, y: (0.06 + hash(seed + 0.5) * 0.7) * height, vx: 0, vy: 0,
        born: f.now, life: hit.kind === 'hat' ? 340 : 520, size: (1.5 + hit.strength * 3.5) * (height / 120),
        colour: hit.kind === 'hat' ? 1 : 2,
      });
    }
  }
  state.particles = state.particles.filter((spark) => f.now - spark.born < spark.life);
  cap(state.particles, 160);
  if (f.kick > 0.03) {
    const glow = context.createLinearGradient?.(0, height, 0, height * 0.45);
    if (glow) {
      glow.addColorStop(0, brush.accent);
      glow.addColorStop(1, 'transparent');
      context.fillStyle = glow;
    } else context.fillStyle = brush.accent;
    context.globalAlpha = Math.min(0.85, f.kick);
    context.fillRect(0, height * 0.45, width, height * 0.55);
  }
  const shimmer = Math.round(f.bands[5] * 28);
  context.fillStyle = colour(brush, 1);
  context.globalAlpha = 0.35 + f.bands[5] * 0.4;
  context.beginPath();
  for (let index = 0; index < shimmer; index += 1) {
    const seed = index * 7.13 + Math.floor(f.now / 120);
    const x = hash(seed) * width;
    const y = hash(seed + 3) * height * 0.8;
    context.rect(x, y, 1.5, 1.5);
  }
  context.fill();
  for (const spark of state.particles) {
    const age = (f.now - spark.born) / spark.life;
    const size = spark.size * (1 - age * 0.6);
    context.globalAlpha = 1 - age;
    context.fillStyle = colour(brush, spark.colour);
    context.beginPath();
    context.moveTo(spark.x - size * 2, spark.y);
    context.lineTo(spark.x, spark.y - size * 0.5);
    context.lineTo(spark.x + size * 2, spark.y);
    context.lineTo(spark.x, spark.y + size * 0.5);
    context.closePath();
    context.fill();
  }
};

/** Oscilloscope: the actual waveform of the mix across the width, triggered so steady tones stand
 * still. Its trace thickens and turns accent on a kick. Without the waveform taps it holds a level
 * line at the measured loudness rather than drawing a made-up wave. */
export const scope: Painter = (context, width, height, f, brush, state) => {
  const middle = height / 2;
  const amplitude = height * 0.44;
  const wave = f.wave;
  if (state.prevWave && wave) {
    context.beginPath();
    for (let index = 0; index < WAVE_POINTS; index += 1) {
      const x = width * index / (WAVE_POINTS - 1);
      const y = middle - state.prevWave[index] * amplitude * 0.9;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.strokeStyle = colour(brush, 1);
    context.lineWidth = Math.max(1, height * 0.01);
    context.globalAlpha = 0.35;
    context.stroke();
  }
  context.beginPath();
  if (wave) {
    for (let index = 0; index < WAVE_POINTS; index += 1) {
      const x = width * index / (WAVE_POINTS - 1);
      const y = middle - wave[index] * amplitude;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    state.prevWave = Float32Array.from(wave);
  } else {
    // no waveform taps: a level line at the measured loudness, never a made-up wave
    const lift = f.loudness * amplitude * 0.5;
    context.moveTo(0, middle - lift);
    context.lineTo(width, middle - lift);
    context.moveTo(0, middle + lift);
    context.lineTo(width, middle + lift);
  }
  context.strokeStyle = f.kick > 0.3 ? brush.accent : colour(brush, 1);
  context.lineWidth = Math.max(1.5, height * (0.014 + 0.05 * f.kick));
  context.globalAlpha = 1;
  context.lineJoin = 'round';
  context.stroke();
  if (f.kick > 0.05) {
    context.fillStyle = brush.accent;
    context.globalAlpha = f.kick * 0.5;
    context.fillRect(0, middle - height * 0.45 * f.kick, width * 0.012 + 2, height * 0.9 * f.kick);
    context.fillRect(width - width * 0.012 - 2, middle - height * 0.45 * f.kick, width * 0.012 + 2, height * 0.9 * f.kick);
  }
};

/** Stereo field: one row per band, centred, spread towards the edges by the measured stereo width and
 * shifted by the balance. Brackets show the width; the low rows thump on a kick. */
export const stereo: Painter = (context, width, height, f, brush) => {
  const spread = f.width == null ? 0.25 : 0.12 + f.width * 1.6;
  const centre = width / 2 + (f.balance ?? 0) * width * 0.25;
  const rows = 6;
  const space = height / rows;
  for (let band = 0; band < rows; band += 1) {
    const level = f.bands[band];
    const kickLift = band < 2 ? f.kick * 0.35 : 0;
    const half = width * 0.5 * Math.min(1, (level + kickLift) * Math.min(1, spread));
    const y = height - (band + 1) * space + space * 0.2;
    const thick = space * (0.35 + (band < 2 ? f.kick * 0.4 : 0));
    context.fillStyle = band < 2 ? brush.accent : band < 4 ? colour(brush, 1) : colour(brush, 2);
    context.globalAlpha = 0.35 + level * 0.6;
    context.fillRect(Math.max(0, centre - half), y + (space * 0.6 - thick) / 2, Math.min(width, half * 2), thick);
  }
  const reach = width * 0.5 * Math.min(1, spread);
  context.strokeStyle = colour(brush, 1);
  context.lineWidth = Math.max(1.5, height * 0.015);
  context.globalAlpha = 0.9;
  context.beginPath();
  for (const x of [centre - reach, centre + reach]) {
    const tick = Math.sign(x - centre) * width * 0.012;
    context.moveTo(x - tick, height * 0.04);
    context.lineTo(x, height * 0.04);
    context.lineTo(x, height * 0.96);
    context.lineTo(x - tick, height * 0.96);
  }
  context.stroke();
};
