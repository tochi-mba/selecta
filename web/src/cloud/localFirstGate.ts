import { flagOn } from '../flags';
import type { Account } from './api';

/** Whether this account gets the local-first shell (ADR-0462/0463): the server decided the
 * local-first experience for it (BF-0455-03) and `cloud.local_first` is on in the one flag read.
 * Both must hold; with either off the legacy hosted pages render exactly as before. Kept apart
 * from LocalFirstShell so deciding never loads the shell, the views or the browser engine. */
export function showsLocalFirst(account: Pick<Account, 'experience'> | null): boolean {
  return account?.experience?.local_first === true && flagOn('cloud.local_first');
}

/** A grandfathered account: it keeps hosted media alongside local-first (ADR-0465 coexistence). */
export function isHostedAccount(account: Pick<Account, 'experience'> | null): boolean {
  return account?.experience?.hosted === true;
}
