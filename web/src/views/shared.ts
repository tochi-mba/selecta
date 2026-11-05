import { MixItem, Status } from '../api';
import type { View } from '../main';
import { NowState, SetPlayer } from '../player';

export type ViewProps = {
  status: Status;
  mix: MixItem[];
  refreshMix: () => void;
  refreshStatus: () => void;
  player: SetPlayer;
  now: NowState;
  setView: (view: View) => void;
};

export const VIBES = [
  { name: 'balanced', label: 'Balanced', hint: 'A bit of everything that fits' },
  { name: 'seamless', label: 'Seamless', hint: 'Long blends, nothing jarring' },
  { name: 'punchy', label: 'Punchy', hint: 'Cuts and throws, keeps it moving' },
  { name: 'wordplay', label: 'Wordplay', hint: 'Follows the phrases songs share' },
];
