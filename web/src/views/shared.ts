import { MixEta, MixData, MixItem, Status } from '../api';
import { NowState, SetPlayer } from '../player';

export type View = 'Mixes' | 'Now' | 'Edit' | 'Library' | 'Words' | 'Workshop';

export type Toast = { message: string; undo: boolean; id: number };

export type ViewProps = {
  status: Status;
  mix: MixItem[];
  mixName: string;
  canUndo: boolean;
  mixEta?: MixEta;
  refreshMix: () => void;
  setMixData: (data: MixData) => void;
  refreshStatus: () => void;
  player: SetPlayer;
  now: NowState;
  setView: (view: View) => void;
  notify: (message: string, undo?: boolean) => void;
  stage: boolean;
  toggleStage: () => void;
};
