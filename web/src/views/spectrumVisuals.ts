/** Display-only renderers for the Listen visualizer. No audio, clock or server writes happen here.
 * Every style is horizontal and full-width, and every style is driven by the shared feature layer
 * (visualizer/features.ts): measured band envelopes, onsets, kicks, snares, hi-hats, loudness with
 * auto-gain, the song's analysed beat grid and sections, stereo width and the waveform. Motion comes
 * only from those real events; when the analyser hears nothing, nothing is drawn.
 * Design note: docs/engineering/visualizer-design.md. */
import type { Features } from './visualizer/features';
import { clearVisualState, type Brush, type Painter, type VisualState } from './visualizer/kit';
import { bars, horizon, pulse, ribbon, scope, sparkle, stereo, waterfall } from './visualizer/stylesSpectrum';
import { bursts, grid, lanes, river, shock, tracer, wash } from './visualizer/stylesEvents';

export type SpectrumShape = 'bars' | 'ribbon' | 'waterfall' | 'lanes' | 'pulse' | 'horizon' | 'sparkle'
  | 'scope' | 'stereo' | 'bursts' | 'wash' | 'river' | 'grid' | 'shock' | 'tracer';

/** What each style reacts to, in the listener's words. */
export const SPECTRUM_MODES: { id: SpectrumShape; label: string; description: string }[] = [
  { id: 'bars', label: 'Frequency bars', description: 'The whole spectrum low to high, with falling peaks; kicks flash the centre line' },
  { id: 'pulse', label: 'Kick pulse field', description: 'A field of dots that swells together on every kick drum' },
  { id: 'lanes', label: 'Drum lanes', description: 'Kick, snare and hi-hat hits scroll past on three rails over the beat grid' },
  { id: 'ribbon', label: 'Bar ribbon', description: 'A spectrum ribbon that breathes with each bar and swells on kicks' },
  { id: 'horizon', label: 'Bass horizon', description: 'A bass wave that travels with the beat, with a sun that rises on kicks' },
  { id: 'sparkle', label: 'Hi-hat sparkle', description: 'Sparks scatter on every hi-hat and snare; the cymbal air shimmers' },
  { id: 'scope', label: 'Oscilloscope', description: 'The actual waveform of the mix, thickening on every kick' },
  { id: 'stereo', label: 'Stereo field', description: 'Each band spreads wider as the mix gets wider in stereo' },
  { id: 'waterfall', label: 'Scrolling spectrogram', description: 'The song draws its own score from right to left; kicks stamp the floor' },
  { id: 'bursts', label: 'Onset bursts', description: 'Particles burst from where each new sound lands, bass left, cymbals right' },
  { id: 'wash', label: 'Section wash', description: 'Colour fields that change at each new section and brighten on builds' },
  { id: 'river', label: 'Energy streams', description: 'Low, mid and high energy flowing past as stacked streams' },
  { id: 'grid', label: 'Beat grid', description: 'The beats of the bar fill in turn, with each hit marked where it landed' },
  { id: 'shock', label: 'Snare shockwave', description: 'Each snare sends waves out to both edges; kicks bloom in the centre' },
  { id: 'tracer', label: 'Brightness tracer', description: 'A comet that moves right as the sound gets brighter and up as it gets louder' },
];

/** Styles retired on 2026-11-12 (owner feedback: too alike) map to the nearest new idea. */
export const RETIRED_SPECTRUM_SHAPES: Record<string, SpectrumShape> = {
  radial: 'ribbon', aurora: 'ribbon', constellation: 'tracer', skyline: 'bars', threads: 'scope',
  pins: 'bars', matrix: 'waterfall', trails: 'river', dunes: 'horizon', candles: 'grid', mesh: 'stereo', split: 'lanes',
};

/** The saved style if it still exists, else its nearest new style, else the default. */
export function migrateSpectrumShape(saved: unknown): SpectrumShape {
  if (typeof saved !== 'string') return 'bars';
  if (SPECTRUM_MODES.some((mode) => mode.id === saved)) return saved as SpectrumShape;
  return RETIRED_SPECTRUM_SHAPES[saved] ?? 'bars';
}

const PAINTERS: Record<SpectrumShape, Painter> = {
  bars, ribbon, waterfall, lanes, pulse, horizon, sparkle, scope, stereo, bursts, wash, river, grid, shock, tracer,
};

export type { Brush, VisualState };
export { createVisualState } from './visualizer/kit';

/** Paint one frame of `mode` from measured features. Returns false (drawing nothing, and forgetting
 * the style's memory) when there is no signal, so silence is a still, empty canvas. */
export function paintVisualFrame(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  features: Features,
  mode: SpectrumShape,
  brush: Brush,
  state: VisualState,
): boolean {
  if (state.mode !== mode) {
    state.mode = mode;
    clearVisualState(state);
  }
  if (features.silent) {
    clearVisualState(state);
    return false;
  }
  context.globalAlpha = 1;
  context.lineCap = 'round';
  (PAINTERS[mode] ?? bars)(context, width, height, features, brush, state);
  context.globalAlpha = 1;
  return true;
}
