import type { NowState } from './player';

/** The player as the shell and the shared views actually use it (ADR-0462).
 *
 * `SetPlayer` satisfies this structurally; no change to player.ts is needed. The Cloud local-first
 * shell satisfies it with `cloud/localFirstPlayer.ts`, which drives the browser engine (ADR-0457)
 * behind the same members. Every member here is one that Shell.tsx, VolumeControl, MiniPlayer,
 * Now.tsx or another shared view calls; App-only members (prepare, cue, pause, resume) are
 * deliberately absent, so a view can never depend on something only the local player has.
 */
export interface PlayerLike {
  state: NowState;
  /** The one listener the app installs; the player calls it on every state change. */
  onChange: (state: NowState) => void;
  playFrom(position: number, offset?: number): Promise<void>;
  togglePause(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  /** Jump to the planned transition into the next song. */
  skip(): Promise<void>;
  seek(seconds: number): Promise<void>;
  stop(): void;
  toggleMute(): void;
  setVolume(volume: number): void;
  /** False when this player has no volume to set (a remote for a session that keeps volume on
   * each device): the volume control is then not drawn at all. Left out: it can. */
  canSetVolume?: boolean;
  /** One frame of the live spectrum, or null when no analyser is running. */
  getSpectrum(): Uint8Array | null;
  /** Unsmoothed stereo analyser taps for the visualizer; optional, the spectrum alone also works. */
  getVisualTaps?(): { left: AnalyserNode; right: AnalyserNode } | null;
}
