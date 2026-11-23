import type { ReactNode } from 'react';
import { MixEta, MixData, MixItem, Request, Status } from '../api';
import { NowState } from '../player';
import { PlayerLike } from '../playerContract';

export type View = 'Mixes' | 'Now' | 'Edit' | 'Library' | 'Words' | 'Workshop';

export type Undo = boolean | (() => Promise<void>);

export type ViewProps = {
  status: Status;
  mix: MixItem[];
  mixName: string;
  canUndo: boolean;
  mixEta?: MixEta;
  draftPlace?: number | null;
  openDraft?: (id: number) => void;
  closeDraft?: () => void;
  playDraft?: (id: number, from?: number) => Promise<void>;
  renamedDraft?: (name: string) => void;
  refreshMix: () => void;
  setMixData: (data: MixData) => void;
  refreshStatus: () => void;
  /** How this view talks to the server (ADR-0462): the local client here, the authenticated
   * Cloud client there. Views never import get/post/del from api.ts; they wrap this with
   * useApi (requestContext.ts) instead, so the same page renders against either server. */
  request?: Request;
  player: PlayerLike;
  now: NowState;
  setView: (view: View) => void;
  notify: (message: string, undo?: Undo) => void;
  stage: boolean;
  toggleStage: () => void;
  /** The browser said no to fullscreen, so the Stage is filling the page instead. */
  stageFallback?: boolean;
  openRequests?: () => void;
  /** Take back the newest change in this mix: `null` is the current mix, a number is that draft. */
  undo?: (scope: number | null) => Promise<void>;
  /** How many ready songs Make a Mix needs before it offers a mix. Local mode leaves it to the
   * page's own number; a browser mix needs only two songs it can play (BF-0462-05). */
  readyNeeded?: number;
  /** Whether this mode runs the local background audio-analysis pipeline. Browser-first Cloud
   * works transitions out while playing and must not offer the local-only Analyse action. */
  analysisAvailable?: boolean;
  /** Whether this mode supports editing individual songs and transitions after building a mix. */
  transitionEditingAvailable?: boolean;
  /** Whether this player's runtime exposes measured audio-frequency data for the visualizer. */
  visualizerAvailable?: boolean;
  /** Where songs aren't analysed (browser-first Cloud), a song's waveform drawn from its own file
   * on this device, for Listen's strip; null when the file can't be read here. */
  waveformOf?: (songId: number) => Promise<number[] | null>;
  /** What a shell puts straight under Listen's notice: the control the notice asks for, such as
   * the browser's sound check while nobody has confirmed hearing this device. */
  noticeAction?: ReactNode;
  /** What a shell lists under Up Next on Listen: the songs after the next one (browser-first Cloud). */
  listenQueue?: ReactNode;
  /** Whether this person has made a mix before, from somewhere that outlives this browser (browser-first
   * Cloud: the account's saved recipes). Local mode leaves it out and this browser's own note decides. */
  startedAMix?: boolean;
  /** The name of the current mix, whatever is being edited, for saying what a change will or won't touch. */
  currentMixName?: string;
};
