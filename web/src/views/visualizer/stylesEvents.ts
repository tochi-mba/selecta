import { cap, colour, hash, smoothLine, type Painter } from './kit';

/** Onset bursts: every detected onset fires particles from the place on the frequency axis where the
 * sound changed most (bass on the left, cymbals on the right). They fly sideways and fade. */
export const bursts: Painter = (context, width, height, f, brush, state) => {
  for (const hit of f.hits) {
    const count = hit.kind === 'kick' ? 18 : hit.kind === 'hat' ? 6 : 11;
    const speed = (hit.kind === 'kick' ? 0.55 : 0.35) * width / 1000;
    for (let index = 0; index < count; index += 1) {
      const seed = f.onsets * 17 + index + (hit.kind === 'hat' ? 500 : 0);
      const angle = (hash(seed) - 0.5) * 1.1 + (index % 2 ? Math.PI : 0);
      const pace = speed * (0.4 + hash(seed + 1) * 0.9);
      state.particles.push({
        x: hit.position * width, y: height * (0.5 + (hash(seed + 2) - 0.5) * 0.3),
        vx: Math.cos(angle) * pace, vy: Math.sin(angle) * pace * 0.35,
        born: f.now, life: hit.kind === 'kick' ? 700 : 480,
        size: (hit.kind === 'kick' ? 4 : 2.5) * (0.6 + hit.strength) * (height / 120),
        colour: hit.kind === 'kick' ? 0 : hit.kind === 'snare' ? 2 : 1,
      });
    }
  }
  state.particles = state.particles.filter((particle) => f.now - particle.born < particle.life);
  cap(state.particles, 220);
  context.fillStyle = colour(brush, 1);
  context.globalAlpha = 0.25 + f.loudness * 0.4;
  context.fillRect(0, height / 2 - 0.75, width, 1.5);
  for (const tone of [0, 1, 2] as const) {
    context.beginPath();
    let any = false;
    for (const particle of state.particles) {
      if (particle.colour !== tone) continue;
      const age = f.now - particle.born;
      const x = particle.x + particle.vx * age;
      const y = particle.y + particle.vy * age;
      if (x < 0 || x > width || y < 0 || y > height) continue;
      const size = particle.size * (1 - age / particle.life * 0.7);
      context.moveTo(x + size, y);
      context.arc(x, y, size, 0, Math.PI * 2);
      any = true;
    }
    if (!any) continue;
    context.fillStyle = colour(brush, tone);
    context.globalAlpha = 0.85;
    context.fill();
  }
  if (f.kick > 0.05) {
    context.fillStyle = brush.accent;
    context.globalAlpha = f.kick;
    const x = f.onsetPosition * width;
    context.beginPath();
    context.arc(Math.min(width - 4, Math.max(4, x)), height / 2, height * 0.12 * f.kick + 2, 0, Math.PI * 2);
    context.fill();
  }
};

/** Section wash: broad horizontal colour fields. A new section of the song (from its analysis, or a
 * sharp measured energy change) crossfades the wash to the next theme colour; builds brighten it.
 * Kicks pulse the floor band; big flashes are limited to three a second. */
export const wash: Painter = (context, width, height, f, brush, state) => {
  if (state.sectionColour.to !== f.section) state.sectionColour = { from: state.sectionColour.to, to: f.section };
  const fade = f.sectionPulse;
  const bands = 4;
  const row = height / bands;
  for (let band = 0; band < bands; band += 1) {
    const energy = f.bands[Math.min(5, band * 2)] ?? 0;
    const base = 0.16 + 0.32 * f.loudness + 0.12 * Math.max(0, f.lift) + 0.18 * f.flash * (band === bands - 1 ? 1 : 0.4);
    context.fillStyle = colour(brush, state.sectionColour.to + band);
    context.globalAlpha = Math.min(0.9, base * (1 - fade * 0.6) + energy * 0.18);
    context.fillRect(0, band * row, width, row + 0.5);
    if (fade > 0.02) {
      context.fillStyle = colour(brush, state.sectionColour.from + band);
      context.globalAlpha = fade * 0.55;
      context.fillRect(0, band * row, width * fade, row + 0.5);
    }
  }
  context.fillStyle = brush.accent;
  context.globalAlpha = Math.min(1, 0.2 + f.kick);
  context.fillRect(0, height - height * (0.06 + 0.2 * f.kick), width, height * (0.06 + 0.2 * f.kick));
  if (fade > 0.05) {
    context.fillStyle = colour(brush, 1);
    context.globalAlpha = fade;
    context.fillRect(width * fade - 2, 0, 4, height);
  }
};

const LANE_WINDOW_MS = 4000;

/** Drum lanes: kick, snare and hi-hat on three rails, scrolling right to left like a step sequencer,
 * with the analysed beat grid behind them. You can read the groove: four-on-the-floor, backbeat, hats. */
export const lanes: Painter = (context, width, height, f, brush, state) => {
  for (const hit of f.hits) if (hit.kind !== 'onset') state.events.push(hit);
  state.events = state.events.filter((hit) => f.now - hit.at < LANE_WINDOW_MS);
  const lane = height / 3;
  const xFor = (ageMs: number) => width - (ageMs / LANE_WINDOW_MS) * width;
  context.strokeStyle = colour(brush, 1);
  context.lineWidth = 1;
  for (const beat of f.recentBeats) {
    if (beat.age * 1000 > LANE_WINDOW_MS) continue;
    const x = xFor(beat.age * 1000);
    context.globalAlpha = beat.downbeat ? 0.5 : 0.2;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  context.globalAlpha = 0.14;
  context.fillStyle = colour(brush, 1);
  for (let index = 0; index < 3; index += 1) context.fillRect(0, index * lane + lane * 0.46, width, lane * 0.08);
  const rows = { kick: 2, snare: 1, hat: 0 } as const;
  for (const hit of state.events) {
    if (hit.kind === 'onset') continue;
    const age = f.now - hit.at;
    const x = xFor(age);
    const size = lane * (0.3 + 0.5 * hit.strength) * (age < 120 ? 1.25 : 1);
    const w = Math.max(3, width * (hit.kind === 'hat' ? 0.004 : 0.009));
    context.fillStyle = hit.kind === 'kick' ? brush.accent : hit.kind === 'snare' ? colour(brush, 2) : colour(brush, 1);
    context.globalAlpha = Math.max(0.25, 1 - age / LANE_WINDOW_MS);
    context.fillRect(Math.max(0, x - w), rows[hit.kind] * lane + (lane - size) / 2, w, size);
  }
  if (f.kick > 0.05) {
    context.fillStyle = brush.accent;
    context.globalAlpha = f.kick * 0.6;
    context.fillRect(width - width * 0.05, 2 * lane, width * 0.05, lane);
  }
};

const STREAM_LENGTH = 160;

/** Energy streams: low, mid and high energy stacked as a flowing streamgraph that scrolls left over
 * the last few seconds. Section starts leave a marker; kicks tick the top edge. */
export const river: Painter = (context, width, height, f, brush, state) => {
  const low = (f.bands[0] + f.bands[1]) / 2;
  const mid = (f.bands[2] + f.bands[3]) / 2;
  const high = (f.bands[4] + f.bands[5]) / 2;
  state.streams.push(Float32Array.from([low, mid, high, f.kick, f.sectionPulse > 0.97 ? 1 : 0]));
  cap(state.streams, STREAM_LENGTH);
  const n = state.streams.length;
  const step = width / (STREAM_LENGTH - 1);
  const start = width - (n - 1) * step;
  const middle = height / 2;
  const scale = height * 0.16;
  const xs = state.streams.map((_, index) => start + index * step);
  let under = state.streams.map((sample) => middle + (sample[0] + sample[1] + sample[2]) * scale * 0.5 * (1 + sample[3] * 0.25));
  for (let layer = 0; layer < 3; layer += 1) {
    const over = state.streams.map((sample, index) => under[index] - sample[layer] * scale * (1 + sample[3] * 0.25));
    context.beginPath();
    smoothLine(context, xs, over);
    for (let index = n - 1; index >= 0; index -= 1) context.lineTo(xs[index], under[index]);
    context.closePath();
    context.fillStyle = colour(brush, layer === 0 ? 0 : layer === 1 ? 1 : 2);
    context.globalAlpha = 0.75;
    context.fill();
    under = over;
  }
  context.strokeStyle = colour(brush, 3);
  context.lineWidth = Math.max(1.5, height * 0.02);
  context.globalAlpha = 0.9;
  context.beginPath();
  state.streams.forEach((sample, index) => {
    if (sample[4]) { context.moveTo(xs[index], 0); context.lineTo(xs[index], height); }
    if (sample[3] > 0.6) { context.moveTo(xs[index], under[index] - 2); context.lineTo(xs[index], under[index] - height * 0.12 * sample[3]); }
  });
  context.stroke();
};

/** Beat grid: one cell per beat of the bar across the width, filling with the analysed beat phase.
 * Every onset is marked where it landed inside its beat, so you see pushes and syncopation. */
export const grid: Painter = (context, width, height, f, brush, state) => {
  for (const hit of f.hits) state.events.push({ ...hit, position: (f.beatInBar - 1 + f.beatPhase) / f.beatsPerBar });
  // marks from the bar before this one fade out when it restarts
  state.events = state.events.filter((hit) => f.now - hit.at < 2600);
  cap(state.events, 64);
  const beats = f.beatsPerBar;
  const cell = width / beats;
  const pad = Math.max(2, cell * 0.04);
  for (let beat = 0; beat < beats; beat += 1) {
    const current = beat + 1 === f.beatInBar;
    const x = beat * cell + pad;
    context.fillStyle = beat === 0 ? brush.accent : colour(brush, 1);
    context.globalAlpha = 0.14;
    context.fillRect(x, height * 0.15, cell - pad * 2, height * 0.7);
    if (current) {
      context.globalAlpha = 0.4 + 0.5 * f.kick;
      context.fillRect(x, height * 0.15, (cell - pad * 2) * f.beatPhase, height * 0.7);
    }
  }
  for (const hit of state.events) {
    const age = f.now - hit.at;
    const x = hit.position * width;
    const tall = hit.kind === 'kick' ? 0.7 : hit.kind === 'snare' ? 0.5 : 0.25;
    context.fillStyle = hit.kind === 'kick' ? brush.accent : hit.kind === 'snare' ? colour(brush, 2) : colour(brush, 1);
    context.globalAlpha = Math.max(0.15, 1 - age / 2600);
    context.fillRect(x - 1.5, height * (0.85 - tall), 3 + (hit.kind === 'kick' ? f.kick * 4 : 0), height * tall);
  }
  if (f.kick > 0.05) {
    context.fillStyle = brush.accent;
    context.globalAlpha = f.kick;
    context.fillRect(0, height * 0.9, width, height * 0.08 * (0.5 + f.kick));
  }
  if (!f.gridLocked) {
    context.fillStyle = colour(brush, 1);
    context.globalAlpha = 0.5;
    context.fillRect(0, height * 0.06, width * f.beatPhase, 2);
  }
};

/** Snare shockwave: each snare sends a pair of wavefronts from the centre to both edges; the mids
 * hum along the middle. Kicks squeeze the hum line and bloom from the centre. */
export const shock: Painter = (context, width, height, f, brush, state) => {
  for (const hit of f.hits) if (hit.kind === 'snare' || hit.kind === 'kick') state.events.push(hit);
  state.events = state.events.filter((hit) => f.now - hit.at < 900);
  const centre = width / 2;
  for (const hit of state.events) {
    const age = (f.now - hit.at) / 900;
    const reach = (hit.kind === 'snare' ? 1 : 0.55) * centre * Math.sqrt(age);
    context.strokeStyle = hit.kind === 'snare' ? colour(brush, 2) : brush.accent;
    context.lineWidth = Math.max(1.5, height * 0.06 * hit.strength * (1 - age));
    context.globalAlpha = (1 - age) * 0.95;
    context.beginPath();
    for (const x of [centre - reach, centre + reach]) {
      const bow = height * 0.12 * (1 - age);
      context.moveTo(x, height * 0.08);
      context.quadraticCurveTo(x + Math.sign(x - centre) * bow, height / 2, x, height * 0.92);
    }
    context.stroke();
  }
  const hum = (f.bands[2] + f.bands[3]) / 2;
  const squeeze = 1 - f.kick * 0.6;
  const n = 48;
  const xs: number[] = [];
  const ys: number[] = [];
  const mids = f.levels;
  for (let index = 0; index < n; index += 1) {
    xs.push(width * index / (n - 1));
    const bin = Math.floor(mids.length * (0.3 + 0.4 * index / (n - 1)));
    ys.push(height / 2 - (index % 2 ? 1 : -1) * mids[bin] * height * 0.18 * squeeze * (0.5 + hum));
  }
  context.beginPath();
  smoothLine(context, xs, ys);
  context.strokeStyle = colour(brush, 1);
  context.lineWidth = Math.max(1, height * 0.015);
  context.globalAlpha = 0.6 + hum * 0.4;
  context.stroke();
  if (f.kick > 0.05) {
    context.fillStyle = brush.accent;
    context.globalAlpha = f.kick * 0.8;
    context.beginPath();
    context.ellipse?.(centre, height / 2, width * 0.08 * f.kick + 3, height * 0.3 * f.kick + 2, 0, 0, Math.PI * 2);
    context.fill();
  }
};

/** Brightness tracer: a comet whose left-right position is the spectral centroid (dark sounds left,
 * bright right) and whose height is the loudness, trailing its recent path. Kicks swell it and ring. */
export const tracer: Painter = (context, width, height, f, brush, state) => {
  const x = width * (0.04 + 0.92 * f.centroid);
  const y = height * (0.88 - 0.76 * f.loudness);
  state.trail.push({ x, y });
  cap(state.trail, 48);
  context.strokeStyle = colour(brush, 1);
  context.lineCap = 'round';
  for (let index = 1; index < state.trail.length; index += 1) {
    const a = state.trail[index - 1];
    const b = state.trail[index];
    context.globalAlpha = index / state.trail.length * 0.8;
    context.lineWidth = Math.max(1, height * 0.04 * index / state.trail.length);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }
  // octave guides so the left-right axis reads as pitch brightness
  context.fillStyle = colour(brush, 1);
  context.globalAlpha = 0.18;
  for (let octave = 1; octave < 9; octave += 1) context.fillRect(width * octave / 9, height * 0.9, 1.5, height * 0.08);
  const radius = height * (0.05 + 0.18 * f.kick);
  context.fillStyle = brush.accent;
  context.globalAlpha = 1;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  if (f.kick > 0.1) {
    context.strokeStyle = brush.accent;
    context.lineWidth = 2;
    context.globalAlpha = f.kick;
    context.beginPath();
    context.arc(x, y, radius + height * 0.25 * (1 - f.kick) + 4, 0, Math.PI * 2);
    context.stroke();
  }
};
