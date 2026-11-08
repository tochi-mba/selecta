/** Display-only renderers for the actual analyser output. No audio, clock or
 * server writes happen here. All four optional modes are horizontal by design. */
export type SpectrumShape = 'bars' | 'ribbon' | 'aurora' | 'lanes' | 'constellation' | 'waterfall';

export const SPECTRUM_MODES: { id: SpectrumShape; label: string; description: string }[] = [
  { id: 'bars', label: 'Frequency bars', description: 'Measured frequencies, centred bars' },
  { id: 'ribbon', label: 'Frequency ribbon', description: 'Continuous, mirrored spectrum across the width' },
  { id: 'aurora', label: 'Aurora contours', description: 'Three measured-frequency contour layers' },
  { id: 'lanes', label: 'Spectral lanes', description: 'Bass, low mids, high mids and treble on separate rails' },
  { id: 'constellation', label: 'Frequency constellation', description: 'Measured points connected across the width' },
  { id: 'waterfall', label: 'Recent spectrum', description: 'A short history of real frequency measurements' },
];

/** A stable low-to-high frequency axis, using peak magnitude in each actual
 * analyser bin range. Neither the geometry nor smoothing invents signal. */
export function frequencyLevels(data: Uint8Array, count: number): number[] {
  if (!data.length || count <= 0 || !Number.isFinite(count)) return [];
  const length = Math.min(256, Math.floor(count));
  return Array.from({ length }, (_, index) => {
    const first = Math.floor((index / length) ** 2 * data.length);
    const last = Math.min(data.length, Math.max(first + 1, Math.floor(((index + 1) / length) ** 2 * data.length)));
    let maximum = 0;
    for (let bin = first; bin < last; bin += 1) maximum = Math.max(maximum, data[bin]);
    return (maximum / 255) ** 0.8;
  });
}

export function spectrumLevelCount(width: number, ratio: number, mode: SpectrumShape): number {
  const density = mode === 'bars' || mode === 'lanes' ? 7 : 8;
  const cap = mode === 'bars' ? 72 : 128;
  return Math.min(cap, Math.max(24, Math.floor(width / (Math.max(1, ratio) * density))));
}

type Brush = { accent: string; soft: string; gradient: CanvasGradient | string };
export type SpectrumHistory = number[][];
export const MAX_SPECTRUM_HISTORY = 24;

function contour(context: CanvasRenderingContext2D, levels: number[], width: number, base: number, scale: number, downward = false) {
  const n = levels.length;
  if (!n) return;
  const y = (index: number) => base + (downward ? 1 : -1) * levels[index] * scale;
  context.moveTo(0, y(0));
  for (let index = 1; index < n; index += 1) {
    const x = width * index / (n - 1);
    const previousX = width * (index - 1) / (n - 1);
    context.quadraticCurveTo(previousX, y(index - 1), (previousX + x) / 2, (y(index - 1) + y(index)) / 2);
  }
  context.lineTo(width, y(n - 1));
}

function mirror(context: CanvasRenderingContext2D, levels: number[], width: number, height: number) {
  const centre = height / 2;
  const scale = height * 0.44;
  const smooth = levels.map((value, index) =>
    (2 * value + (levels[index - 1] ?? value) + (levels[index + 1] ?? value)) / 4);
  context.beginPath();
  contour(context, smooth, width, centre, scale);
  context.lineTo(width, centre + smooth[smooth.length - 1] * scale);
  for (let index = smooth.length - 2; index >= 0; index -= 1) {
    context.lineTo(width * index / (smooth.length - 1), centre + smooth[index] * scale);
  }
  context.closePath();
  context.fill();
}

/** Return false when no analyser signal is available. Do not manufacture
 * non-zero samples, rhythmic movement, quality or tempo from audio metadata. */
export function paintFrequencyFrame(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  levels: number[],
  mode: SpectrumShape,
  brush: Brush,
  history: SpectrumHistory,
): boolean {
  if (!levels.length || !levels.some((level) => level > 0)) {
    if (mode === 'waterfall' && levels.length) {
      history.push([...levels]); // measured silence, not invented activity
      if (history.length > MAX_SPECTRUM_HISTORY) history.shift();
    }
    return false;
  }

  context.globalAlpha = 1;
  context.lineCap = 'round';
  if (mode === 'ribbon') {
    context.fillStyle = brush.gradient;
    mirror(context, levels, width, height);
  } else if (mode === 'bars') {
    context.fillStyle = brush.gradient;
    const gap = 2;
    const column = Math.max(1, (width - gap * (levels.length - 1)) / levels.length);
    levels.forEach((level, index) => {
      if (!level) return;
      const size = Math.max(1, level * height * 0.92);
      context.fillRect(index * (column + gap), (height - size) / 2, column, size);
    });
  } else if (mode === 'aurora') {
    // Three offset spectral slices; every point is a measured bin. Different
    // line weights and overlapping contours create the layered effect.
    const groups = [0, 1, 2];
    groups.forEach((row) => {
      const slice = levels.map((value, index) => {
        const at = Math.min(levels.length - 1, Math.floor(index * (0.62 + row * 0.19)));
        return (value + levels[at]) / 2;
      });
      const base = height * (0.68 - row * 0.1);
      context.beginPath();
      context.moveTo(0, base);
      contour(context, slice, width, base, height * (0.22 + row * 0.09));
      context.lineTo(width, base);
      context.closePath();
      context.globalAlpha = 0.28 + row * 0.2;
      context.fillStyle = row === 1 ? brush.soft : brush.accent;
      context.fill();
      context.globalAlpha = 0.45 + row * 0.16;
      context.strokeStyle = row === 1 ? brush.accent : brush.soft;
      context.lineWidth = row === 2 ? 2 : 1;
      context.beginPath();
      contour(context, slice, width, base, height * (0.22 + row * 0.09));
      context.stroke();
    });
  } else if (mode === 'lanes') {
    // Four labelled frequency regions are separated spatially, unlike a
    // single decorative amplitude bar. Filled lengths are aggregate measures.
    const names = 4;
    const space = height / names;
    for (let band = 0; band < names; band += 1) {
      const first = Math.floor(band * levels.length / names);
      const last = Math.max(first + 1, Math.floor((band + 1) * levels.length / names));
      const samples = levels.slice(first, last);
      const peak = Math.max(0, ...samples);
      const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
      const y = space * band + space * 0.33;
      context.globalAlpha = 0.2;
      context.fillStyle = brush.soft;
      context.fillRect(0, y, width, space * 0.34);
      context.globalAlpha = 0.7 + peak * 0.3;
      context.fillStyle = band % 2 ? brush.soft : brush.accent;
      if (mean > 0) context.fillRect(0, y, width * mean, space * 0.34);
      if (peak > 0) {
        context.strokeStyle = brush.accent;
        context.lineWidth = Math.max(1, space * 0.045);
        context.beginPath();
        context.moveTo(width * mean, y - 1);
        context.lineTo(width * peak, y - 1);
        context.stroke();
      }
    }
  } else if (mode === 'constellation') {
    context.strokeStyle = brush.accent;
    context.lineWidth = 1.5;
    context.globalAlpha = 0.62;
    context.beginPath();
    const stride = Math.max(1, Math.ceil(levels.length / 42));
    const points: { x: number; y: number; level: number }[] = [];
    for (let index = 0; index < levels.length; index += stride) {
      const level = levels[index];
      if (level <= 0) continue;
      points.push({
        x: index * width / (levels.length - 1),
        y: height * (0.85 - level * 0.7),
        level,
      });
    }
    points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    if (points.length > 1) context.stroke();
    context.fillStyle = brush.soft;
    context.globalAlpha = 0.9;
    points.forEach(({ x, y, level }) => {
      const radius = 1.5 + level * 3.2;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    });
  } else {
    // History is *actual* sampled analyser output only. The newest band is
    // below the older bands, with no scrolling CSS or invented pre-roll.
    history.push([...levels]);
    if (history.length > MAX_SPECTRUM_HISTORY) history.shift();
    const row = height / MAX_SPECTRUM_HISTORY;
    const col = width / levels.length;
    history.forEach((frame, historyIndex) => {
      const y = height - (history.length - historyIndex) * row;
      frame.forEach((level, index) => {
        if (!level) return;
        context.globalAlpha = Math.min(1, level * 0.95);
        context.fillStyle = historyIndex % 2 ? brush.accent : brush.soft;
        context.fillRect(index * col, y, Math.max(1, col - 0.5), row * 0.85);
      });
    });
  }
  context.globalAlpha = 1;
  return true;
}
