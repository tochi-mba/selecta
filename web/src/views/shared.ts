import { MixEta, MixData, MixItem, Status } from '../api';
import { NowState, SetPlayer } from '../player';

export type View = 'Mixes' | 'Now' | 'Edit' | 'Library' | 'Words' | 'Workshop';

export type Undo = boolean | (() => Promise<void>);
export type Toast = { message: string; undo: Undo; id: number };

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
  player: SetPlayer;
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
  /** The name of the current mix, whatever is being edited, for saying what a change will or won't touch. */
  currentMixName?: string;
};
