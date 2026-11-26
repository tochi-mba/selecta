import { flagListed } from '../flags';
import type { Account } from './api';
import { isHostedAccount } from './deviceMusicGate';

/** cloud.one_shell: where the Cloud shell looks for an account's music. `device` is music on the
 * member's devices (connecting music, folder checks, This device); `cloud` is the cloud library.
 * With `device` off the shell is cloud only: songs play from the cloud library and adding music
 * means uploading. */
export type MusicHomes = { device: boolean; cloud: boolean };

/** Whether this account's own decisions name cloud.one_shell on. Read from the account, never the
 * shell's flag read, which HostedShell narrows while it is open; an old server never names it. */
export function oneShellFor(account: Pick<Account, 'features'> | null): boolean {
  return account?.features?.['cloud.one_shell'] === true;
}

/** The homes for an account in the one shell: device music only where it is decided on, and the
 * cloud library whenever there is no device music (the account's only place to keep songs). */
export function musicHomesFor(account: Pick<Account, 'experience'>, deviceMusic: boolean): MusicHomes {
  return { device: deviceMusic, cloud: !deviceMusic || isHostedAccount(account) };
}

/** Shell features that belong to music on a device, off in the shell's flag read while it is
 * cloud only, so their places and buttons are gone rather than empty. */
export const NOT_WITHOUT_DEVICE_MUSIC = {
  'cloud.workspace': false,
  'tools.listening_room': false,
} as const;

/** The foot of every page in the cloud-only profile. */
export const CLOUD_ONLY_FOOTER = 'SelectaDJ Cloud. Songs you upload are kept privately in your SelectaDJ storage and play on all your devices.';

// Said by CloudShell while it draws, so request code outside React reads the same profile.
let open: MusicHomes | null = null;

export function setShellHomes(homes: MusicHomes | null): void {
  open = homes;
}

/** The cloud-only profile is open (cloud.one_shell listed, no music on devices). */
export function cloudOnlyOpen(): boolean {
  return open !== null && !open.device && flagListed('cloud.one_shell');
}

/** The shared mixer and both of its files for cloud library songs: cloud.one_mixer, or the
 * cloud-only profile, which has no other Make a Mix. */
export function oneMixerOn(): boolean {
  return flagListed('cloud.one_mixer') || cloudOnlyOpen();
}
