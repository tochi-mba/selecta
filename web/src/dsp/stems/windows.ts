/** Which parts of each song are split into stems (ADR-0459 Tier 3).
 *
 * A transition only needs stems where the two songs overlap: the outgoing song's last 60 s and
 * the incoming song's first 45 s. Splitting only those windows keeps one transition's work to
 * well under two minutes of audio. Windows are whole milliseconds so cache keys are stable.
 */

export const TAIL_WINDOW_S = 60;
export const HEAD_WINDOW_S = 45;

export type StemWindowRole = 'tail' | 'head';

export interface StemWindow {
  role: StemWindowRole;
  startMs: number;
  endMs: number;
}

export interface StemSongRef {
  songId: number;
  /** The song's content hash when known; used for the cache key only when sharing is on. */
  contentSha256?: string | null;
  durationS: number;
}

export function stemWindow(durationS: number, role: StemWindowRole): StemWindow | null {
  if (!Number.isFinite(durationS) || durationS <= 0) return null;
  const durationMs = Math.floor(durationS * 1000);
  if (role === 'tail') return { role, startMs: Math.max(0, durationMs - TAIL_WINDOW_S * 1000), endMs: durationMs };
  return { role, startMs: 0, endMs: Math.min(durationMs, HEAD_WINDOW_S * 1000) };
}

export interface PlannedWindow {
  song: StemSongRef;
  window: StemWindow;
}

/** The windows the next `transitions` seams need, in the order they are needed: the current
 * song's tail, then the next song's head, then that song's tail, and so on. */
export function transitionWindows(songs: readonly StemSongRef[], currentIndex: number, transitions = 2): PlannedWindow[] {
  const planned: PlannedWindow[] = [];
  for (let step = 0; step < transitions; step += 1) {
    const outgoing = songs[currentIndex + step];
    const incoming = songs[currentIndex + step + 1];
    if (!outgoing || !incoming) break;
    const tail = stemWindow(outgoing.durationS, 'tail');
    const head = stemWindow(incoming.durationS, 'head');
    if (tail) planned.push({ song: outgoing, window: tail });
    if (head) planned.push({ song: incoming, window: head });
  }
  return planned;
}

/** Resample one channel linearly. Separation input only; stems come back at 44.1 kHz and an
 * AudioBuffer at that rate plays correctly in a context at any rate. */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input.slice();
  const length = Math.max(0, Math.round((input.length * toRate) / fromRate));
  const output = new Float32Array(length);
  const step = fromRate / toRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * step;
    const base = Math.floor(position);
    const fraction = position - base;
    const a = input[base] ?? 0;
    const b = input[base + 1] ?? a;
    output[index] = a + (b - a) * fraction;
  }
  return output;
}

/** The minimal AudioBuffer surface the window cutter reads. */
export interface AudioLike {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData: (channel: number) => Float32Array;
}

/** Cut a window from decoded audio as fresh stereo 44.1 kHz arrays the caller owns (mono is
 * doubled, extra channels beyond two are dropped). */
export function cutStereoWindow(audio: AudioLike, window: StemWindow, targetRate = 44100): [Float32Array, Float32Array] {
  const start = Math.max(0, Math.min(audio.length, Math.round((window.startMs / 1000) * audio.sampleRate)));
  const end = Math.max(start, Math.min(audio.length, Math.round((window.endMs / 1000) * audio.sampleRate)));
  const left = audio.getChannelData(0).subarray(start, end);
  const right = audio.numberOfChannels > 1 ? audio.getChannelData(1).subarray(start, end) : left;
  return [resampleLinear(left, audio.sampleRate, targetRate), resampleLinear(right, audio.sampleRate, targetRate)];
}
