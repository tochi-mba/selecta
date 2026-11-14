import type { Account } from '../api';

/** Opt-in browser-first Cloud mode. Off preserves the existing hosted experience. */
export const PERSONAL_FLAG = 'local_first.personal';

// Legacy local-folder management still exposes an optional on-device setup link.
// Keep these named exports until the hosted Library/Uploads compatibility UI retires.
export {
  localEngineUrl as LOCAL_ENGINE_URL,
  localEngineSetupGuide as ENGINE_INSTALL_GUIDE,
} from '../../copy';

export function personalEnabled(account: Account | null): boolean {
  return account?.features[PERSONAL_FLAG] === true;
}
